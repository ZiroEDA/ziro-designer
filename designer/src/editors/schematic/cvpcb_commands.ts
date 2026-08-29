// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
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
 */

import { nextUnassociated, type CvpcbComponent } from './cvpcb_components.js';
import { handleUnsavedChanges, type UnsavedChangesResult } from '../../ui/confirm.js';
// LIB_ID's own rules, from the one module that holds its character table. See
// `copyAssoc` / `pasteAssoc` below for which of Parse and IsValid each asks.
import { isValidLibId, libIdParseOffset, libItemName, libNickname } from '@ziroeda/eeschema';

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

/**
 * `CVPCB_ASSOCIATION_TOOL::Associate` — assign the selected footprint to
 * **every selected symbol**, then go to the next unassigned one.
 *
 *     bool firstAssoc = true;
 *
 *     for( unsigned int i : m_frame->GetComponentIndices( SEL_COMPONENTS ) )
 *     {
 *         m_frame->AssociateFootprint( CVPCB_ASSOCIATION( i, fpid ), firstAssoc );
 *         firstAssoc = false;
 *     }
 *
 * `firstAssoc` is `AssociateFootprint`'s `aNewEntry`, so the whole loop is one
 * undo entry: assigning one footprint to twelve decoupling capacitors is one
 * Ctrl+Z, not twelve. This used to read `state.selected` and assign to exactly
 * one symbol, which is the *visible* half of the single-select defect; the
 * invisible half is that a selection-state fix alone would have left this loop
 * assigning to the first row only.
 *
 * The `gotoNextNA` at the end is posted unconditionally: it runs whether or not
 * the association changed anything, and with nothing selected it is the only
 * thing that runs.
 */
export function associate(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  fpid: string,
): CvpcbAssociations {
  // "Ignore the action if the footprint is empty (nothing selected)."
  if (!fpid) return state;

  let next = state;
  let firstAssoc = true;
  for (const i of state.selection) {
    next = associateFootprint(next, components, i, fpid, firstAssoc);
    firstAssoc = false;
  }

  return gotoNA(next, components, 1);
}

/**
 * `CVPCB_ASSOCIATION_TOOL::DeleteAssoc` — "Delete all the selected components'
 * associations", the same `firstAssoc` loop over the whole selection, so a
 * multi-row delete is also one undo entry.
 */
export function deleteAssoc(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
): CvpcbAssociations {
  let next = state;
  let firstAssoc = true;
  for (const i of state.selection) {
    next = associateFootprint(next, components, i, '', firstAssoc);
    firstAssoc = false;
  }
  return next;
}

// ----- cut / copy / paste ---------------------------------------------------
//
// `ACTIONS::cut`, `ACTIONS::copy` and `ACTIONS::paste` are on cvpcb's Edit menu
// (menubar.cpp:53-62) and on the symbols pane's context menu
// (cvpcb_mainframe.cpp:272-279), and none of the three has an entry in
// `setupUIConditions` (`:284-329`) — so all three rows are ALWAYS enabled and
// every guard below is the command's own, taken silently. That is why nothing
// here returns a reason: upstream's `return 0` says nothing to the user either.
//
// What travels is a **footprint id as text**, not a KiCad clipboard payload:
// `wxTheClipboard->SetData( new wxTextDataObject( fpid.GetUniStringLibId() ) )`,
// and `GetUniStringLibId()` is `Format().wx_str()` — the nickname, a colon and
// the item name, i.e. the FPID string itself. So a copy out of cvpcb pastes
// into a text editor as `Resistor_THT:R_Axial_DIN0207`, and anything that
// spells a footprint id pastes into cvpcb.

/**
 * `CVPCB_ASSOCIATION_TOOL::CopyAssoc` — what Copy puts on the clipboard, or
 * null when it puts nothing there.
 *
 *     LIB_ID fpid;
 *
 *     if( m_frame->GetFocusedControl() == CVPCB_MAINFRAME::CONTROL_FOOTPRINT )
 *         fpid.Parse( m_frame->GetSelectedFootprint() );
 *     else if( m_frame->GetSelectedComponent() )
 *         fpid = m_frame->GetSelectedComponent()->GetFPID();
 *     else
 *         return 0;
 *
 *     if( !fpid.IsValid() )
 *         return 0;
 *
 * Two sources, and which one is used is decided by the FOCUS, not by what is
 * selected: with the footprint pane focused Copy takes the footprint the pane
 * is pointing at — which is how you copy an id you have not assigned to
 * anything yet — and from anywhere else it takes the selected symbol's current
 * FPID. The library pane and the filter box both fall into the second branch.
 *
 * `IsValid()` is both halves non-empty (lib_id.h:172), so an unassigned symbol
 * copies nothing at all rather than an empty string, and the clipboard keeps
 * whatever was already on it.
 */
export function copyAssoc(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  focus: CvpcbControl | null,
  selectedFootprint: string,
): string | null {
  const fpid =
    focus === 'footprint'
      ? selectedFootprint
      : footprintOf(state, components[selectedComponent(state)]);

  // `fpid.Parse( s )` then `fpid.IsValid()`: Parse leaves the item name unset
  // when it trips, so the pair is exactly "a nickname and an item name, neither
  // empty, no illegal character in either" — which is `isValidLibId`.
  return isValidLibId(fpid) ? fpid : null;
}

/**
 * `CVPCB_ASSOCIATION_TOOL::CutAssoc` — Copy, then clear ONE association.
 *
 * Three things about it are easy to write the other way round and all three are
 * load-bearing:
 *
 *  - **Cut only works in the symbols pane.** `if( m_frame->GetFocusedControl()
 *    && m_frame->GetFocusedControl() != CONTROL_COMPONENT ) return 0;` — a
 *    truthy focus that is not the symbols list bails, and `CONTROL_NONE` (0,
 *    listboxes.h's enum starts there) does not, so Cut still works with the
 *    focus nowhere. That is the comment's *"If using the keyboard, only cut in
 *    the component frame"*: it stops Ctrl+X in the footprint pane from silently
 *    deleting an assignment you were not looking at.
 *  - **it clears `idx.front()` only.** Copy and Associate and Delete all loop
 *    over the whole selection; Cut writes `AssociateFootprint( CVPCB_ASSOCIATION(
 *    idx.front(), "" ) )` once. Cutting a three-row selection empties the first
 *    row and leaves the other two assigned.
 *  - **an invalid FPID stops it before the clear.** The order upstream is
 *    read, validate, write to the clipboard, and only then clear — so Cut on an
 *    unassigned symbol is a no-op rather than a clear-and-lose.
 *
 * Returns both halves because the caller owns the clipboard: `clipboard` is
 * null when nothing is to be written, and `state` is unchanged in that case.
 */
export function cutAssoc(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  focus: CvpcbControl | null,
): { clipboard: string | null; state: CvpcbAssociations } {
  const unchanged = { clipboard: null, state };

  if (focus !== null && focus !== 'symbol') return unchanged;

  const index = selectedComponent(state);
  const comp = components[index];
  if (index < 0 || !comp) return unchanged;

  const fpid = footprintOf(state, comp);
  if (!isValidLibId(fpid)) return unchanged;

  return { clipboard: fpid, state: associateFootprint(state, components, index, '') };
}

/**
 * `CVPCB_ASSOCIATION_TOOL::PasteAssoc` — assign the clipboard's footprint id to
 * **every selected symbol**, as one undo entry.
 *
 *     if( fpid.Parse( data.GetText() ) >= 0 )
 *         return 0;
 *
 *     bool firstAssoc = true;
 *
 *     for( unsigned int i : idx )
 *     {
 *         m_frame->AssociateFootprint( CVPCB_ASSOCIATION( i, fpid ), firstAssoc );
 *         firstAssoc = false;
 *     }
 *
 * The guard is `Parse`, **not** `IsValid` — unlike Copy, which asks both. Paste
 * therefore accepts anything a LIB_ID can hold, including two cases that are
 * not typos and are reachable from a real clipboard:
 *
 *  - a bare item name with no nickname (`IsLegacy()`), which is assigned as it
 *    stands;
 *  - the **empty string**, which parses and clears the selection's
 *    associations. Pasting an empty clipboard over three symbols unassigns all
 *    three, in one Ctrl+Z. Ours does the same rather than quietly adding the
 *    `IsValid` guard Copy has, because the asymmetry is the upstream code.
 *
 * Text that is *not* a parseable id — anything carrying a tab, a newline, a
 * second colon, or one of `\ < > "` — is dropped without touching anything,
 * which is what stops a paragraph of prose from becoming a footprint name.
 *
 * `idx.empty()` is checked before the clipboard is read at all, so Paste with
 * no symbol selected does nothing and does not even ask for the clipboard.
 *
 * What is assigned is `fpid`, the *parsed* id, not the text that was on the
 * clipboard — and `LIB_ID::Format()` (common/lib_id.cpp) writes the colon back
 * only `if( m_libraryName.size() )`. The two differ for exactly one input, a
 * leading colon: `":R"` parses to an empty nickname and the item name `R`, and
 * is assigned as `R`.
 */
export function pasteAssoc(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  text: string,
): CvpcbAssociations {
  if (state.selection.length === 0) return state;
  if (libIdParseOffset(text) >= 0) return state;

  const nickname = libNickname(text);
  const name = libItemName(text);
  const fpid = nickname ? `${nickname}:${name}` : name;

  let next = state;
  let firstAssoc = true;
  for (const i of state.selection) {
    next = associateFootprint(next, components, i, fpid, firstAssoc);
    firstAssoc = false;
  }
  return next;
}

/** `IsOK( m_frame, _( "Delete all associations?" ) )`. */
export const DELETE_ALL_CONFIRMATION = 'Delete all associations?';

/**
 * `CVPCB_ASSOCIATION_TOOL::DeleteAll` — clear every association, as one undo
 * step, behind a confirmation.
 *
 * The confirmation is unconditional: upstream asks even when nothing is
 * assigned and there is nothing to lose, so the button never silently does
 * nothing and the answer always means the same thing.
 *
 * The selection is dropped before the FPIDs are rewritten ("Remove all
 * selections to avoid issues when setting the fpids") and the first symbol is
 * selected afterwards - `SetSelectedComponent( 0 )` on an empty list selects
 * nothing.
 */
export function deleteAll(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  isOk: (message: string) => boolean,
): CvpcbAssociations {
  if (!isOk(DELETE_ALL_CONFIRMATION)) return state;

  let next: CvpcbAssociations = { ...state, selection: [] };
  for (let i = 0; i < components.length; i++)
    next = associateFootprint(next, components, i, '', i === 0);

  return { ...next, selection: components.length > 0 ? [0] : [] };
}

/**
 * `CVPCB_CONTROL::ToNA` — select the next/previous unassociated symbol.
 *
 * With nothing selected `tempSel` is empty, so `newSel` keeps its `UINT_MAX`
 * initial value and the forward scan can never match, while the backward scan
 * is inside `if( !tempSel.empty() )` — nowhere to go in either direction. That
 * state is reachable now that the window can open with no row selected (every
 * symbol already assigned, `readwrite_dlgs.cpp:271-274`).
 */
export function gotoNA(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  dir: 1 | -1,
): CvpcbAssociations {
  const current = selectedComponent(state);
  if (current < 0) return state;

  const target = nextUnassociated(components.length, current, dir, (i) =>
    Boolean(footprintOf(state, components[i])),
  );
  return target === null ? state : { ...state, selection: [target] };
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

// ----- saving ---------------------------------------------------------------

/** `SetStatusText( _( "Schematic saved" ), 1 )` — the second status line. */
export const SCHEMATIC_SAVED_STATUS = 'Schematic saved';

/** What a save command asks the frame to do. */
export interface CvpcbSaveEffect {
  /** `ExpressMail( FRAME_SCH, MAIL_ASSIGN_FOOTPRINTS )`: hand the links to
   *  eeschema, which applies them to the open schematic — and leaves it dirty,
   *  so they are still on its undo stack. Always sent. */
  assign: boolean;
  /** `ExpressMail( FRAME_SCH, MAIL_SCH_SAVE )`: write the `.kicad_sch` files.
   *  Sent only by "Apply, Save Schematic & Continue". */
  saveSchematic: boolean;
  /** Status line 2 after the save, or null to leave what DisplayStatus put
   *  there. */
  status: string | null;
}

/** A save command: its effect, and whether the window goes away afterwards. */
export interface CvpcbSaveCommand {
  effect: CvpcbSaveEffect;
  close: boolean;
}

/** `CVPCB_MAINFRAME::SaveFootprintAssociation( bool doSaveSchematic )`. */
export function saveFootprintAssociation(doSaveSchematic: boolean): CvpcbSaveEffect {
  return {
    assign: true,
    saveSchematic: doSaveSchematic,
    status: doSaveSchematic ? SCHEMATIC_SAVED_STATUS : null,
  };
}

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
 * `CVPCB_CONTROL::ChangeFocus` (tools/cvpcb_control.cpp:96-144) — Tab / → move
 * the focus one pane to the right and wrap, Shift+Tab / ← one to the left:
 *
 *     CHANGE_FOCUS_RIGHT: library → symbol → footprint → library
 *     CHANGE_FOCUS_LEFT:  library → footprint → symbol → library
 *
 * The keys are two halves of the same command. `CVPCB_ACTIONS::changeFocusRight`
 * / `changeFocusLeft` (tools/cvpcb_actions.cpp:80-92) carry
 * `.DefaultHotkey( WXK_TAB )` and `.DefaultHotkey( MD_SHIFT + WXK_TAB )`, and
 * `CVPCB_CONTROL::Main` (`:64-92`) posts the same two actions for `WXK_RIGHT`
 * and `WXK_LEFT`. Neither pair existed here: the three panes were not even
 * focusable, so the whole window could only be driven with the mouse.
 *
 * `CONTROL_NONE` - the focus is on the toolbar's search box, or nowhere - falls
 * through both switches and does nothing.
 */
export function changeFocus(
  current: CvpcbControl | null,
  dir: 'right' | 'left',
): CvpcbControl | null {
  if (current === null) return null;

  if (dir === 'right') {
    if (current === 'library') return 'symbol';
    if (current === 'symbol') return 'footprint';
    return 'library';
  }

  if (current === 'library') return 'footprint';
  if (current === 'symbol') return 'library';
  return 'symbol';
}
