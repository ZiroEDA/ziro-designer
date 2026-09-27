// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/cvpcb_mainframe.cpp` (`CVPCB_MAINFRAME`), its engine half: the
 * COMPONENT list the frame works on, the association state with
 * `AssociateFootprint` and the undo list, `BuildLibrariesList`, the events
 * `setupEventHandlers` wires to the OK / Apply buttons, `canCloseWindow`, and
 * the two context menus `setupTools` builds. The window is
 * `cvpcb_mainframe_ui.tsx`, beside this file; see STRUCTURE.md.
 *
 * The COMPONENT list:
 *
 * The component list the Assign Footprints window works on. Counterpart:
 * `eeschema/netlist_exporters/netlist_exporter_base.cpp`
 * (NETLIST_EXPORTER_BASE::CreatePinList / findNextSymbol) feeding
 * `cvpcb/cvpcb_mainframe.cpp`'s COMPONENT list.
 *
 * Like the netlist CVPCB is handed, this is one entry per *symbol*, not per
 * symbol unit: the units of a multi-unit part (U1A, U1B, …) collapse into a
 * single row whose pin count is the whole part's, and assigning a footprint
 * writes the field to every unit (CVPCB_MAINFRAME::AssociateFootprint sets the
 * FPID on every netlist entry sharing the symbol's KIID). Power and other
 * virtual symbols (reference starting with '#') and symbols excluded from the
 * board are left out, exactly as the netlist leaves them out.
 *
 * The association state:
 *
 * The Assign Footprints commands. Counterparts:
 * `cvpcb/tools/cvpcb_association_tool.cpp` (`CVPCB_ASSOCIATION_TOOL`),
 * `cvpcb/tools/cvpcb_control.cpp` (the save actions),
 * `cvpcb/cvpcb_mainframe.cpp` (`AssociateFootprint`, `canCloseWindow`) and
 * `cvpcb/readwrite_dlgs.cpp` (`SaveFootprintAssociation`).
 *
 * These are the actions the toolbar, the menus, the keyboard and the button row
 * all run; the window is a rendering of the state they return. They live here,
 * outside the `.tsx`, for the reason `nextUnassociated` does: a closure inside a
 * React component cannot be tested, and every defect this module was written to
 * fix - an OK button that wrote files, a Delete All with no confirmation, an
 * Enter that stopped advancing - was a closure inside the component.
 *
 * ## Saving is two separate things, and conflating them loses work
 *
 * `SaveFootprintAssociation( bool aSaveSchematic )` always mails
 * `MAIL_ASSIGN_FOOTPRINTS`: eeschema takes the links, applies them to the open
 * schematic and is left **dirty**. It mails `MAIL_SCH_SAVE` - which writes the
 * `.kicad_sch` files - only when asked, and only "Apply, Save Schematic &
 * Continue" asks (`cvpcb_mainframe.cpp:330-336`). OK does not
 * (`:341-346` runs `saveAssociationsToSchematic`), and neither does the Save
 * answer to the unsaved-changes prompt (`:391-403`).
 *
 * That is deliberate, not an omission. Leaving eeschema dirty is what keeps the
 * assignment on eeschema's undo stack: a user who assigns 200 footprints, hits
 * OK and then sees it was the wrong footprint can press Ctrl+Z. Writing the
 * files on OK - which is what we did - commits the change past the point where
 * undo can reach it, which is the one thing a dialog must never do on its own.
 *
 * The context menus:
 *
 * The two right-click menus of the Assign Footprints window. Counterpart:
 * `CVPCB_MAINFRAME::setupTools` (cvpcb/cvpcb_mainframe.cpp:271-285), which
 * builds them, and `setupEventHandlers` (`:333-344`), which pops them up.
 *
 *     m_symbolsContextMenu = new ACTION_MENU( false, tool );
 *     m_symbolsContextMenu->Add( CVPCB_ACTIONS::showFootprintViewer );
 *     m_symbolsContextMenu->AppendSeparator();
 *     m_symbolsContextMenu->Add( ACTIONS::cut );
 *     m_symbolsContextMenu->Add( ACTIONS::copy );
 *     m_symbolsContextMenu->Add( ACTIONS::paste );
 *     m_symbolsContextMenu->AppendSeparator();
 *     m_symbolsContextMenu->Add( CVPCB_ACTIONS::deleteAssoc );
 *
 *     m_footprintContextMenu = new ACTION_MENU( false, tool );
 *     m_footprintContextMenu->Add( CVPCB_ACTIONS::showFootprintViewer );
 *
 * Data, not a component, for the reason the association state is: a menu built
 * inside a `.tsx` closure cannot be tested, and the window's header claimed
 * both of these menus were ported while the file handled no right-click at all.
 *
 * ## Three things that are easy to get wrong, and all three are upstream's
 *
 * **No row is ever disabled.** `setupUIConditions` (`:288-330`) sets a
 * condition for `saveAssociationsToSchematic`, `saveAssociationsToFile`,
 * `undo`, `redo` and the three filter toggles, and for nothing else — so
 * showFootprintViewer, cut, copy, paste and deleteAssoc are always live and
 * take their own guards silently. That is the same finding the Edit menu
 * already carries; these are literally the same TOOL_ACTIONs.
 *
 * **The right button does not change the selection.** The two handlers are
 * `[this]( wxMouseEvent& ) { PopupMenu( … ); }` — no `event.Skip()`, and
 * nothing that reads the position, hit-tests a row or selects one. The menu is
 * raised and that is all it does, so every row acts on the CURRENT selection
 * rather than on the row under the pointer: right-clicking an unselected
 * symbol and choosing Copy copies the SELECTED one's footprint. Making the
 * right button select first would be an invention, and the invention would be
 * silent — a Delete Footprint Assignment that cleared a different row than the
 * one it appeared over.
 *
 * **View Selected Footprint shows; it never hides.**
 * `CVPCB_CONTROL::ShowFootprintViewer` (cvpcb_control.cpp:156-214) creates the
 * DISPLAY_FOOTPRINTS_FRAME or, if it already exists, raises it and calls
 * `InitDisplay()`. There is no branch that closes it. The toolbar button ran a
 * toggle here, so a second press hid the viewer where KiCad would have brought
 * it forward; the panel's own ✕ is what stands for closing the frame.
 */

import {
  compareRefs,
  refId,
  type LibSymbol,
  type Schematic,
  type SchSymbol,
} from '@ziroeda/eeschema';
import { schSymbolLibraryName } from '@ziroeda/eeschema';
import { handleUnsavedChanges, type UnsavedChangesResult } from '@ziroeda/common/confirm.js';
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';
import { expandStackedPinNotation, strNumCmp } from '@ziroeda/common/string_utils.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import {
  saveFootprintAssociation,
  type CvpcbSaveCommand,
  type CvpcbSaveEffect,
} from './readwrite_dlgs.js';

/** One row of the "Symbol : Footprint Assignments" pane. */
export interface CvpcbComponent {
  /** Reference designator ("R1"), the identity units are merged on. */
  reference: string;
  value: string;
  /** Current FPID ("Library:Footprint"), '' when unassigned. */
  footprint: string;
  /** `ki_fp_filters` globs of the library symbol (the "Use symbol footprint
   *  filters" filter's patterns). */
  fpFilters: readonly string[];
  /** Pins of the whole part: every unit, each pin *number* counted once,
   *  then stacked-pin notation expanded. See `libSymbolPinCount`. */
  pinCount: number;
  /** Every unit of the part: the sheet file and the symbol's edit id. */
  instances: readonly { file: string; id: string }[];
}

const fieldOf = (s: SchSymbol, key: string): string =>
  s.fields.find((f) => f.key === key)?.value ?? '';

/**
 * The `<pins>` count CVPCB reads out of the netlist for a whole part, which is
 * what "Filter by pin count" matches against a footprint's unique pad count.
 *
 * `netlist_exporter_xml.cpp:1040-1060` is the specification, and both halves of
 * it matter:
 *
 *  1. `lcomp->GetGraphicalPins( 0, 0 )` — unit 0 and body style 0 both mean "no
 *     filtering" (`lib_symbol.cpp:1124-1141`), so this is *every* pin of *every*
 *     unit and both De Morgan representations. The list is then sorted by number
 *     and adjacent duplicates erased, with the comment naming exactly the two
 *     ways a pin turns up twice: a symbol with several units per package, and a
 *     DeMorgan conversion. The dedupe key is therefore the **pin number alone**
 *     — a quad op-amp that draws V+/V- on all four units contributes those two
 *     pins once, not eight times. Keying on `unit + number`, as this did,
 *     reported a quad op-amp with far too many pins, and since no footprint has
 *     that many pads "Filter by pin count" then matched nothing at all.
 *  2. Each surviving pin emits one `<pin>` node per number its stacked-pin
 *     notation expands to (`:1074-1092`, `SCH_PIN::GetStackedPinNumbers`), and
 *     `kicad_netlist_reader.cpp:874-878` counts the emitted nodes. A pin
 *     numbered `[1-4]` is four footprint pads, not one. The expansion runs
 *     *after* the dedupe and its results are not deduped again, so pins
 *     numbered `[1-4]` and `[3-6]` count 8, exactly as upstream.
 *
 * An unparseable stack (upstream's `aValid` false) falls back to the single pin
 * upstream emits for it.
 */
export function libSymbolPinCount(lib: LibSymbol | undefined): number {
  if (!lib) return 0;
  const numbers = new Set<string>();
  for (const unit of lib.units) for (const pin of unit.pins) numbers.add(pin.number);

  let count = 0;
  for (const number of numbers) {
    const { numbers: expanded, valid } = expandStackedPinNotation(number);
    count += valid && expanded.length > 0 ? expanded.length : 1;
  }
  return count;
}

/** `ki_fp_filters` of a library symbol, split on whitespace like KiCad. */
export function libSymbolFpFilters(lib: LibSymbol | undefined): string[] {
  const raw = lib?.properties.find((p) => p.key === 'ki_fp_filters')?.value ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Collect the components of a hierarchy. `files` names the sheets to read in
 * hierarchy order (the current schematic's sheets — not every `.kicad_sch`ic
 * that happens to sit in the project folder); when omitted every doc is read.
 */
export function collectCvpcbComponents(
  docs: ReadonlyMap<string, Schematic>,
  files?: readonly string[],
): CvpcbComponent[] {
  const order = files?.length ? files : [...docs.keys()];
  const byRef = new Map<string, CvpcbComponent & { fpFilters: string[] }>();
  const seenFiles = new Set<string>();

  for (const file of order) {
    // A sheet reached twice in the hierarchy is the same screen: read it once.
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    const doc = docs.get(file);
    if (!doc) continue;
    const libs = new Map(doc.libSymbols.map((l) => [l.libId, l]));

    doc.symbols.forEach((sym, index) => {
      const reference = fieldOf(sym, 'Reference');
      if (!reference || reference.startsWith('#') || !sym.onBoard) return;
      const instance = { file, id: refId('symbol', sym.uuid, index) };
      const existing = byRef.get(reference);
      if (existing) {
        existing.instances = [...existing.instances, instance];
        // The first unit carrying a value/footprint wins, like the netlist's
        // first-found symbol for the reference.
        if (!existing.value) existing.value = fieldOf(sym, 'Value');
        if (!existing.footprint) existing.footprint = fieldOf(sym, 'Footprint');
        return;
      }
      const lib = libs.get(schSymbolLibraryName(sym));
      byRef.set(reference, {
        reference,
        value: fieldOf(sym, 'Value'),
        footprint: fieldOf(sym, 'Footprint'),
        fpFilters: libSymbolFpFilters(lib),
        pinCount: libSymbolPinCount(lib),
        instances: [instance],
      });
    });
  }

  return [...byRef.values()].sort((a, b) => compareRefs(a.reference, b.reference));
}

/**
 * `CVPCB_MAINFRAME::ReadNetListAndFpFiles` (readwrite_dlgs.cpp:255-274) — the
 * row the window opens on.
 *
 *     int firstUnassigned = wxNOT_FOUND;
 *
 *     for( unsigned i = 0; i < m_netlist.GetCount(); i++ )
 *     {
 *         …
 *         if( firstUnassigned == wxNOT_FOUND && component->GetFPID().empty() )
 *             firstUnassigned = i;
 *     }
 *
 *     if( firstUnassigned >= 0 )
 *         m_symbolsListBox->SetSelection( firstUnassigned, true );
 *
 * Two rules in that, and we had neither. The window lands on the **first
 * symbol still needing a footprint**, which is the job you opened it to do;
 * and when there is no such symbol - every part already assigned - the guard
 * fails and **nothing is selected at all**, so the real window opens with no
 * highlighted row. Ours selected row 0 unconditionally, which also dragged the
 * footprint pane onto C1's footprint and made an already-finished board look
 * like it had work outstanding.
 *
 * Returns -1 (`wxNOT_FOUND`) for "select nothing".
 */
export function firstUnassignedComponent(components: readonly CvpcbComponent[]): number {
  return components.findIndex((c) => !c.footprint);
}

/**
 * CVPCB_MAINFRAME::formatSymbolDesc — the exact text of a row in the
 * "Symbol : Footprint Assignments" pane: a 3-wide index, the reference right
 * aligned in 8 columns, " - ", the value right aligned in 16, " : " and the
 * footprint. The pane is monospaced so the columns line up.
 */
export function formatSymbolDesc(
  index: number,
  reference: string,
  value: string,
  footprint: string,
): string {
  const ref = `${' '.repeat(Math.max(0, 8 - reference.length))}${reference}`;
  const val = `${' '.repeat(Math.max(0, 16 - value.length))}${value}`;
  return `${String(index).padStart(3, ' ')} ${ref} - ${val} : ${footprint}`;
}

/** FOOTPRINTS_LISTBOX::SetFootprints — "%3d Lib:Footprint". */
export function formatFootprintDesc(index: number, fpid: string): string {
  return `${String(index).padStart(3, ' ')} ${fpid}`;
}

/**
 * `CVPCB_CONTROL::ToNA` — the index of the next or previous *unassociated*
 * component, or null when there is nowhere to go.
 *
 * **It does not wrap**, and that is deliberate rather than an oversight:
 *
 *     for( unsigned int idx : naComp )
 *         if( idx > newSel ) { changeSel = true; newSel = idx; break; }
 *     …
 *     if( changeSel )
 *         m_frame->SetSelectedComponent( newSel );
 *
 * `changeSel` stays false when the scan finds nothing, so past the last
 * unassociated component the selection holds and the button looks dead. Ours
 * wrapped modulo the component count, which is arguably friendlier but is not
 * what the application does — and a wrap silently takes you back to the top of
 * a board you thought you had finished.
 *
 * An empty set of unassociated components is "nowhere to go": nothing is
 * unassociated, so `naComp.empty()` returns early.
 *
 * Upstream also does nothing in *either* direction when nothing is selected —
 * `newSel` starts at `UINT_MAX`, so the forward scan can never match, and the
 * backward branch is guarded on a non-empty selection. There is no such state in
 * this dialog: the current index is always valid.
 *
 * Lives here rather than in the dialog because a closure inside a `.tsx` cannot
 * be tested — which is how the wrap survived unnoticed.
 */
export function nextUnassociated(
  count: number,
  current: number,
  dir: 1 | -1,
  isAssigned: (index: number) => boolean,
): number | null {
  const na: number[] = [];
  for (let i = 0; i < count; i++) if (!isAssigned(i)) na.push(i);
  if (na.length === 0) return null;
  const found =
    dir === 1 ? na.find((i) => i > current) : [...na].reverse().find((i) => i < current);
  return found ?? null;
}

/** One association changed, as the undo list records it (CVPCB_ASSOCIATION). */
export interface CvpcbAssociationChange {
  reference: string;
  from: string;
  to: string;
}

/** One undo/redo step: everything one command changed
 *  (`CVPCB_UNDO_REDO_ENTRIES`; a batch command is a single entry). */
export type CvpcbUndoEntry = readonly CvpcbAssociationChange[];

/** The window's association state — the netlist's FPIDs plus the undo lists. */
export interface CvpcbAssociations {
  /** Pending FPID by reference; absent means the schematic's own value. */
  assigned: ReadonlyMap<string, string>;
  undoStack: readonly CvpcbUndoEntry[];
  redoStack: readonly CvpcbUndoEntry[];
  /**
   * SYMBOLS_LISTBOX's selection, ascending, as
   * `GetComponentIndices( SEL_COMPONENTS )` (cvpcb_mainframe.cpp:1090-1126)
   * walks it: `GetFirstSelected` then `GetNextSelected` until there are no
   * more. Empty is `SetSelectedComponent( -1 )` -> `DeselectAll()`, no row.
   *
   * A **list**, not an index, because `SYMBOLS_LISTBOX` is the one pane built
   * without `wxLC_SINGLE_SEL` (symbols_listbox.cpp:37, against
   * footprints_listbox.cpp:35 and library_listbox.cpp:37) and every command
   * that touches an association loops over the whole of it -- see `associate`.
   */
  selection: readonly number[];
  /** `CVPCB_MAINFRAME::m_modified`. Set by every association, cleared only by
   *  a save. Deliberately *not* "the assignments differ from the file": an
   *  assignment undone back to where it started still leaves the frame
   *  modified upstream, because `AssociateFootprint` sets the flag before it
   *  looks at anything else. */
  modified: boolean;
}

export function emptyAssociations(selection: readonly number[] = []): CvpcbAssociations {
  return { assigned: new Map(), undoStack: [], redoStack: [], selection, modified: false };
}

/**
 * `CVPCB_MAINFRAME::GetSelectedComponent` — the symbol the status lines, the
 * footprint filters and the footprint pane follow, which is
 * `m_symbolsListBox->GetSelection()`, i.e. `GetFirstSelected()`: the lowest
 * selected row, or -1 when nothing is selected.
 */
export function selectedComponent(state: CvpcbAssociations): number {
  return state.selection[0] ?? -1;
}

/** The FPID a symbol currently has: the pending one, else the schematic's. */
export function footprintOf(state: CvpcbAssociations, comp: CvpcbComponent | undefined): string {
  if (!comp) return '';
  return state.assigned.get(comp.reference) ?? comp.footprint;
}

/**
 * `CVPCB_MAINFRAME::AssociateFootprint` — set one symbol's FPID (which means
 * every unit of it: our components are already unit-merged) and record it.
 *
 * There is **no** "it already has that footprint" guard upstream, and adding
 * one breaks the main keyboard workflow: `Associate` posts `gotoNextNA`
 * afterwards, so pressing Enter on the footprint a symbol already has is how
 * you accept it and move on to the next unassigned symbol.
 *
 * `newEntry` is upstream's `aNewEntry`: false appends to the entry the previous
 * call opened, which is how a batch command becomes one undo step.
 */
export function associateFootprint(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  index: number,
  fpid: string,
  newEntry = true,
): CvpcbAssociations {
  const comp = components[index];
  if (!comp) return state;

  const from = footprintOf(state, comp);
  const assigned = new Map(state.assigned);
  if (comp.footprint === fpid) assigned.delete(comp.reference);
  else assigned.set(comp.reference, fpid);

  const change: CvpcbAssociationChange = { reference: comp.reference, from, to: fpid };
  const last = state.undoStack[state.undoStack.length - 1];
  const undoStack: CvpcbUndoEntry[] =
    newEntry || !last
      ? [...state.undoStack, [change]]
      : [...state.undoStack.slice(0, -1), [...last, change]];

  return {
    assigned,
    undoStack,
    // "Clear the redo list", but only when this opened a new entry.
    redoStack: newEntry ? [] : state.redoStack,
    selection: state.selection,
    modified: true,
  };
}

/** `CVPCB_MAINFRAME::UndoAssociation` / `RedoAssociation`. */
export function undoAssociation(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
): CvpcbAssociations {
  return stepHistory(state, components, 'undo');
}

export function redoAssociation(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
): CvpcbAssociations {
  return stepHistory(state, components, 'redo');
}

function stepHistory(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  direction: 'undo' | 'redo',
): CvpcbAssociations {
  const from = direction === 'undo' ? state.undoStack : state.redoStack;
  const entry = from[from.length - 1];
  if (!entry) return state;

  const assigned = new Map(state.assigned);
  for (const change of entry) {
    const target = direction === 'undo' ? change.from : change.to;
    const comp = components.find((c) => c.reference === change.reference);
    if (comp && comp.footprint === target) assigned.delete(change.reference);
    else assigned.set(change.reference, target);
  }

  return {
    assigned,
    undoStack: direction === 'undo' ? state.undoStack.slice(0, -1) : [...state.undoStack, entry],
    redoStack: direction === 'undo' ? [...state.redoStack, entry] : state.redoStack.slice(0, -1),
    selection: state.selection,
    // AssociateFootprint sets m_modified before the undo bookkeeping, so
    // stepping the history leaves the frame modified either way.
    modified: true,
  };
}

// ----- the frame's own events -----------------------------------------------

/**
 * The OK button: `saveAssociationsToSchematic`, then `Close( true )`.
 * `SaveFootprintAssociation( false )` — the schematic files are **not**
 * written, so the assignment stays undoable in eeschema.
 */
export function okCommand(): CvpcbSaveCommand {
  return { effect: saveFootprintAssociation(false), close: true };
}

/** "Apply, Save Schematic & Continue": `saveAssociationsToFile`, no close. */
export function saveAndContinueCommand(): CvpcbSaveCommand {
  return { effect: saveFootprintAssociation(true), close: false };
}

/** File ▸ Save to Schematic / Ctrl+S: `saveAssociationsToSchematic`. */
export function saveToSchematicCommand(): CvpcbSaveCommand {
  return { effect: saveFootprintAssociation(false), close: false };
}

/** `SaveFootprintAssociation`'s trailing `m_modified = false`. The pending
 *  edits are the schematic's own values now, so they stop being pending.
 *
 *  Known delta: upstream keeps its undo list across a save, and this drops it.
 *  Ours is relative to the values the window opened with, which the save has
 *  just moved; rebasing it is a separate job from these commands. */
export function markSaved(state: CvpcbAssociations): CvpcbAssociations {
  return { ...emptyAssociations(state.selection) };
}

// ----- closing --------------------------------------------------------------

/** `HandleUnsavedChanges`'s question for this frame. */
export const UNSAVED_ASSOCIATIONS_MESSAGE =
  'Symbol to Footprint links have been modified. Save changes?';

/**
 * `CVPCB_MAINFRAME::canCloseWindow` — modified links have to be asked about
 * before the window can go. Unmodified, it just closes.
 */
export function closeWindow(modified: boolean): { prompt: boolean; close: boolean } {
  return modified ? { prompt: true, close: false } : { prompt: false, close: true };
}

/**
 * The answer to that prompt, through `HandleUnsavedChanges`.
 *
 * Save runs `SaveFootprintAssociation( false )` — the same thing OK does, so
 * "Save" here does not write the schematic files either.
 */
export function resolveUnsavedChanges(result: UnsavedChangesResult): {
  close: boolean;
  effect: CvpcbSaveEffect | null;
} {
  let effect: CvpcbSaveEffect | null = null;
  const close = handleUnsavedChanges(result, () => {
    effect = saveFootprintAssociation(false);
    return true;
  });
  return { close, effect };
}

// ----- focus ----------------------------------------------------------------

/** `CVPCB_MAINFRAME::CONTROL_TYPE` — which of the three panes has the focus. */
export type CvpcbControl = 'library' | 'symbol' | 'footprint';

/**
 * `CVPCB_MAINFRAME::BuildLibrariesList` (cvpcb_mainframe.cpp:1005-1046) — the
 * "Footprint Libraries" pane's rows.
 *
 * Not the order the library table hands them over in, which is what this used
 * to show. Pinned libraries come first, each prefixed with
 * `LIB_TREE_MODEL_ADAPTER::GetPinningSymbol()`, then the rest; **both** groups
 * are sorted with `StrNumCmp( lhs, rhs, true )` - the comparator upstream
 * names "the same sorting algorithm as LIB_TREE_NODE::AssignIntrinsicRanks",
 * so the pane matches the order the symbol/footprint choosers use.
 *
 * The two `std::set`s also deduplicate, and a nickname that is somehow in both
 * the project's pinned list and the session's is inserted once.
 */
export function buildLibrariesList(
  nicknames: readonly string[],
  pinned: readonly string[] = [],
): string[] {
  const isPinned = new Set(pinned);
  const pinnedMatches = new Set<string>();
  const otherMatches = new Set<string>();

  for (const nickname of nicknames) {
    if (isPinned.has(nickname)) pinnedMatches.add(nickname);
    else otherMatches.add(nickname);
  }

  const sort = (set: Set<string>): string[] => [...set].sort((a, b) => strNumCmp(a, b, true));

  return [...sort(pinnedMatches).map((n) => PINNING_SYMBOL + n), ...sort(otherMatches)];
}

// ----- the context menus -----------------------------------------------------

/** What the rows run. Each is the TOOL_ACTION of the same name. */
export interface CvpcbContextMenuActions {
  /** `CVPCB_ACTIONS::showFootprintViewer` — show, never toggle. */
  showFootprintViewer: () => void;
  /** `ACTIONS::cut` / `copy` / `paste`, the clipboard commands in
   *  `tools/cvpcb_association_tool.ts`. */
  cut: () => void;
  copy: () => void;
  paste: () => void;
  /** `CVPCB_ACTIONS::deleteAssoc`. */
  deleteAssoc: () => void;
}

/**
 * `m_symbolsContextMenu` — the "Symbol : Footprint Assignments" pane's.
 *
 * The accelerators are the actions' own `DefaultHotkey`s, spelled the way the
 * menu draws them: `MD_CTRL + 'X' / 'C' / 'V'` (common/tool/actions.cpp:308-348)
 * and `WXK_DELETE` for `deleteAssoc` (cvpcb_actions.cpp:129-134).
 * `showFootprintViewer` declares none, so its row shows none.
 */
export function cvpcbSymbolsContextMenu(actions: CvpcbContextMenuActions): MenuItem[] {
  return [
    {
      label: 'View Selected Footprint',
      icon: 'cvpcbViewFootprint',
      action: actions.showFootprintViewer,
    },
    { sep: true },
    { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', action: actions.cut },
    { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: actions.copy },
    {
      // Ctrl+V is left to the browser's own paste event, the only reliable read
      // of the system clipboard — see MenuItem.nativeShortcut. The row still
      // declares the accelerator, because the menu draws it.
      label: 'Paste',
      icon: 'paste',
      shortcut: 'Ctrl+V',
      nativeShortcut: true,
      action: actions.paste,
    },
    { sep: true },
    {
      label: 'Delete Footprint Assignment',
      icon: 'cvpcbDeleteAssoc',
      shortcut: 'Delete',
      action: actions.deleteAssoc,
    },
  ];
}

/**
 * `m_footprintContextMenu` — the "Filtered Footprints" pane's, which is one
 * row and no separator.
 *
 * The library pane has no context menu at all: `setupEventHandlers` binds
 * `wxEVT_RIGHT_DOWN` on the footprint and symbol lists only.
 */
export function cvpcbFootprintsContextMenu(actions: CvpcbContextMenuActions): MenuItem[] {
  return [
    {
      label: 'View Selected Footprint',
      icon: 'cvpcbViewFootprint',
      action: actions.showFootprintViewer,
    },
  ];
}
