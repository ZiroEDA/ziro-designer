// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/tools/cvpcb_association_tool.cpp` (`CVPCB_ASSOCIATION_TOOL`):
 * Associate, DeleteAssoc, Cut / Copy / Paste and DeleteAll, as pure functions
 * over the frame's association state (`cvpcb_mainframe.ts`).
 */

// LIB_ID's own rules, from the one module that holds its character table. See
// `copyAssoc` / `pasteAssoc` below for which of Parse and IsValid each asks.
import { isValidLibId, libIdParseOffset, libItemName, libNickname } from '@ziroeda/eeschema';
import {
  associateFootprint,
  footprintOf,
  selectedComponent,
  type CvpcbAssociations,
  type CvpcbComponent,
  type CvpcbControl,
} from '../cvpcb_mainframe.js';
import { gotoNA } from './cvpcb_control.js';

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
