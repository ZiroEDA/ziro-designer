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
  /** SYMBOLS_LISTBOX's selection; -1 is `SetSelectedComponent( -1 )`, no row. */
  selected: number;
  /** `CVPCB_MAINFRAME::m_modified`. Set by every association, cleared only by
   *  a save. Deliberately *not* "the assignments differ from the file": an
   *  assignment undone back to where it started still leaves the frame
   *  modified upstream, because `AssociateFootprint` sets the flag before it
   *  looks at anything else. */
  modified: boolean;
}

export function emptyAssociations(selected = 0): CvpcbAssociations {
  return { assigned: new Map(), undoStack: [], redoStack: [], selected, modified: false };
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
    selected: state.selected,
    modified: true,
  };
}

/**
 * `CVPCB_ASSOCIATION_TOOL::Associate` — assign the selected footprint to the
 * selected symbol, then go to the next unassigned one.
 *
 * The `gotoNextNA` at the end is posted unconditionally: it runs whether or not
 * the association changed anything.
 */
export function associate(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  fpid: string,
): CvpcbAssociations {
  // "Ignore the action if the footprint is empty (nothing selected)."
  if (!fpid) return state;
  if (state.selected < 0) return state;
  return gotoNA(associateFootprint(state, components, state.selected, fpid), components, 1);
}

/** `CVPCB_ASSOCIATION_TOOL::DeleteAssoc` — clear the selected symbol's link. */
export function deleteAssoc(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
): CvpcbAssociations {
  if (state.selected < 0) return state;
  return associateFootprint(state, components, state.selected, '');
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

  let next: CvpcbAssociations = { ...state, selected: -1 };
  for (let i = 0; i < components.length; i++)
    next = associateFootprint(next, components, i, '', i === 0);

  return { ...next, selected: components.length > 0 ? 0 : -1 };
}

/** `CVPCB_CONTROL::ToNA` — select the next/previous unassociated symbol. */
export function gotoNA(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  dir: 1 | -1,
): CvpcbAssociations {
  const target = nextUnassociated(components.length, state.selected, dir, (i) =>
    Boolean(footprintOf(state, components[i])),
  );
  return target === null ? state : { ...state, selected: target };
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
    undoStack:
      direction === 'undo' ? state.undoStack.slice(0, -1) : [...state.undoStack, entry],
    redoStack:
      direction === 'undo' ? [...state.redoStack, entry] : state.redoStack.slice(0, -1),
    selected: state.selected,
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
  return { ...emptyAssociations(state.selected) };
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
