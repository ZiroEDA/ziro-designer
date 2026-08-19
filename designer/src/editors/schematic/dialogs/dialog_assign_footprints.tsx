// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints. Counterpart: `cvpcb/cvpcb_mainframe.cpp`
 * (CVPCB_MAINFRAME) with `cvpcb/menubar.cpp`, `cvpcb/toolbars_cvpcb.cpp`,
 * `cvpcb/symbols_listbox.cpp`, `cvpcb/library_listbox.cpp` and
 * `cvpcb/footprints_listbox.cpp`.
 *
 * Same window: the File / Edit / Preferences menu bar, the top toolbar (save,
 * view footprint, previous/next unassigned, undo, redo, delete all, then
 * "Footprint Filters:" with the three toggles and the search box), the three
 * monospaced panes, "Footprint Libraries" (20%), "Symbol : Footprint
 * Assignments", "Filtered Footprints" (30%), the three status lines, and the
 * button row "Apply, Save Schematic & Continue" / Cancel / OK.
 *
 * The commands the toolbar, menus, keyboard and button row run are in
 * `cvpcb_commands.ts`, ported from CVPCB_ASSOCIATION_TOOL / CVPCB_CONTROL; this
 * file is the window they drive. In particular OK does **not** write the
 * `.kicad_sch` files — it mails the links to eeschema and leaves it dirty, so
 * the assignment is still undoable there — and only "Apply, Save Schematic &
 * Continue" saves. See that module's header.
 *
 * The rows are formatted exactly as upstream (CVPCB_MAINFRAME::formatSymbolDesc
 * and FOOTPRINTS_LISTBOX::SetFootprints), the assignment list is the netlist's
 * one-row-per-symbol view (multi-unit parts merged), and a row whose footprint
 * is missing from the libraries gets SYMBOLS_LISTBOX's warning background.
 *
 * Web deltas: KiCad's footprint viewer is a second frame, here it is a panel
 * over the footprint pane using the shared FOOTPRINT_PREVIEW_WIDGET. The
 * ".equ"-file features (Automatically Assign Footprints, Manage Footprint
 * Association Files) and the footprint library table editor are left out
 * rather than shown dead: the browser build has no association files and no
 * fp-lib-table to edit.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Schematic } from '@ziroeda/eeschema';
import { MenuBar, type Menu } from '../../../ui/MenuBar.js';
import { Toolbar, type ToolEntry } from '../../../ui/Toolbar.js';
import { FootprintPreviewWidget } from '../../../widgets/footprint_preview_widget.js';
import { LibraryLoadingPanel } from '../../../widgets/library_loading_panel.js';
import type { PcbFootprint } from '@ziroeda/pcbnew';
import {
  footprintSearchTerms,
  footprintTextMatchers,
  hasFootprintInfo,
  loadFootprint,
  loadFootprintIndex,
  matchesFootprintText,
  type FpIndexEntry,
} from '../../../widgets/footprint_list.js';
import { parseFootprint } from '../../footprint/footprintBoard.js';
import { uniquePadCount } from '@ziroeda/pcbnew';
import {
  projectFpLibTable,
  projectLibraryNickname,
  type FpLibRow,
} from '../../footprint/fp_lib_table.js';
import { DialogFpLibTable } from '../../../widgets/dialog_fp_lib_table.js';
import { footprintsBase } from '../../footprint/libraryManager.js';
import {
  collectCvpcbComponents,
  firstUnassignedComponent,
  formatFootprintDesc,
  formatSymbolDesc,
  type CvpcbComponent,
} from '../cvpcb_components.js';
import {
  buildLibrariesList,
  footprintSelectionAfterRebuild,
  selectedLibraryOf,
  typeAheadRow,
} from '../cvpcb_listbox.js';
import {
  associate as associateCommand,
  changeFocus,
  closeWindow as closeWindowCommand,
  deleteAll as deleteAllCommand,
  deleteAssoc as deleteAssocCommand,
  emptyAssociations,
  footprintOf as associationFootprintOf,
  gotoNA as gotoNACommand,
  markSaved,
  okCommand,
  redoAssociation,
  resolveUnsavedChanges,
  saveAndContinueCommand,
  saveToSchematicCommand,
  selectedComponent,
  undoAssociation,
  UNSAVED_ASSOCIATIONS_MESSAGE,
  type CvpcbAssociations,
  type CvpcbControl,
  type CvpcbSaveCommand,
} from '../cvpcb_commands.js';
import { settings } from '../../../prefs/settings.js';
import type { FieldsEdits } from './dialog_symbol_fields_table.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { dispatchMenuHotkey } from '../../../ui/menu_hotkeys.js';
import type { FocusLike } from '../../../ui/browser_hotkeys.js';
import { addClose } from '../../../ui/action_menu.js';
import { UnsavedChangesDialog } from '../../../ui/dialog_unsaved_changes.js';
import type { UnsavedChangesResult } from '../../../ui/confirm.js';

/** FOOTPRINTS_LISTBOX filter flags (listboxes.h). */
const FILTER_BY_FP_FILTERS = 0x0001;
const FILTER_BY_PIN_COUNT = 0x0002;
const FILTER_BY_LIBRARY = 0x0004;

/** Row height of the three virtual lists, in px (a monospaced text row). */
const ROW_H = 18;

/** `m_filterTimer->StartOnce( 200 )` (cvpcb_mainframe.cpp:438-446). */
const FILTER_DEBOUNCE_MS = 200;

/** `m_tcFilterString->SetMinSize( wxSize( 150, -1 ) )` (toolbars_cvpcb.cpp:112). */
const FILTER_BOX_WIDTH = 150;

interface Props {
  /** Every sheet of the open project, keyed by file name. */
  docs: ReadonlyMap<string, Schematic>;
  /** The current schematic's sheets, in hierarchy order, the netlist CVPCB
   *  is handed. Other `.kicad_sch` files in the folder are not this design. */
  files?: readonly string[];
  /** The project's own footprint files: every `<dir>.pretty/<fp>.kicad_mod`
   *  plus its `fp-lib-table` (which names the libraries, the fp-lib-table's
   *  project scope). */
  projectFootprints?: readonly { name: string; text: string }[];
  /** Write the assignments as Footprint field edits. `save` also persists the
   *  changed sheets; `close` dismisses the window (OK). */
  onApply: (edits: FieldsEdits, opts: { save: boolean; close: boolean }) => void;
  /** Save the project's footprint library table (Manage Footprint Libraries).
   *  Absent when there is no project to write it into. */
  onSaveLibTable?: (rows: FpLibRow[]) => void;
  onClose: () => void;
}

/**
 * A fixed-row-height windowed list: the virtual `wxListView` all three panes
 * are (`ITEMS_LISTBOX_BASE`, `cvpcb/listboxes.h`).
 *
 * One component for three panes, as upstream has one base class for three
 * listboxes — and, unlike upstream, one copy of the keyboard handling instead
 * of three. `typeAheadRow` (cvpcb_listbox.ts) is the loop `SYMBOLS_LISTBOX`,
 * `FOOTPRINTS_LISTBOX` and `LIBRARY_LISTBOX` each carry their own copy of; the
 * Home/End/Up/Down/PageUp/PageDown block is what all three `OnChar`s
 * `event.Skip()` back to the list itself.
 *
 * `multi` is `wxLC_SINGLE_SEL`, inverted: the symbols pane is built without
 * that style (symbols_listbox.cpp:37) and the other two with it
 * (footprints_listbox.cpp:35, library_listbox.cpp:37).
 */
function VirtualList({
  rows: text,
  selection,
  focused,
  multi = false,
  render,
  onSelectRows,
  onActivate,
  listRef,
  onFocus,
}: {
  /** Every row's text — the list's contents, `m_SymbolList` and friends. */
  rows: readonly string[];
  /** Every selected row (`GetFirstSelected`/`GetNextSelected`). */
  selection: ReadonlySet<number>;
  /** The row `EnsureVisible` follows, and the anchor a Shift+click ranges from. */
  focused: number;
  multi?: boolean;
  render: (i: number) => JSX.Element;
  onSelectRows: (rows: number[], focused: number) => void;
  onActivate?: (i: number) => void;
  /** The pane's scroller, so `SetFocusedControl` can focus it. */
  listRef?: React.RefObject<HTMLDivElement>;
  onFocus?: () => void;
}): JSX.Element {
  const count = text.length;
  // ITEMS_LISTBOX_BASE::UpdateWidth — the longest row sizes the virtual list,
  // so long rows scroll horizontally instead of clipping.
  const widthCh = useMemo(() => text.reduce((n, row) => Math.max(n, row.length), 0), [text]);
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = listRef ?? ownRef;
  const [view, setView] = useState({ top: 0, height: 400 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setView((v) => ({ ...v, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  // EnsureVisible( index ) after a selection change made elsewhere.
  useEffect(() => {
    const el = ref.current;
    if (!el || focused < 0) return;
    const top = focused * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
  }, [focused, ref]);

  /** A click, with wxListCtrl's modifiers: Ctrl toggles, Shift ranges. */
  const clickRow = (i: number, e: React.MouseEvent): void => {
    if (multi && (e.ctrlKey || e.metaKey)) {
      const next = new Set(selection);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      onSelectRows(
        [...next].sort((a, b) => a - b),
        i,
      );
      return;
    }
    if (multi && e.shiftKey && focused >= 0) {
      const lo = Math.min(focused, i);
      const hi = Math.max(focused, i);
      const next: number[] = [];
      for (let k = lo; k <= hi; k++) next.push(k);
      onSelectRows(next, i);
      return;
    }
    onSelectRows([i], i);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (count === 0) return;
    const page = Math.max(1, Math.floor(view.height / ROW_H));
    const here = focused < 0 ? 0 : focused;
    let to: number | null = null;

    switch (e.key) {
      // The keys all three OnChar()s hand straight back to the list.
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = count - 1;
        break;
      case 'ArrowUp':
        to = Math.max(0, here - 1);
        break;
      case 'ArrowDown':
        to = Math.min(count - 1, here + 1);
        break;
      case 'PageUp':
        to = Math.max(0, here - page);
        break;
      case 'PageDown':
        to = Math.min(count - 1, here + page);
        break;
      default:
        break;
    }

    if (to !== null) {
      onSelectRows([to], to);
      e.preventDefault();
      return;
    }

    // The type-ahead. Modified keys are commands, not characters.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const hit = typeAheadRow(text, e.key);
    if (hit === null) return;
    // `SetSelection( ii, true )` is a bare Select(): in the multi-select
    // symbols pane the jump *adds* the row rather than replacing the selection.
    onSelectRows(multi ? [...new Set([...selection, hit])].sort((a, b) => a - b) : [hit], hit);
    e.preventDefault();
  };

  const first = Math.max(0, Math.floor(view.top / ROW_H) - 4);
  const last = Math.min(count, Math.ceil((view.top + view.height) / ROW_H) + 4);
  const rows: JSX.Element[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div
        key={i}
        className={`ze-cvpcb-row${selection.has(i) ? ' selected' : ''}`}
        style={{ top: i * ROW_H, height: ROW_H }}
        // biome-ignore lint/a11y/useKeyWithClickEvents: the list owns the keyboard, see onKeyDown
        onClick={(e) => clickRow(i, e)}
        onDoubleClick={onActivate ? () => onActivate(i) : undefined}
      >
        {render(i)}
      </div>,
    );
  }

  return (
    <div
      className="ze-cvpcb-list"
      ref={ref}
      tabIndex={0}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      // Read the offset during dispatch: `currentTarget` is null by the time a
      // lazy state updater runs.
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        setView((v) => (v.top === top ? v : { ...v, top }));
      }}
    >
      <div
        style={{
          position: 'relative',
          height: count * ROW_H,
          width: widthCh ? `max(100%, ${widthCh + 2}ch)` : '100%',
        }}
      >
        {rows}
      </div>
    </div>
  );
}

export function DialogAssignFootprints({
  docs,
  files,
  projectFootprints,
  onApply,
  onSaveLibTable,
  onClose,
}: Props): JSX.Element {
  const components = useMemo(() => collectCvpcbComponents(docs, files), [docs, files]);

  // The project's `.pretty` libraries, keyed "Lib:Footprint" -> file text,
  // the fp-lib-table's project rows, which list before the global ones. The
  // nickname comes from the table, not the directory: the ECC83 demo's table
  // names `${KIPRJMOD}/footprints.pretty` "Footprints", which is the library
  // half of every FPID its schematic stores.
  const projectLibs = useMemo(() => {
    const rows = projectFpLibTable(projectFootprints ?? []);
    const byLib = new Map<string, Map<string, string>>();
    for (const f of projectFootprints ?? []) {
      const norm = f.name.replace(/\\/g, '/');
      if (!/\.kicad_mod$/i.test(norm)) continue;
      const lib = projectLibraryNickname(rows, norm);
      if (!lib) continue;
      const fpName = norm
        .split('/')
        .pop()!
        .replace(/\.kicad_mod$/i, '');
      if (!byLib.has(lib)) byLib.set(lib, new Map());
      byLib.get(lib)!.set(fpName, f.text);
    }
    return byLib;
  }, [projectFootprints]);

  /** Nickname -> the project library's URI, for the "Library location:" line. */
  const projectLibUris = useMemo(() => {
    const rows = projectFpLibTable(projectFootprints ?? []);
    const out = new Map<string, string>();
    for (const r of rows) out.set(r.name, r.uri);
    for (const f of projectFootprints ?? []) {
      const norm = f.name.replace(/\\/g, '/');
      if (!/\.kicad_mod$/i.test(norm)) continue;
      const nick = projectLibraryNickname(rows, norm);
      const dir = norm.slice(0, norm.lastIndexOf('/'));
      if (nick && !out.has(nick)) out.set(nick, dir);
    }
    return out;
  }, [projectFootprints]);

  const [hostedIndex, setHostedIndex] = useState<FpIndexEntry[]>([]);
  const [indexLoaded, setIndexLoaded] = useState(false);
  // The hosted index carries each footprint's pad count, description and
  // keywords (FOOTPRINT_INFO's cached fields, see tools/libraries/fp_index.mjs);
  // the project's own `.pretty` files are already in memory, so theirs are
  // computed here the same way FOOTPRINT_INFO_IMPL::load does.
  const index = useMemo<FpIndexEntry[]>(
    () => [
      ...[...projectLibs].map(([name, fps]) => {
        const entry: FpIndexEntry = {
          name,
          footprints: [...fps.keys()],
          pads: [],
          descr: [],
          tags: [],
        };
        for (const text of fps.values()) {
          const fp = parseFootprint(text);
          entry.pads!.push(fp ? uniquePadCount(fp) : 0);
          entry.descr!.push(fp?.descr ?? '');
          entry.tags!.push(fp?.tags ?? '');
        }
        return entry;
      }),
      ...hostedIndex,
    ],
    [projectLibs, hostedIndex],
  );

  /** Resolve a footprint from the project libraries, else the hosted ones. */
  const resolveFootprint = useMemo(() => {
    const cache = new Map<string, PcbFootprint | null>();
    return async (libId: string): Promise<PcbFootprint | null> => {
      const sep = libId.indexOf(':');
      const lib = libId.slice(0, sep);
      const name = libId.slice(sep + 1);
      const text = projectLibs.get(lib)?.get(name);
      if (text === undefined) return loadFootprint(libId);
      if (!cache.has(libId)) cache.set(libId, parseFootprint(text));
      return cache.get(libId) ?? null;
    };
  }, [projectLibs]);
  // The associations, the undo lists and the symbol selection: one state,
  // because the commands in cvpcb_commands.ts move them together (DeleteAll
  // rewrites every FPID *and* resets the selection as a single step).
  // `ReadNetListAndFpFiles` selects the first symbol with no footprint, and
  // selects nothing at all when every symbol already has one. Computed once, as
  // upstream computes it once while it fills the pane.
  const [model, setModel] = useState<CvpcbAssociations>(() => {
    const first = firstUnassignedComponent(components);
    return emptyAssociations(first >= 0 ? [first] : []);
  });
  const { assigned, undoStack, redoStack } = model;
  const curComp = selectedComponent(model);
  const symbolSelection = useMemo(() => new Set(model.selection), [model.selection]);
  /** `SetSelectedComponent` / the pane's own click and key handling. */
  const setSymbolSelection = (rows: readonly number[]): void =>
    setModel((m) => ({ ...m, selection: rows }));
  /** Set by a save, cleared the next time DisplayStatus would run. */
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  /** HandleUnsavedChanges is on screen (canCloseWindow is waiting for it). */
  const [unsavedPrompt, setUnsavedPrompt] = useState(false);
  const [curLib, setCurLib] = useState<number>(-1);
  // The footprint pane's row, kept in a ref as well: the rebuild rule below
  // reads the row it had *before* the rebuild, and reading it out of state
  // would make the effect re-run every time the user clicks a footprint.
  const [curFp, setCurFpState] = useState(-1);
  const curFpRef = useRef(-1);
  const setCurFp = (index: number): void => {
    curFpRef.current = index;
    setCurFpState(index);
  };
  const [filterFlags, setFilterFlags] = useState(0);
  // What the box shows, and what the list is filtered by: `onTextFilterChanged`
  // only restarts a 200 ms `wxTimer` (cvpcb_mainframe.cpp:438-446) and it is
  // `onTextFilterChangedTimer` that rebuilds the list, so a fast typist filters
  // fifteen thousand footprints once instead of once per keystroke.
  const [filterInput, setFilterInput] = useState('');
  const [filterText, setFilterText] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [libTableOpen, setLibTableOpen] = useState(false);
  // Focused pane, the third status line names the library of the focused
  // pane's selection (CVPCB_MAINFRAME::GetFocusedControl).
  // `SYMBOLS_LISTBOX::OnSelectComponent` calls `SetFocus()`, and the startup
  // selection goes through it, so the window opens with the symbols pane
  // focused — unless nothing was selected, which is CONTROL_NONE.
  const [focus, setFocus] = useState<CvpcbControl | null>(() =>
    firstUnassignedComponent(components) >= 0 ? 'symbol' : null,
  );

  useEffect(() => {
    void loadFootprintIndex().then((idx) => {
      setHostedIndex(idx);
      setIndexLoaded(true);
    });
  }, []);

  // `onTextFilterChanged` -> `m_filterTimer->StartOnce( 200 )`: each keystroke
  // restarts the timer, and only its expiry rebuilds the list. Enter is bound
  // straight to the same handler (`wxTE_PROCESS_ENTER`,
  // toolbars_cvpcb.cpp:106-113), which is why the box has an explicit Enter
  // path below rather than waiting the 200 ms out.
  useEffect(() => {
    if (filterInput === filterText) return;
    const timer = setTimeout(() => setFilterText(filterInput), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterInput, filterText]);

  /** `BuildLibrariesList`: pinned libraries first, both groups StrNumCmp'd. */
  const libRows = useMemo(
    () =>
      buildLibrariesList(
        index.map((l) => l.name),
        settings.common.system.session.pinned_fp_libs,
      ),
    [index],
  );
  /** The nicknames themselves, for the "Library location:" status line. */
  const libNames = useMemo(() => libRows.map(selectedLibraryOf), [libRows]);
  const selectedLibrary = selectedLibraryOf(curLib >= 0 ? libRows[curLib] : undefined);

  const footprintOf = (c: CvpcbComponent): string => associationFootprintOf(model, c);
  const component = curComp >= 0 ? components[curComp] : undefined;

  /**
   * The FOOTPRINT_LIST the filter walks: every footprint the libraries know, in
   * index order, with the FOOTPRINT_INFO fields the filters read
   * (`common/footprint_info.cpp`). `descr`/`tags` are '' and `pads` undefined on
   * an index generated before those fields existed.
   */
  const catalog = useMemo(() => {
    const out: {
      id: string;
      lib: string;
      name: string;
      pads: number | undefined;
      descr: string;
      tags: string;
    }[] = [];
    for (const lib of index) {
      lib.footprints.forEach((name, i) => {
        out.push({
          id: `${lib.name}:${name}`,
          lib: lib.name,
          name,
          pads: lib.pads?.[i],
          descr: lib.descr?.[i] ?? '',
          tags: lib.tags?.[i] ?? '',
        });
      });
    }
    return out;
  }, [index]);

  /** Every "Lib:Footprint" id known to the libraries, in index order. */
  const allFootprints = useMemo(() => catalog.map((fp) => fp.id), [catalog]);
  const knownFootprints = useMemo(() => new Set(allFootprints), [allFootprints]);

  /**
   * `FOOTPRINT_FILTER::ITERATOR::increment` (common/footprint_filter.cpp:50-104),
   * in its order: pin count, library, the symbol's fp_filters, then the search
   * text. A candidate has to survive all four.
   *
   * The search text is the part that was wrong. Upstream splits the box on
   * whitespace, makes one EDA_COMBINED_MATCHER per token, and scores each of
   * them against `FOOTPRINT_INFO::GetSearchTerms()` — nickname, name, LIB_ID,
   * every keyword token, the whole keyword string and the description. We
   * matched the tokens as plain substrings of the `Lib:Name` string alone, so
   * `smd` found nothing here and hundreds of footprints in KiCad.
   *
   * Building the search terms is the expensive step, so it runs last, exactly
   * where upstream's iterator puts it.
   */
  const filtered = useMemo(() => {
    const patterns =
      filterFlags & FILTER_BY_FP_FILTERS && component
        ? component.fpFilters.map((p) => ({
            withLib: p.includes(':'),
            re: wildcardToRegExp(p),
          }))
        : null;
    const matchers = footprintTextMatchers(filterText);
    const out: string[] = [];
    for (const fp of catalog) {
      if (filterFlags & FILTER_BY_PIN_COUNT && component) {
        // `PinCountMatch`. An index generated before pad counts existed cannot
        // answer, and does not veto: degrading to "no pin filter" beats
        // degrading to "nothing matches".
        if (fp.pads !== undefined && fp.pads !== component.pinCount) continue;
      }
      if (filterFlags & FILTER_BY_LIBRARY && selectedLibrary && fp.lib !== selectedLibrary)
        continue;
      if (patterns && patterns.length > 0) {
        const hit = patterns.some((p) =>
          p.re.test(p.withLib ? fp.id.toLowerCase() : fp.name.toLowerCase()),
        );
        if (!hit) continue;
      }
      if (matchers.length > 0) {
        const terms = footprintSearchTerms(fp.lib, fp.name, fp.tags, fp.descr);
        if (!matchesFootprintText(matchers, terms)) continue;
      }
      out.push(fp.id);
    }
    return out;
  }, [catalog, filterFlags, component, selectedLibrary, filterText]);

  const selectedFootprint = curFp >= 0 ? (filtered[curFp] ?? '') : '';

  /** FOOTPRINTS_LISTBOX::SetFootprints' rows, `"%3d Lib:Footprint"`. */
  const footprintRows = useMemo(
    () => filtered.map((id, i) => formatFootprintDesc(i + 1, id)),
    [filtered],
  );

  // Which footprint stays selected when the list is rebuilt. See
  // footprintSelectionAfterRebuild: the old row is remembered by its *text*, a
  // row that did not survive the filter falls back to row 0, and the selected
  // symbol's own footprint overrides both — or, when it has none, the pane is
  // left with nothing selected at all.
  const componentFp = component ? footprintOf(component) : '';
  const symbolSelectionKey = model.selection.join(',');
  const previousFootprintRows = useRef<readonly string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: symbolSelectionKey stands for the EVT_LIST_ITEM_SELECTED that runs this upstream
  useEffect(() => {
    const next = footprintSelectionAfterRebuild(
      previousFootprintRows.current,
      curFpRef.current,
      footprintRows,
      componentFp,
    );
    previousFootprintRows.current = footprintRows;
    setCurFp(next);
  }, [footprintRows, componentFp, symbolSelectionKey]);

  // ----- associations ------------------------------------------------------

  /** CVPCB_ASSOCIATION_TOOL::Associate — assign the given footprint to the
   *  selected symbol, then move on to the next unassigned one. */
  const associate = (fpid: string): void => setModel((m) => associateCommand(m, components, fpid));

  const undo = (): void => setModel((m) => undoAssociation(m, components));
  const redo = (): void => setModel((m) => redoAssociation(m, components));

  /** DeleteAll: clear every assignment as one undo entry, behind IsOK. */
  const deleteAll = (): void =>
    setModel((m) => deleteAllCommand(m, components, (msg) => window.confirm(msg)));

  /** Delete the selected symbol's assignment (CVPCB_ACTIONS::deleteAssoc). */
  const deleteAssoc = (): void => setModel((m) => deleteAssocCommand(m, components));

  /** gotoNextNA / gotoPreviousNA, the next symbol with no assignment. */
  const gotoNA = (dir: 1 | -1): void => setModel((m) => gotoNACommand(m, components, dir));

  /** The Footprint field edits the assignments amount to, one per unit. */
  const buildEdits = (): FieldsEdits => {
    const edits: FieldsEdits = new Map();
    for (const comp of components) {
      const fpid = assigned.get(comp.reference);
      if (fpid === undefined || fpid === comp.footprint) continue;
      for (const inst of comp.instances) {
        if (!edits.has(inst.file)) edits.set(inst.file, new Map());
        edits.get(inst.file)!.set(inst.id, { Footprint: fpid });
      }
    }
    return edits;
  };

  /** CVPCB_MAINFRAME::m_modified. */
  const changed = model.modified;

  /**
   * Run a save command. `assign` is the MAIL_ASSIGN_FOOTPRINTS half — always
   * sent, and here that is `onApply`, which applies the Footprint fields to the
   * open schematic as an undoable command. `saveSchematic` is the MAIL_SCH_SAVE
   * half, which is the only thing that writes the `.kicad_sch` files.
   */
  const runSave = (cmd: CvpcbSaveCommand): void => {
    onApply(buildEdits(), { save: cmd.effect.saveSchematic, close: cmd.close });
    if (cmd.effect.status !== null) setSavedStatus(cmd.effect.status);
    if (!cmd.close) setModel((m) => markSaved(m));
  };

  /** canCloseWindow: unsaved links are asked about before the window goes. */
  const closeWindow = (): void => {
    const step = closeWindowCommand(model.modified);
    if (step.prompt) setUnsavedPrompt(true);
    else if (step.close) onClose();
  };

  /** The answer to that prompt, through HandleUnsavedChanges. */
  const answerUnsavedChanges = (result: UnsavedChangesResult): void => {
    setUnsavedPrompt(false);
    const { close, effect } = resolveUnsavedChanges(result);
    if (effect) onApply(buildEdits(), { save: effect.saveSchematic, close });
    else if (close) onClose();
  };

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Esc is the Cancel button, which asks before
  // discarding modified links exactly as OnCancel does.
  useModalEscape(closeWindow);

  // ----- status lines (CVPCB_MAINFRAME::DisplayStatus) ----------------------

  const [fpInfo, setFpInfo] = useState<{ id: string; desc: string; keywords: string } | null>(null);
  useEffect(() => {
    if (!selectedFootprint) {
      setFpInfo(null);
      return;
    }
    let cancelled = false;
    void resolveFootprint(selectedFootprint).then((fp) => {
      if (cancelled) return;
      // FOOTPRINT_INFO's description/keywords are the footprint's (descr …)
      // and (tags …) metadata.
      setFpInfo(
        fp ? { id: selectedFootprint, desc: fp.descr ?? '', keywords: fp.tags ?? '' } : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFootprint]);

  const statusLine1 = useMemo(() => {
    const parts: string[] = [];
    if (filterFlags & FILTER_BY_FP_FILTERS) {
      const kw = component?.fpFilters.join(', ') ?? '';
      parts.push(kw ? `Keywords (${kw})` : 'Keywords');
    }
    if (filterFlags & FILTER_BY_PIN_COUNT) {
      const pc = component ? String(component.pinCount) : '';
      parts.push(pc ? `Pin Count (${pc})` : 'Pin Count');
    }
    if (filterFlags & FILTER_BY_LIBRARY) {
      parts.push(selectedLibrary ? `Library (${selectedLibrary})` : 'Library');
    }
    if (filterText) parts.push(`Search Text (${filterText})`);
    const head = parts.length === 0 ? 'No Filtering' : `Filtered by ${parts.join(', ')}`;
    // `msg += _( ": %i matching footprints" )` and nothing else: there is no
    // spinner and no "select a library first" here, because the pad counts come
    // from the index rather than from a download per candidate.
    return `${head}: ${filtered.length} matching footprints`;
  }, [filterFlags, component, selectedLibrary, filterText, filtered.length]);

  // SetStatusText( _( "Schematic saved" ), 1 ) writes over the description
  // line, and the next DisplayStatus puts the description back. DisplayStatus
  // runs on every selection and filter change, so those are what clear it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the DisplayStatus triggers, not values the effect reads
  useEffect(() => {
    setSavedStatus(null);
  }, [curComp, selectedFootprint, filterFlags, filterText]);

  const statusLine2 =
    savedStatus ??
    (fpInfo && (fpInfo.desc || fpInfo.keywords)
      ? `Description: ${fpInfo.desc};  Keywords: ${fpInfo.keywords}`
      : '');

  const statusLine3 = useMemo(() => {
    let lib = '';
    if (selectedFootprint) lib = selectedFootprint.slice(0, selectedFootprint.indexOf(':'));
    else if (focus === 'symbol' && component) lib = footprintOf(component).split(':')[0] ?? '';
    else if (focus === 'library') lib = selectedLibrary;
    if (!lib || !libNames.includes(lib)) return '';
    // LIBRARY_MANAGER::GetFullURI, a project library's own URI, else the
    // hosted set's.
    const uri = projectLibUris.get(lib);
    return `Library location: ${uri ?? `${footprintsBase()}/${lib}.pretty`}`;
  }, [selectedFootprint, focus, component, selectedLibrary, libNames, assigned, projectLibUris]);

  // ----- focus (CVPCB_MAINFRAME::GetFocusedControl / SetFocusedControl) -----

  const frameRef = useRef<HTMLDivElement>(null);
  const libraryListRef = useRef<HTMLDivElement>(null);
  const symbolListRef = useRef<HTMLDivElement>(null);
  const footprintListRef = useRef<HTMLDivElement>(null);
  const paneRefs: Record<CvpcbControl, React.RefObject<HTMLDivElement>> = {
    library: libraryListRef,
    symbol: symbolListRef,
    footprint: footprintListRef,
  };

  // The window takes focus on open so its hotkeys (Enter / Delete / Ctrl+Z)
  // work without clicking first. `SYMBOLS_LISTBOX::OnSelectComponent` runs
  // `SetFocus()` and the startup selection goes through it, so when a symbol
  // was selected the focus is the symbols pane rather than the frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mount-time focus, not a value the effect tracks
  useEffect(() => {
    if (focus === 'symbol') symbolListRef.current?.focus();
    else frameRef.current?.focus();
  }, []);

  // ----- menus, toolbar ----------------------------------------------------

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        {
          label: 'Save to Schematic',
          icon: 'cvpcbSaveToSchematic',
          shortcut: 'Ctrl+S',
          disabled: !changed,
          action: () => runSave(saveToSchematicCommand()),
        },
        { sep: true },
        addClose('Assign Footprints', closeWindow),
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          icon: 'cvpcbUndo',
          shortcut: 'Ctrl+Z',
          disabled: undoStack.length === 0,
          action: undo,
        },
        {
          label: 'Redo',
          icon: 'cvpcbRedo',
          shortcut: 'Ctrl+Y',
          disabled: redoStack.length === 0,
          action: redo,
        },
        { sep: true },
        {
          label: 'Delete Footprint Assignment',
          shortcut: 'Del',
          // DeleteAssoc walks the whole selection, so the row is live while
          // any selected symbol still has a footprint to clear.
          disabled: !model.selection.some((i) => footprintOf(components[i]!)),
          action: deleteAssoc,
        },
        {
          label: 'Delete All Footprint Assignments',
          icon: 'cvpcbDeleteAll',
          action: deleteAll,
        },
      ],
    },
    {
      label: 'Preferences',
      items: [
        {
          label: 'Manage Footprint Libraries...',
          icon: 'cvpcbLibTable',
          disabled: !onSaveLibTable,
          action: () => setLibTableOpen(true),
        },
      ],
    },
  ];

  const toolbarEntries: ToolEntry[] = [
    { id: 'cvpcbSaveToSchematic', icon: 'cvpcbSaveToSchematic', title: 'Save to Schematic' },
    'sep',
    { id: 'cvpcbLibTable', icon: 'cvpcbLibTable', title: 'Manage Footprint Libraries...' },
    'sep',
    { id: 'cvpcbViewFootprint', icon: 'cvpcbViewFootprint', title: 'View Selected Footprint' },
    'sep',
    { id: 'cvpcbPrevNA', icon: 'cvpcbPrevNA', title: 'Select Previous Unassigned Symbol' },
    { id: 'cvpcbNextNA', icon: 'cvpcbNextNA', title: 'Select Next Unassigned Symbol' },
    'sep',
    { id: 'cvpcbUndo', icon: 'cvpcbUndo', title: 'Undo' },
    { id: 'cvpcbRedo', icon: 'cvpcbRedo', title: 'Redo' },
    { id: 'cvpcbDeleteAll', icon: 'cvpcbDeleteAll', title: 'Delete All Footprint Assignments' },
    'sep',
    { control: 'filtersLabel' },
    {
      id: 'cvpcbFilterFp',
      icon: 'cvpcbFilterFp',
      title: 'Use symbol footprint filters',
      toggle: true,
    },
    { id: 'cvpcbFilterPin', icon: 'cvpcbFilterPin', title: 'Filter by pin count', toggle: true },
    { id: 'cvpcbFilterLib', icon: 'cvpcbFilterLib', title: 'Filter by library', toggle: true },
    'sep',
    { control: 'filterText' },
  ];

  const toggled = new Set<string>();
  if (filterFlags & FILTER_BY_FP_FILTERS) toggled.add('cvpcbFilterFp');
  if (filterFlags & FILTER_BY_PIN_COUNT) toggled.add('cvpcbFilterPin');
  if (filterFlags & FILTER_BY_LIBRARY) toggled.add('cvpcbFilterLib');

  const disabledIds = new Set<string>();
  if (!changed) disabledIds.add('cvpcbSaveToSchematic');
  if (undoStack.length === 0) disabledIds.add('cvpcbUndo');
  if (redoStack.length === 0) disabledIds.add('cvpcbRedo');
  if (!selectedFootprint) disabledIds.add('cvpcbViewFootprint');
  if (!onSaveLibTable) disabledIds.add('cvpcbLibTable');

  const onToolbar = (id: string): void => {
    switch (id) {
      case 'cvpcbSaveToSchematic':
        runSave(saveToSchematicCommand());
        break;
      case 'cvpcbLibTable':
        setLibTableOpen(true);
        break;
      case 'cvpcbViewFootprint':
        setViewerOpen((v) => !v);
        break;
      case 'cvpcbPrevNA':
        gotoNA(-1);
        break;
      case 'cvpcbNextNA':
        gotoNA(1);
        break;
      case 'cvpcbUndo':
        undo();
        break;
      case 'cvpcbRedo':
        redo();
        break;
      case 'cvpcbDeleteAll':
        deleteAll();
        break;
      case 'cvpcbFilterFp':
        setFilterFlags((f) => f ^ FILTER_BY_FP_FILTERS);
        break;
      case 'cvpcbFilterPin':
        setFilterFlags((f) => f ^ FILTER_BY_PIN_COUNT);
        break;
      case 'cvpcbFilterLib':
        setFilterFlags((f) => f ^ FILTER_BY_LIBRARY);
        break;
      default:
        break;
    }
  };

  /**
   * Keyboard. Ctrl+S, Ctrl+Z, Ctrl+Y and Del are the four rows above; Enter is
   * the one CVPCB command with no menu home.
   *
   * The four used to be re-stated here as literal comparisons, and each had
   * drifted from the row beside it in the way that always happens: Ctrl+Z also
   * fired on Ctrl+Shift+Z, Del cleared an assignment the greyed-out row said
   * could not be cleared, and Ctrl+S saved when File > Save to Schematic was
   * disabled because nothing had changed. `dispatchMenuHotkey` reads the rows,
   * so the row's `disabled` is the only condition there is.
   *
   * Still a React handler on the dialog's own subtree rather than a window
   * listener, which is the honest reading of a wx modal: only the dialog with
   * the event loop hears the key. `modalFloor: 1` says so - this frame *is* a
   * modal, so its own place on the stack must not silence it, while the
   * Manage Footprint Libraries dialog it can open still does.
   *
   * Escape never reaches here: it is the dialog's Cancel and the modal stack
   * takes it in the capture phase. See useModalEscape above.
   */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (dispatchMenuHotkey(menus, e, { target: e.target as FocusLike, modalFloor: 1 })) {
      e.preventDefault();
      return;
    }
    if (e.target instanceof HTMLInputElement) return;

    // CVPCB_ACTIONS::changeFocusRight / changeFocusLeft — Tab and Shift+Tab are
    // their default hotkeys, and CVPCB_CONTROL::Main posts the same two actions
    // for the right and left arrows.
    const dir =
      e.key === 'Tab' && !e.shiftKey
        ? 'right'
        : e.key === 'Tab' && e.shiftKey
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowLeft'
              ? 'left'
              : null;
    if (dir) {
      const next = changeFocus(focus, dir);
      if (next) {
        setFocus(next);
        paneRefs[next].current?.focus();
      }
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter') {
      // Whether there is anything to assign is Associate's own rule, not a
      // condition on the key: it ignores an empty footprint and otherwise
      // always advances to the next unassigned symbol.
      associate(selectedFootprint);
      e.preventDefault();
    }
  };

  const assignedCount = components.filter((c) => footprintOf(c)).length;

  /** SYMBOLS_LISTBOX's rows (`formatSymbolDesc`), which the pane renders and
   *  the type-ahead reads. */
  const symbolRows = components.map((c, i) =>
    formatSymbolDesc(i + 1, c.reference, c.value, footprintOf(c)),
  );
  // The two wxLC_SINGLE_SEL panes: at most one row, none when it is -1.
  const libSelection = new Set(curLib >= 0 ? [curLib] : []);
  const footprintSelection = new Set(curFp >= 0 ? [curFp] : []);

  return (
    <div className="ze-modal-backdrop" onMouseDown={closeWindow}>
      <div
        className="ze-modal ze-cvpcb"
        ref={frameRef}
        style={{ width: 1240, maxWidth: '96vw', height: 760, maxHeight: '92vh' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <div className="ze-modal-header">
          Assign Footprints
          <span className="x" title="Close" onClick={closeWindow}>
            ✕
          </span>
        </div>
        <MenuBar menus={menus} />
        <Toolbar
          entries={toolbarEntries}
          orientation="horizontal"
          toggled={toggled}
          disabledIds={disabledIds}
          onActivate={onToolbar}
          controls={{
            filtersLabel: <span className="ze-cvpcb-filters-label">Footprint Filters:</span>,
            filterText: (
              <input
                className="ze-search"
                style={{ width: FILTER_BOX_WIDTH }}
                value={filterInput}
                placeholder=""
                onFocus={() => setFocus(null)}
                onChange={(e) => setFilterInput(e.target.value)}
                onKeyDown={(e) => {
                  // wxTE_PROCESS_ENTER + the explicit wxEVT_TEXT_ENTER bind:
                  // Enter runs the same handler the timer does, now.
                  if (e.key !== 'Enter') return;
                  setFilterText(e.currentTarget.value);
                  e.preventDefault();
                }}
              />
            ),
          }}
        />

        <div className="ze-cvpcb-body">
          {/* Footprint Libraries (LIBRARY_LISTBOX) */}
          <section className="ze-cvpcb-pane" style={{ flex: '0 0 20%' }}>
            <div className="ze-cvpcb-caption">Footprint Libraries</div>
            <VirtualList
              rows={libRows}
              selection={libSelection}
              focused={curLib}
              listRef={libraryListRef}
              onFocus={() => setFocus('library')}
              onSelectRows={(rows) => {
                // LIBRARY_LISTBOX::OnSelectLibrary turns the library filter on
                // as it selects, so picking a library narrows the footprint
                // list right away (and lights the toolbar's toggle).
                setCurLib(rows[0] ?? -1);
                setFilterFlags((f) => f | FILTER_BY_LIBRARY);
              }}
              render={(i) => <span>{libRows[i]}</span>}
            />
            {!indexLoaded && (
              <LibraryLoadingPanel kind="footprints" label="Loading footprint libraries…" />
            )}
          </section>

          {/* Symbol : Footprint Assignments (SYMBOLS_LISTBOX) */}
          <section className="ze-cvpcb-pane" style={{ flex: 1 }}>
            <div className="ze-cvpcb-caption">Symbol : Footprint Assignments</div>
            <VirtualList
              rows={symbolRows}
              selection={symbolSelection}
              focused={curComp}
              // SYMBOLS_LISTBOX is the one pane built without wxLC_SINGLE_SEL.
              multi
              listRef={symbolListRef}
              onFocus={() => setFocus('symbol')}
              onSelectRows={setSymbolSelection}
              render={(i) => {
                const c = components[i]!;
                const fpid = footprintOf(c);
                // SYMBOLS_LISTBOX::OnGetItemAttr: every row FOOTPRINT_LIST has
                // no FOOTPRINT_INFO for gets the warning background — which an
                // *unassigned* symbol is too, GetFootprintInfo("") being null.
                const warn = indexLoaded && !hasFootprintInfo(knownFootprints, fpid);
                return <span className={warn ? 'ze-cvpcb-warn' : undefined}>{symbolRows[i]}</span>;
              }}
            />
            {components.length === 0 && (
              <div className="ze-cvpcb-empty">No symbols, place and annotate symbols first.</div>
            )}
          </section>

          {/* Filtered Footprints (FOOTPRINTS_LISTBOX) */}
          <section className="ze-cvpcb-pane last" style={{ flex: '0 0 30%', position: 'relative' }}>
            <div className="ze-cvpcb-caption">Filtered Footprints</div>
            <VirtualList
              rows={footprintRows}
              selection={footprintSelection}
              focused={curFp}
              listRef={footprintListRef}
              onFocus={() => setFocus('footprint')}
              onSelectRows={(rows) => setCurFp(rows[0] ?? -1)}
              onActivate={(i) => {
                const id = filtered[i];
                if (id) associate(id);
              }}
              render={(i) => <span>{footprintRows[i]}</span>}
            />
            {!indexLoaded && (
              <LibraryLoadingPanel kind="footprints" label="Loading footprint libraries…" />
            )}
            {viewerOpen && (
              <div className="ze-cvpcb-viewer">
                <div className="ze-cvpcb-caption">
                  {selectedFootprint || 'No footprint specified'}
                  <span className="x" title="Close" onClick={() => setViewerOpen(false)}>
                    ✕
                  </span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <FootprintPreviewWidget
                    footprint={selectedFootprint}
                    statusText="No footprint specified"
                    resolve={resolveFootprint}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* The three status lines of the bottom panel. */}
        <div className="ze-cvpcb-status">
          <div>{statusLine1}</div>
          <div>{statusLine2}</div>
          <div>{statusLine3}</div>
        </div>

        {libTableOpen && onSaveLibTable && (
          <DialogFpLibTable
            projectFiles={projectFootprints ?? []}
            globalLibraries={hostedIndex.map((l) => l.name)}
            globalBase={footprintsBase()}
            onSave={(next) => {
              onSaveLibTable(next);
              setLibTableOpen(false);
            }}
            onClose={() => setLibTableOpen(false)}
          />
        )}
        {/* canCloseWindow's HandleUnsavedChanges. Rendered inside the window so
            a click on its buttons cannot reach the backdrop behind. */}
        {unsavedPrompt && (
          <UnsavedChangesDialog
            message={UNSAVED_ASSOCIATIONS_MESSAGE}
            onResult={answerUnsavedChanges}
          />
        )}
        <div className="ze-modal-footer">
          <span className="ze-muted" style={{ marginRight: 'auto', fontSize: 12 }}>
            {assignedCount} of {components.length} assigned
          </span>
          <button
            className="ze-btn"
            disabled={!changed}
            onClick={() => runSave(saveAndContinueCommand())}
          >
            Apply, Save Schematic &amp; Continue
          </button>
          <button className="ze-btn" onClick={closeWindow}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => runSave(okCommand())}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** EDA_PATTERN_MATCH_WILDCARD_ANCHORED, `*` and `?` over the whole name. */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return /$^/;
  }
}
