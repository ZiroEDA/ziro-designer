// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file chooser — our clone of the window every `wxFileDialog` puts up.
 *
 * KiCad opens 93 of them. It never draws one: it asks wxWidgets, which asks
 * GTK, and the same window comes back every time, which is why Open Project
 * and Export Netlist and Plot look like the same program. Ours has to be one
 * widget for the same reason, so this takes a {@link FileSystem} and a few
 * labels and is otherwise the same window wherever it is opened.
 *
 * The places sidebar stays, but its *rows* are ours. GTK's are Home, Desktop,
 * Documents, Downloads and Other Locations — places on a computer, and this
 * tree has one root. So the caller passes {@link ChooserPlace}s and the widget
 * only draws them; it never invents a place, the same way it never invents a
 * filter. The breadcrumb likewise shows our path, not `/usr/share/kicad/demos`.
 *
 * Everything visible is measured, off a capture of the real dialog — KiCad
 * 10.0.5's Open Existing Project on Yaru-dark, profiled pixel by pixel, with a
 * live `Gtk.FileChooserDialog` under python-gi asked the same questions as a
 * check. The row is 29 px because the selection band in that capture is 29 px;
 * the selected row is #e95420 and the accept button #0d761d because they are
 * two different colours in the same window; the sidebar is 254 px because it
 * is. `ui/shell.css`'s `--chooser-*` tokens carry the measurements, and
 * `ui/file_chooser.css` contains no literal at all.
 *
 * The full capture is in `~/chooser-image-measurements.md`.
 */

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TreeIcon } from '../home/project_tree_pane.js';
import { treeIconFor } from '../home/project_tree.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import '../ui/file_chooser.css';
import { fileExtension, fileTypeLabel } from './file_types.js';
import type { ChooserFilter, ChooserPlace } from './chooser_types.js';
import type { Entry, FileSystem } from './filesystem.js';
import { formatModified, formatSize } from './format.js';
import { ROOT, ancestors, basename, isValidName, join } from './path.js';
import { MessageDialogYesNo } from '../ui/dialog_message.js';

// ChooserFilter and ChooserPlace live in chooser_types.ts so the data modules
// that name them stay reachable from qa's tsconfig, which compiles .ts only.
// Re-exported here so every existing importer keeps working.
export type { ChooserFilter, ChooserPlace };

/** Which column the list is ordered by. */
type SortKey = 'name' | 'size' | 'type' | 'modified';

export interface FileChooserProps {
  /** The tree to browse. */
  fs: FileSystem;
  /**
   * `open` asks for something that exists; `save` asks for a name, and puts
   * the Name entry in the header bar where the title would otherwise be.
   */
  mode: 'open' | 'save';
  /** The header bar's title, in `open` mode. */
  title: string;
  /** The affirmative button's label — `Open`, `Save`, `Export`. */
  accept: string;
  /** Where to start. Defaults to the root. */
  initialPath?: string;
  /**
   * The places sidebar's rows, in order. Empty or omitted draws no sidebar —
   * the widget does not invent one, the same way it does not invent a filter.
   */
  places?: readonly ChooserPlace[];
  /**
   * Which place is lit when the window opens. Defaults to the first.
   *
   * Separate from the order on purpose: upstream lists Recent above Home but
   * opens on `defaultDir`, with Home lit — the sidebar's order is what a person
   * reaches for, not where the caller pointed the dialog.
   */
  initialPlace?: string;
  /** `save` mode: what the Name entry starts with. */
  initialName?: string;
  filters?: readonly ChooserFilter[];
  /**
   * The caller's own controls, along the bottom left.
   *
   * Upstream this is `wxFileDialogCustomizeHook`, and six KiCad call sites use
   * it — the capture that this window was measured from has KiCad's own
   * "Create a new folder for the project" checkbox sitting exactly here.
   */
  /**
   * `wxFD_MULTIPLE`: the user may take more than one file at once.
   *
   * GerbView's Open is the reason it exists — `wxFD_OPEN | wxFD_FILE_MUST_EXIST
   * | wxFD_MULTIPLE | wxFD_CHANGE_DIR` (gerbview/files.cpp:151-152), and
   * `dlg.GetPaths( filenamesList )` plural — a board's plot is a folder of
   * layers and taking them one at a time is not the same command. Every other
   * dialog is single, which is `wxFD_OPEN` alone.
   *
   * `save` mode ignores it: there is one name entry.
   */
  multiple?: boolean;
  extra?: JSX.Element;
  /**
   * The chosen path. With {@link FileChooserProps.multiple}, `rest` carries the
   * others — `dlg.GetPaths( filenamesList )` (gerbview/files.cpp:166), which is
   * plural only where wxFD_MULTIPLE is set.
   *
   * The first argument stays a single path so that no single-select caller had
   * to change: `rest` is empty for all of them.
   */
  onAccept: (path: string, rest?: readonly string[]) => void;
  onCancel: () => void;
  /**
   * Delete, asked of the caller rather than done here.
   *
   * The chooser knows how to remove a thing — the filesystem has `remove` —
   * but not whether to ask first, and the answer differs: deleting a project
   * signed in takes it out of the account, and signed out only out of this
   * browser. That sentence belongs to whoever opened the window, so the key
   * press is reported and the caller decides.
   */
  onDelete?: (entry: Entry) => void;
}

/** Folders first, then the chosen column — as every file manager orders. */
function compareEntries(a: Entry, b: Entry, key: SortKey, ascending: boolean): number {
  const aDir = a.kind !== 'file';
  const bDir = b.kind !== 'file';
  if (aDir !== bDir) return aDir ? -1 : 1;

  let n = 0;
  switch (key) {
    case 'size':
      n = (a.size ?? 0) - (b.size ?? 0);
      break;
    case 'type':
      n = typeOf(a).localeCompare(typeOf(b));
      break;
    case 'modified':
      // Undated rows sort together, below everything with a date, rather
      // than at epoch 0 where they would look like the oldest files here.
      n = (a.modified ?? Number.NEGATIVE_INFINITY) - (b.modified ?? Number.NEGATIVE_INFINITY);
      break;
    default:
      n = 0;
  }
  // Name is the tie-break for every other column, so an equal size or an equal
  // day does not leave the order down to whatever the store returned.
  if (n === 0) n = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return ascending ? n : -n;
}

/** The Type cell. A folder has none — the column is empty for one, measured. */
function typeOf(e: Entry): string {
  return e.kind === 'file' ? fileTypeLabel(e.name) : '';
}

/**
 * The row's icon.
 *
 * A project gets the *folder* icon, not KiCad's project bitmap, because in the
 * capture a project directory is drawn exactly like any other directory —
 * `kit-dev-coldfire-xilinx_5213` and `Downloads` carry the same folder glyph.
 * The KiCad project icon belongs to the `.kicad_pro` **file** you find inside
 * it, which is what `treeIconFor` gives that row. Drawing it on the folder was
 * the reason every project read as a document instead of a folder.
 */
function iconFor(e: Entry): string {
  if (e.kind === 'project' || e.kind === 'folder') return 'directory';
  return treeIconFor(e.name);
}

/**
 * A row being typed into — a new folder, or one being renamed.
 *
 * GTK edits in place rather than opening a prompt, so this is a row of the
 * list with an entry in its name cell and its other three cells empty.
 */
function EditRow({
  icon,
  value,
  inputRef,
  onChange,
  onCommit,
  onAbandon,
}: {
  icon: string;
  value: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (v: string) => void;
  onCommit: () => void;
  onAbandon: () => void;
}): JSX.Element {
  // Esc abandons the edit and leaves the window open, which is the nesting
  // wxWidgets gets from a modal event loop: the inner thing has the keyboard
  // and the outer one never sees the key. Here it comes from the same stack
  // every dialog uses — last mounted wins, and this row is mounted after the
  // chooser — rather than from a local Escape branch, which would fire as well
  // as the chooser's and close both.
  const abandoned = useRef(false);
  useModalEscape(() => {
    abandoned.current = true;
    onAbandon();
  });

  return (
    <div className="ze-chooser-row">
      <span className="ze-chooser-name-cell">
        <TreeIcon name={icon} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Losing focus commits, as GTK's does — unless the edit was just
          // abandoned, since unmounting blurs and that would commit the very
          // name Esc discarded.
          onBlur={() => {
            if (!abandoned.current) onCommit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit();
          }}
        />
      </span>
      <span />
      <span />
      <span />
    </div>
  );
}

export function FileChooser({
  fs,
  mode,
  title,
  accept,
  initialPath,
  initialName,
  places,
  initialPlace,
  filters,
  multiple = false,
  extra,
  onAccept,
  onCancel,
  onDelete,
}: FileChooserProps): JSX.Element {
  /**
   * Which sidebar row is lit. The first place is the one the window opens on,
   * so the sidebar and the list never disagree about where the user is.
   */
  const [placeId, setPlaceId] = useState<string | null>(
    (initialPlace !== undefined && places?.some((p) => p.id === initialPlace)
      ? initialPlace
      : places?.[0]?.id) ?? null,
  );
  const place = places?.find((p) => p.id === placeId);
  /** A place may browse its own tree; otherwise everything uses the caller's. */
  const activeFs = place?.fs ?? fs;
  /**
   * Accepting goes to the place the path came from — see
   * {@link ChooserPlace.onAccept}. Every accept in this widget goes through
   * here; calling the prop directly would send a demo's path to the handler
   * that only knows the account's tree, and there it resolves to nothing.
   */
  const acceptPath = (path: string, rest: readonly string[] = []): void =>
    (place?.onAccept ?? onAccept)(path, rest);
  const [dir, setDir] = useState(initialPath ?? place?.path ?? ROOT);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  /**
   * The path a save is about to replace, while GTK's confirmation is up.
   *
   * Null when there is nothing to confirm. Cancelling clears it and leaves the
   * dialog exactly as it was, name still typed — which is how a person changes
   * the name instead of replacing: GTK's confirmation has two answers, Replace
   * and Cancel, and Cancel puts you back in the chooser.
   */
  const [confirmOverwrite, setConfirmOverwrite] = useState<string | null>(null);

  /**
   * The Name entry, focused with its STEM selected when a save dialog opens.
   *
   * [px] asked of a real one. `qa/probes/savedlg_probe.cpp` builds the
   * wxFileDialog `Files_io` builds, shows it, and asks GTK which widget holds
   * the focus and what is selected inside it:
   *
   *     focused widget = GtkFileChooserEntry
   *     entry text     = 'complex_hierarchy.kicad_sch'
   *     selection      = yes [0..17]
   *
   * 17 is the length of `complex_hierarchy` — the extension is NOT selected, so
   * typing replaces the stem and keeps `.kicad_sch`. Ours opened with the focus
   * nowhere, so there was no ring to say where the name goes and no selection
   * to type over.
   */
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode !== 'save') return;
    const el = nameRef.current;
    if (!el) return;
    el.focus();
    // `lastIndexOf` rather than the first dot: `board.v2.kicad_sch` keeps only
    // `.kicad_sch`. A leading dot is the file's whole name, not an extension,
    // so a name with no stem selects all of it.
    const dot = el.value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    // Once, when the dialog opens. Re-running it on every keystroke would fight
    // the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * The rest of a multiple selection. `selected` stays the LAST row clicked —
   * it is the one F2 renames, the one Delete removes and the anchor a
   * shift-click ranges from, and every one of those means one row even here.
   */
  const [alsoSelected, setAlsoSelected] = useState<ReadonlySet<string>>(new Set());
  const isSelected = (path: string): boolean => selected === path || alsoSelected.has(path);
  const [name, setName] = useState(initialName ?? '');
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'name',
    ascending: true,
  });
  const [filter, setFilter] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The header bar's search toggle, and what has been typed into it. */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * The row being typed into: a new folder when `path` is null, otherwise the
   * entry being renamed. One state, because GTK edits in place for both — a
   * new folder appears as an editable row rather than as a prompt.
   */
  const [editing, setEditing] = useState<{ path: string | null; name: string } | null>(null);
  /** Where Back and Forward go. GTK's path bar has both. */
  const [history, setHistory] = useState<{ past: string[]; future: string[] }>({
    past: [],
    future: [],
  });
  const editInput = useRef<HTMLInputElement>(null);

  useModalEscape(onCancel);

  const reload = useCallback(
    async (at: string): Promise<void> => {
      setEntries(null);
      try {
        setEntries(await activeFs.list(at));
        setError(null);
      } catch (e) {
        setEntries([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeFs],
  );

  useEffect(() => {
    void reload(dir);
  }, [dir, reload]);

  useEffect(() => {
    if (editing !== null) editInput.current?.select();
  }, [editing]);

  /**
   * The highest folder this place can reach — {@link ChooserPlace.root}.
   *
   * A Save As from inside a board shows that board and no other, so neither the
   * breadcrumb nor Back may climb out to a sibling. Without the clamp the row
   * would only be where the dialog LANDS, and one click on the crumb above it
   * puts you in the account root with every project writable again.
   */
  const placeRoot = place?.root ?? ROOT;
  const withinPlace = (path: string): boolean =>
    placeRoot === ROOT || path === placeRoot || path.startsWith(`${placeRoot}/`);

  const goTo = (to: string): void => {
    if (to === dir || !withinPlace(to)) return;
    setHistory((h) => ({ past: [...h.past, dir], future: [] }));
    setSelected(null);
    setAlsoSelected(new Set());
    setDir(to);
  };

  const back = (): void => {
    setHistory((h) => {
      const prev = h.past.at(-1);
      if (prev === undefined || !withinPlace(prev)) return h;
      setDir(prev);
      setSelected(null);
      setAlsoSelected(new Set());
      setAlsoSelected(new Set());
      return { past: h.past.slice(0, -1), future: [dir, ...h.future] };
    });
  };

  const forward = (): void => {
    setHistory((h) => {
      const next = h.future[0];
      if (next === undefined) return h;
      setDir(next);
      setSelected(null);
      setAlsoSelected(new Set());
      setAlsoSelected(new Set());
      return { past: [...h.past, dir], future: h.future.slice(1) };
    });
  };

  const active = filters?.[filter];
  const shown = useMemo(() => {
    const needle = searching ? query.trim().toLowerCase() : '';
    const list = (entries ?? []).filter((e) => {
      // The search box narrows what is listed; the type combo is applied on top
      // of it, so searching cannot surface a file the caller filtered out.
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      if (e.kind !== 'file') return true;
      if (!active || active.extensions.length === 0) return true;
      return active.extensions.includes(fileExtension(e.name));
    });
    return list.sort((a, b) => compareEntries(a, b, sort.key, sort.ascending));
  }, [entries, active, sort, searching, query]);

  const activate = (e: Entry): void => {
    if (e.kind === 'file') {
      acceptPath(e.path);
      return;
    }
    // A place may say its projects are opened rather than entered — see
    // ChooserPlace.activateOpens.
    if (e.kind === 'project' && place?.activateOpens) {
      acceptPath(e.path);
      return;
    }
    goTo(e.path);
  };

  const acceptNow = (): void => {
    if (mode === 'save') {
      if (!isValidName(name)) return;

      const target = join(dir, name);
      // `wxFD_OVERWRITE_PROMPT`, which every Save As upstream passes
      // (pagelayout_editor/files.cpp:201, sch_editor_control.cpp's
      // SaveCurrSheetCopyAs, and the rest). On GTK the flag turns into
      // `gtk_file_chooser_set_do_overwrite_confirmation`, and the chooser puts
      // its own confirmation up before returning the path.
      //
      // Read ENTRIES, not `shown`: `shown` is what survives the wildcard and
      // the search box, and a file hidden by the current filter still exists
      // and would still be overwritten. Checking the visible list would
      // silently clobber exactly the file a person could not see.
      const clash = (entries ?? []).some((e) => e.path === target && e.kind !== 'folder');

      if (clash) {
        setConfirmOverwrite(target);
        return;
      }

      acceptPath(target);
      return;
    }
    const e = shown.find((x) => x.path === selected);
    if (!e) return;
    // Everything else that is selected AND still visible. A row filtered out
    // since it was picked is not something the user can see themselves handing
    // over, so it is not handed over.
    const rest = shown.filter((x) => x.path !== e.path && alsoSelected.has(x.path));
    // A project folder is a document as well as a folder — Open Project opens
    // the project, it does not walk into it. Double-clicking still descends,
    // the way a bundle behaves on a desktop that has them.
    if (e.kind === 'project') {
      acceptPath(e.path);
      return;
    }
    // A multiple selection is taken as a batch. `activate` walks into a folder
    // and opens a leaf, which is the single-file behaviour and the wrong answer
    // when several rows are lit.
    if (rest.length > 0) {
      acceptPath(
        e.path,
        rest.map((x) => x.path),
      );
      return;
    }
    activate(e);
  };

  const commitEdit = async (): Promise<void> => {
    const now = editing;
    setEditing(null);
    if (!now || !isValidName(now.name)) return;
    try {
      if (now.path === null) await activeFs.mkdir(join(dir, now.name));
      else await activeFs.rename(now.path, now.name);
      await reload(dir);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const header = (key: SortKey, label: string): JSX.Element => (
    <span onClick={() => setSort((s) => ({ key, ascending: s.key === key ? !s.ascending : true }))}>
      {label}
      {sort.key === key ? (sort.ascending ? ' ⌃' : ' ⌄') : ''}
    </span>
  );

  /**
   * A place with its own tree cannot be written to unless it says otherwise —
   * the caller's own tree is the writable one, and that is the place with no
   * `fs` of its own.
   */
  const placeWritable = place ? (place.writable ?? place.fs === undefined) : true;
  const canAccept = mode === 'save' ? placeWritable && isValidName(name) : selected !== null;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-chooser"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (editing !== null) return;
          if (e.key === 'Enter') acceptNow();
          // F2 renames and Delete deletes, which is what a file manager binds
          // them to and what the row's own buttons used to do.
          if (e.key === 'F2' && selected) {
            const entry = shown.find((x) => x.path === selected);
            if (entry) setEditing({ path: entry.path, name: entry.name });
          }
          if (e.key === 'Delete' && selected && onDelete) {
            const entry = shown.find((x) => x.path === selected);
            if (entry) onDelete(entry);
          }
        }}
      >
        <div className="ze-chooser-headerbar">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          {mode === 'save' ? (
            <div className="ze-chooser-name">
              <span>Name</span>
              {/* The entry goes insensitive with the button: a name typed into
                  a place nothing can be saved to is a name with nowhere to go,
                  and GTK does not offer to take one. */}
              <input
                ref={nameRef}
                value={name}
                disabled={!placeWritable}
                title={placeWritable ? undefined : 'This location cannot be saved to.'}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          ) : (
            <div className="ze-chooser-title">{title}</div>
          )}
          {/* GTK's header bar carries a search toggle between the title and the
              accept button. Ours filters the listing rather than walking the
              tree, which is the only search a listing this size needs. */}
          <button
            type="button"
            className={`ze-btn ze-chooser-search${searching ? ' primary' : ''}`}
            title="Search"
            aria-pressed={searching}
            onClick={() => {
              setSearching((s) => !s);
              setQuery('');
            }}
          >
            {/* GTK's `edit-find-symbolic`, which is a symbolic icon: one path
                in the foreground colour, never the colour emoji a bare
                U+1F50D would render as. Drawn rather than vendored because
                this button is GTK's own — KiCad has no bitmap for it. */}
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="6.75" cy="6.75" r="4.25" />
                <path d="M10 10l4 4" />
              </g>
            </svg>
          </button>
          <button
            type="button"
            className="ze-btn primary"
            disabled={!canAccept}
            onClick={acceptNow}
          >
            {accept}
          </button>
        </div>

        <div className="ze-chooser-body">
          {places && places.length > 0 ? (
            <div className="ze-chooser-sidebar">
              {places.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`ze-chooser-place${p.id === placeId ? ' current' : ''}`}
                  onClick={() => {
                    if (p.id === placeId) return;
                    setPlaceId(p.id);
                    setSelected(null);
                    setAlsoSelected(new Set());
                    setAlsoSelected(new Set());
                    setAlsoSelected(new Set());
                    setHistory({ past: [], future: [] });
                    setDir(p.path ?? ROOT);
                  }}
                >
                  <TreeIcon name={p.icon} />
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="ze-chooser-pane">
            <div className="ze-chooser-pathbar">
              <button
                type="button"
                className="ze-chooser-nav"
                title="Back"
                disabled={history.past.length === 0}
                onClick={back}
              >
                ‹
              </button>
              <div className="ze-chooser-crumbs">
                {/* Crumbs stop at the place's own root — one above it is a
                    sibling project, which a Save As from inside a board must
                    not offer. */}
                {ancestors(dir)
                  .filter(withinPlace)
                  .map((p) => (
                    <button
                      type="button"
                      key={p}
                      className={p === dir ? 'current' : undefined}
                      onClick={() => goTo(p)}
                    >
                      {p === placeRoot ? (place?.label ?? 'Home') : basename(p)}
                    </button>
                  ))}
              </div>
              <button
                type="button"
                className="ze-chooser-nav"
                title="Forward"
                disabled={history.future.length === 0}
                onClick={forward}
              >
                ›
              </button>
              {/* The cluster ends here; this takes the band's spare width so
                  the arrows stay against the crumbs, not the far edge. */}
              <span className="ze-chooser-gap" />
              {/* GTK puts the new-folder button in the path bar for
              GTK_FILE_CHOOSER_ACTION_SAVE only; the Open dialog's path bar is
              arrows and crumbs, which is why the capture has none. */}
              {mode === 'save' ? (
                <button
                  type="button"
                  className="ze-chooser-newdir"
                  title="Create Folder"
                  // Only inside a project: the root holds projects, and a folder
                  // there would be a project that is not one.
                  disabled={dir === ROOT}
                  onClick={() => setEditing({ path: null, name: '' })}
                >
                  +
                </button>
              ) : null}
              {searching ? (
                <input
                  className="ze-chooser-query"
                  autoFocus
                  placeholder="Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : null}
            </div>

            <div className="ze-chooser-list">
              <div className="ze-chooser-head">
                {header('name', 'Name')}
                {header('size', 'Size')}
                {header('type', 'Type')}
                {header('modified', 'Modified')}
              </div>
              <div className="ze-chooser-rows">
                {editing !== null && editing.path === null ? (
                  <EditRow
                    icon="directory"
                    value={editing.name}
                    inputRef={editInput}
                    onChange={(v) => setEditing({ path: null, name: v })}
                    onCommit={() => void commitEdit()}
                    onAbandon={() => setEditing(null)}
                  />
                ) : null}
                {shown.map((e) =>
                  editing?.path === e.path ? (
                    <EditRow
                      key={e.path}
                      icon={iconFor(e)}
                      value={editing.name}
                      inputRef={editInput}
                      onChange={(v) => setEditing({ path: e.path, name: v })}
                      onCommit={() => void commitEdit()}
                      onAbandon={() => setEditing(null)}
                    />
                  ) : (
                    <div
                      key={e.path}
                      className={`ze-chooser-row${isSelected(e.path) ? ' selected' : ''}`}
                      onClick={(ev) => {
                        // Ctrl (or Cmd) extends, as it does in every file
                        // manager; a plain click replaces the whole selection.
                        if (multiple && (ev.ctrlKey || ev.metaKey) && selected !== null) {
                          setAlsoSelected((prev) => {
                            const next = new Set(prev);
                            if (e.path === selected) return next;
                            if (next.has(e.path)) next.delete(e.path);
                            else next.add(selected);
                            return next;
                          });
                        } else {
                          setAlsoSelected(new Set());
                        }
                        setSelected(e.path);
                        if (mode === 'save' && e.kind === 'file') setName(e.name);
                      }}
                      onDoubleClick={() => activate(e)}
                    >
                      <span className="ze-chooser-name-cell">
                        <TreeIcon name={iconFor(e)} />
                        {e.name}
                      </span>
                      <span>{e.size === null ? '' : formatSize(e.size)}</span>
                      <span>{typeOf(e)}</span>
                      <span>{formatModified(e.modified)}</span>
                    </div>
                  ),
                )}
                {entries !== null && shown.length === 0 && editing === null ? (
                  <div className="ze-chooser-empty">
                    {error ?? (dir === ROOT ? 'No projects yet.' : 'This folder is empty.')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="ze-chooser-footer">
          <div className="ze-chooser-extra">{extra}</div>
          {filters && filters.length > 0 ? (
            <select value={filter} onChange={(e) => setFilter(Number(e.target.value))}>
              {filters.map((f, i) => (
                <option key={f.label} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {/* GTK's own overwrite confirmation, which `wxFD_OVERWRITE_PROMPT` turns
          on. Both sentences are the strings in the libgtk-3 on this machine,
          two spaces after each full stop included:

            A file named “%s” already exists.  Do you want to replace it?
            The file already exists in “%s”.  Replacing it will overwrite its
            contents.

          Two answers, not three. There is no "rename" button: Cancel returns
          you to the chooser with the name still typed, which is where you
          change it. */}
      {/* Its own mousedown must not reach the backdrop above, whose handler is
          `onCancel` for the WHOLE chooser: without this, dismissing the
          confirmation dismissed the file manager with it, and the name you were
          about to change went with it. Esc was already right - `useModalEscape`
          is a stack and only the topmost dialog answers. */}
      {confirmOverwrite !== null && (
        // biome-ignore lint/a11y/noStaticElementInteractions: a backdrop guard, not a control
        <div onMouseDown={(e) => e.stopPropagation()}>
          <MessageDialogYesNo
            // GTK's confirmation carries no title of its own, so this one is
            // OURS - the shell always draws a header, and the file dialog's own
            // title is the least invented thing to put in it.
            caption={title}
            message={`A file named “${basename(confirmOverwrite)}” already exists.  Do you want to replace it?`}
            extendedMessage={`The file already exists in “${
              basename(dir) || (place?.label ?? 'this folder')
            }”.  Replacing it will overwrite its contents.`}
            icon="warning"
            // NOT MEASURED: `_Replace` is not a distinct string in libgtk-3, so
            // the label is the standard pair and the affirmative is last, as
            // every other button row here is. Cancel holds the focus because the
            // other answer destroys a file.
            defaultButton="no"
            labels={{ yes: 'Replace', no: 'Cancel' }}
            onResult={(r) => {
              const target = confirmOverwrite;
              setConfirmOverwrite(null);
              if (r === 'yes') acceptPath(target);
            }}
          />
        </div>
      )}
    </div>
  );
}
