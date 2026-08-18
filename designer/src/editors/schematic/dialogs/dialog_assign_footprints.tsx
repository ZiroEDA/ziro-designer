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
  loadFootprint,
  loadFootprintIndex,
  type FpIndexEntry,
} from '../../../widgets/footprint_list.js';
import { parseFootprint } from '../../footprint/footprintBoard.js';
import {
  projectFpLibTable,
  projectLibraryNickname,
  type FpLibRow,
} from '../../footprint/fp_lib_table.js';
import { DialogFpLibTable } from '../../../widgets/dialog_fp_lib_table.js';
import { footprintsBase } from '../../footprint/libraryManager.js';
import {
  collectCvpcbComponents,
  formatFootprintDesc,
  formatSymbolDesc,
  type CvpcbComponent,
} from '../cvpcb_components.js';
import {
  associate as associateCommand,
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
  undoAssociation,
  UNSAVED_ASSOCIATIONS_MESSAGE,
  type CvpcbAssociations,
  type CvpcbSaveCommand,
} from '../cvpcb_commands.js';
import type { FieldsEdits } from './dialog_symbol_fields_table.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { UnsavedChangesDialog } from '../../../ui/dialog_unsaved_changes.js';
import type { UnsavedChangesResult } from '../../../ui/confirm.js';

/** FOOTPRINTS_LISTBOX filter flags (listboxes.h). */
const FILTER_BY_FP_FILTERS = 0x0001;
const FILTER_BY_PIN_COUNT = 0x0002;
const FILTER_BY_LIBRARY = 0x0004;

/** Row height of the three virtual lists, in px (a monospaced text row). */
const ROW_H = 18;
/** Candidate count above which the pin-count filter would need a footprint
 *  download per candidate; upstream reads a cached scan of every library. */
const PIN_COUNT_SCAN_LIMIT = 800;

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

/** A fixed-row-height windowed list, the virtual wxListView the panes use. */
function VirtualList({
  count,
  selected,
  render,
  onSelect,
  onActivate,
  scrollTo,
  widthCh,
}: {
  count: number;
  selected: number;
  render: (i: number) => JSX.Element;
  onSelect: (i: number) => void;
  onActivate?: (i: number) => void;
  /** Row to scroll into view (EnsureVisible). */
  scrollTo?: number;
  /** Longest row in characters, ITEMS_LISTBOX_BASE::UpdateWidth, which sizes
   *  the virtual list so long rows scroll horizontally instead of clipping. */
  widthCh?: number;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 400 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setView((v) => ({ ...v, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // EnsureVisible( index ) after a selection change made elsewhere.
  useEffect(() => {
    const el = ref.current;
    if (!el || scrollTo === undefined || scrollTo < 0) return;
    const top = scrollTo * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
  }, [scrollTo]);

  const first = Math.max(0, Math.floor(view.top / ROW_H) - 4);
  const last = Math.min(count, Math.ceil((view.top + view.height) / ROW_H) + 4);
  const rows: JSX.Element[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div
        key={i}
        className={`ze-cvpcb-row${i === selected ? ' selected' : ''}`}
        style={{ top: i * ROW_H, height: ROW_H }}
        // biome-ignore lint/a11y/useKeyWithClickEvents: rows follow the list's keyboard handling
        onClick={() => onSelect(i)}
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
  const index = useMemo<FpIndexEntry[]>(
    () => [
      ...[...projectLibs].map(([name, fps]) => ({ name, footprints: [...fps.keys()] })),
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
  const [model, setModel] = useState<CvpcbAssociations>(() => emptyAssociations(0));
  const { assigned, undoStack, redoStack } = model;
  const curComp = model.selected;
  const setCurComp = (index: number): void =>
    setModel((m) => (m.selected === index ? m : { ...m, selected: index }));
  /** Set by a save, cleared the next time DisplayStatus would run. */
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  /** HandleUnsavedChanges is on screen (canCloseWindow is waiting for it). */
  const [unsavedPrompt, setUnsavedPrompt] = useState(false);
  const [curLib, setCurLib] = useState<number>(-1);
  const [curFp, setCurFp] = useState(0);
  const [filterFlags, setFilterFlags] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [libTableOpen, setLibTableOpen] = useState(false);
  // Pad counts of footprints fetched for the pin-count filter.
  const [padCounts, setPadCounts] = useState<Map<string, number>>(new Map());
  const [scanning, setScanning] = useState(0);
  /** The pin-count filter needs more footprint downloads than is reasonable. */
  const [scanTooLarge, setScanTooLarge] = useState(false);
  // Focused pane, the third status line names the library of the focused
  // pane's selection (CVPCB_MAINFRAME::GetFocusedControl).
  const [focus, setFocus] = useState<'library' | 'symbol' | 'footprint'>('symbol');

  useEffect(() => {
    void loadFootprintIndex().then((idx) => {
      setHostedIndex(idx);
      setIndexLoaded(true);
    });
  }, []);

  const libNames = useMemo(() => index.map((l) => l.name), [index]);
  const selectedLibrary = curLib >= 0 ? (libNames[curLib] ?? '') : '';

  const footprintOf = (c: CvpcbComponent): string => associationFootprintOf(model, c);
  const component = curComp >= 0 ? components[curComp] : undefined;

  /** Every "Lib:Footprint" id known to the libraries, in index order. */
  const allFootprints = useMemo(() => {
    const out: string[] = [];
    for (const lib of index) for (const name of lib.footprints) out.push(`${lib.name}:${name}`);
    return out;
  }, [index]);
  const knownFootprints = useMemo(() => new Set(allFootprints), [allFootprints]);

  // FOOTPRINT_FILTER: pin count, library, the symbol's fp_filters, then the
  // search terms (all terms must match, case-insensitively).
  const filtered = useMemo(() => {
    const patterns =
      filterFlags & FILTER_BY_FP_FILTERS && component
        ? component.fpFilters.map((p) => ({
            withLib: p.includes(':'),
            re: wildcardToRegExp(p),
          }))
        : null;
    const terms = filterText.toLowerCase().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const id of allFootprints) {
      const sep = id.indexOf(':');
      const lib = id.slice(0, sep);
      const name = id.slice(sep + 1);
      if (filterFlags & FILTER_BY_LIBRARY && selectedLibrary && lib !== selectedLibrary) continue;
      if (filterFlags & FILTER_BY_PIN_COUNT && component) {
        const pads = padCounts.get(id);
        if (pads === undefined || pads !== component.pinCount) continue;
      }
      if (patterns && patterns.length > 0) {
        const hit = patterns.some((p) =>
          p.re.test(p.withLib ? `${lib}:${name}`.toLowerCase() : name.toLowerCase()),
        );
        if (!hit) continue;
      }
      if (terms.length > 0) {
        const hay = id.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      out.push(id);
    }
    return out;
  }, [allFootprints, filterFlags, component, selectedLibrary, filterText, padCounts]);

  // The pin-count filter needs each candidate's pad count, which upstream has
  // from its cached library scan; here the .kicad_mod files are fetched (and
  // cached) for the candidate set, six at a time.
  useEffect(() => {
    if (!(filterFlags & FILTER_BY_PIN_COUNT) || !component) return;
    const candidates: string[] = [];
    for (const id of allFootprints) {
      const lib = id.slice(0, id.indexOf(':'));
      if (filterFlags & FILTER_BY_LIBRARY && selectedLibrary && lib !== selectedLibrary) continue;
      if (!padCounts.has(id)) candidates.push(id);
      if (candidates.length > PIN_COUNT_SCAN_LIMIT) {
        // Upstream reads pad counts from its cached scan of every library;
        // here each one is a download, so the set has to be narrowed first.
        setScanTooLarge(true);
        return;
      }
    }
    setScanTooLarge(false);
    if (candidates.length === 0) return;
    let cancelled = false;
    setScanning(candidates.length);
    void (async () => {
      const found = new Map<string, number>();
      const queue = [...candidates];
      const worker = async (): Promise<void> => {
        for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
          const fp = await resolveFootprint(id);
          if (cancelled) return;
          found.set(id, fp ? new Set(fp.pads.map((p) => p.number)).size : -1);
          setScanning(queue.length);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (!cancelled) {
        setPadCounts((prev) => new Map([...prev, ...found]));
        setScanning(0);
      }
    })();
    return () => {
      cancelled = true;
      setScanning(0);
    };
  }, [filterFlags, component, selectedLibrary, allFootprints, padCounts]);

  const selectedFootprint = filtered[curFp] ?? '';

  // FOOTPRINTS_LISTBOX::SetSelectedFootprint, selecting a symbol highlights
  // its own footprint in the list when that footprint is among the matches.
  const componentRef = component?.reference;
  const componentFp = component ? footprintOf(component) : '';
  useEffect(() => {
    if (!componentFp) return;
    const at = filtered.indexOf(componentFp);
    if (at >= 0) setCurFp(at);
    // Upstream re-selects after every SetFootprints, so a changed filter (or a
    // changed symbol) both land here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentRef, componentFp, filtered]);

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
    let tail = '';
    if (scanning > 0) tail = `, reading ${scanning} footprints…`;
    else if (scanTooLarge && filterFlags & FILTER_BY_PIN_COUNT)
      tail = ', select a library to filter by pin count';
    return `${head}: ${filtered.length} matching footprints${tail}`;
  }, [
    filterFlags,
    component,
    selectedLibrary,
    filterText,
    filtered.length,
    scanning,
    scanTooLarge,
  ]);

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
        { label: 'Close Assign Footprints', action: closeWindow },
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
          disabled: !component || !footprintOf(component),
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

  // Keyboard: Enter assigns the selected footprint, Delete clears the
  // assignment, Ctrl+Z / Ctrl+Y undo and redo (CVPCB_ACTIONS' hotkeys).
  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Escape never reaches here: it is the dialog's Cancel and the modal stack
    // takes it in the capture phase. See useModalEscape above.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') {
      // Whether there is anything to assign is Associate's own rule, not a
      // condition on the key: it ignores an empty footprint and otherwise
      // always advances to the next unassigned symbol.
      associate(selectedFootprint);
      e.preventDefault();
    } else if (e.key === 'Delete') {
      deleteAssoc();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      undo();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      redo();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      runSave(saveToSchematicCommand());
      e.preventDefault();
    }
  };

  // The window takes focus on open so its hotkeys (Enter / Delete / Ctrl+Z)
  // work without clicking first.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, []);

  const assignedCount = components.filter((c) => footprintOf(c)).length;
  // Longest row of each pane, so the lists scroll horizontally like upstream's.
  const libWidthCh = libNames.reduce((n, l) => Math.max(n, l.length), 0);
  const symWidthCh = components.reduce(
    (n, c, i) => Math.max(n, formatSymbolDesc(i + 1, c.reference, c.value, footprintOf(c)).length),
    0,
  );
  const fpWidthCh = filtered.reduce((n, id) => Math.max(n, id.length + 4), 0);

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
                style={{ width: 190 }}
                value={filterText}
                placeholder=""
                onChange={(e) => setFilterText(e.target.value)}
              />
            ),
          }}
        />

        <div className="ze-cvpcb-body">
          {/* Footprint Libraries (LIBRARY_LISTBOX) */}
          <section
            className="ze-cvpcb-pane"
            style={{ flex: '0 0 20%' }}
            onMouseDown={() => setFocus('library')}
          >
            <div className="ze-cvpcb-caption">Footprint Libraries</div>
            <VirtualList
              count={libNames.length}
              selected={curLib}
              scrollTo={curLib}
              widthCh={libWidthCh}
              onSelect={(i) => {
                // LIBRARY_LISTBOX::OnSelectLibrary turns the library filter on
                // as it selects, so picking a library narrows the footprint
                // list right away (and lights the toolbar's toggle).
                setCurLib(i);
                setCurFp(0);
                setFilterFlags((f) => f | FILTER_BY_LIBRARY);
              }}
              render={(i) => <span>{libNames[i]}</span>}
            />
            {!indexLoaded && (
              <LibraryLoadingPanel kind="footprints" label="Loading footprint libraries…" />
            )}
          </section>

          {/* Symbol : Footprint Assignments (SYMBOLS_LISTBOX) */}
          <section
            className="ze-cvpcb-pane"
            style={{ flex: 1 }}
            onMouseDown={() => setFocus('symbol')}
          >
            <div className="ze-cvpcb-caption">Symbol : Footprint Assignments</div>
            <VirtualList
              count={components.length}
              selected={curComp}
              scrollTo={curComp}
              widthCh={symWidthCh}
              onSelect={setCurComp}
              render={(i) => {
                const c = components[i]!;
                const fpid = footprintOf(c);
                // SYMBOLS_LISTBOX::OnGetItemAttr: a footprint that is not in
                // the loaded libraries gets the warning background.
                const warn = !!fpid && indexLoaded && !knownFootprints.has(fpid);
                return (
                  <span className={warn ? 'ze-cvpcb-warn' : undefined}>
                    {formatSymbolDesc(i + 1, c.reference, c.value, fpid)}
                  </span>
                );
              }}
            />
            {components.length === 0 && (
              <div className="ze-cvpcb-empty">No symbols, place and annotate symbols first.</div>
            )}
          </section>

          {/* Filtered Footprints (FOOTPRINTS_LISTBOX) */}
          <section
            className="ze-cvpcb-pane last"
            style={{ flex: '0 0 30%', position: 'relative' }}
            onMouseDown={() => setFocus('footprint')}
          >
            <div className="ze-cvpcb-caption">Filtered Footprints</div>
            <VirtualList
              count={filtered.length}
              selected={curFp}
              scrollTo={curFp}
              widthCh={fpWidthCh}
              onSelect={setCurFp}
              onActivate={(i) => {
                const id = filtered[i];
                if (id) associate(id);
              }}
              render={(i) => <span>{formatFootprintDesc(i + 1, filtered[i]!)}</span>}
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
