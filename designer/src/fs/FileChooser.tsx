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
 * What it drops, deliberately, is the GTK sidebar — Home, Desktop, Documents,
 * Other Locations. Those are places on a computer, and this tree has one root:
 * the account's own. The breadcrumb stays, showing our path rather than
 * `/usr/share/kicad/demos`.
 *
 * Everything visible is measured. The row is 24 px because a real
 * GtkTreeView's row is; the selected row is #e95420 because the real one is;
 * the Size column is 79 px wide because the real one is. Where a number was
 * needed it was taken off a live GtkFileChooserDialog rather than chosen —
 * `ui/shell.css`'s `--chooser-*` tokens carry the measurements, and
 * `ui/file_chooser.css` contains no literal at all.
 */

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TreeIcon } from '../home/project_tree_pane.js';
import { treeIconFor } from '../home/project_tree.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import '../ui/file_chooser.css';
import { fileExtension, fileTypeLabel } from './file_types.js';
import type { Entry, FileSystem } from './filesystem.js';
import { formatModified, formatSize } from './format.js';
import { ROOT, ancestors, basename, isValidName, join } from './path.js';

/** One entry of the type combo at the bottom right. */
export interface ChooserFilter {
  /** The whole string the combo shows — `KiCad project files (*.kicad_pro)`. */
  readonly label: string;
  /** Lowercase extensions without the dot. Empty means everything. */
  readonly extensions: readonly string[];
}

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
  extra?: JSX.Element;
  onAccept: (path: string) => void;
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
      n = a.modified - b.modified;
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

function iconFor(e: Entry): string {
  if (e.kind === 'project') return 'project';
  if (e.kind === 'folder') return 'directory';
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
  filters,
  extra,
  onAccept,
  onCancel,
  onDelete,
}: FileChooserProps): JSX.Element {
  const [dir, setDir] = useState(initialPath ?? ROOT);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(initialName ?? '');
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'name',
    ascending: true,
  });
  const [filter, setFilter] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
        setEntries(await fs.list(at));
        setError(null);
      } catch (e) {
        setEntries([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [fs],
  );

  useEffect(() => {
    void reload(dir);
  }, [dir, reload]);

  useEffect(() => {
    if (editing !== null) editInput.current?.select();
  }, [editing]);

  const goTo = (to: string): void => {
    if (to === dir) return;
    setHistory((h) => ({ past: [...h.past, dir], future: [] }));
    setSelected(null);
    setDir(to);
  };

  const back = (): void => {
    setHistory((h) => {
      const prev = h.past.at(-1);
      if (prev === undefined) return h;
      setDir(prev);
      setSelected(null);
      return { past: h.past.slice(0, -1), future: [dir, ...h.future] };
    });
  };

  const forward = (): void => {
    setHistory((h) => {
      const next = h.future[0];
      if (next === undefined) return h;
      setDir(next);
      setSelected(null);
      return { past: [...h.past, dir], future: h.future.slice(1) };
    });
  };

  const active = filters?.[filter];
  const shown = useMemo(() => {
    const list = (entries ?? []).filter((e) => {
      if (e.kind !== 'file') return true;
      if (!active || active.extensions.length === 0) return true;
      return active.extensions.includes(fileExtension(e.name));
    });
    return list.sort((a, b) => compareEntries(a, b, sort.key, sort.ascending));
  }, [entries, active, sort]);

  const activate = (e: Entry): void => {
    if (e.kind === 'file') {
      onAccept(e.path);
      return;
    }
    goTo(e.path);
  };

  const acceptNow = (): void => {
    if (mode === 'save') {
      if (!isValidName(name)) return;
      onAccept(join(dir, name));
      return;
    }
    const e = shown.find((x) => x.path === selected);
    if (!e) return;
    // A project folder is a document as well as a folder — Open Project opens
    // the project, it does not walk into it. Double-clicking still descends,
    // the way a bundle behaves on a desktop that has them.
    if (e.kind === 'project') {
      onAccept(e.path);
      return;
    }
    activate(e);
  };

  const commitEdit = async (): Promise<void> => {
    const now = editing;
    setEditing(null);
    if (!now || !isValidName(now.name)) return;
    try {
      if (now.path === null) await fs.mkdir(join(dir, now.name));
      else await fs.rename(now.path, now.name);
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

  const canAccept = mode === 'save' ? isValidName(name) : selected !== null;

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
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          ) : (
            <div className="ze-chooser-title">{title}</div>
          )}
          <button
            type="button"
            className="ze-btn primary"
            disabled={!canAccept}
            onClick={acceptNow}
          >
            {accept}
          </button>
        </div>

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
            {ancestors(dir).map((p) => (
              <button
                type="button"
                key={p}
                className={p === dir ? 'current' : undefined}
                onClick={() => goTo(p)}
              >
                {p === ROOT ? 'Home' : basename(p)}
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
                  className={`ze-chooser-row${selected === e.path ? ' selected' : ''}`}
                  onClick={() => {
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
    </div>
  );
}
