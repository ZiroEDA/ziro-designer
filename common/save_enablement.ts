// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Whether the top toolbar's Save button is greyed.
 *
 * **This is a deliberate divergence from upstream, and it is written down once
 * here rather than in each editor so that it stays one rule.**
 *
 * KiCad greys Save in no editor at all. Every frame registers it the same way:
 *
 *     mgr->SetConditions( ACTIONS::save, ENABLE( SELECTION_CONDITIONS::ShowAlways ) );
 *
 * — `eeschema/sch_edit_frame.cpp:796`, `pcbnew/pcb_edit_frame.cpp:1036`,
 * `pcbnew/footprint_edit_frame.cpp:1355`,
 * `eeschema/symbol_editor/symbol_edit_frame.cpp:529`,
 * `pagelayout_editor/pl_editor_frame.cpp:318`. `EDITOR_CONDITIONS::
 * ContentModified()` exists, but the only actions gated on it are
 * `ACTIONS::revert` (`footprint_edit_frame.cpp:1354`) and CVPCB's two
 * save-associations actions (`cvpcb_mainframe.cpp:300-301`) — never Save.
 *
 * The reason the divergence is wanted here and not there: KiCad writes only
 * when told to, so a lit Save is the standing offer to write. This app
 * autosaves — an edit is serialized into the project's coalesced write a
 * second or so later — so "everything is written down" is a real, reachable
 * state that KiCad does not have, and the Save button going grey is how the
 * user is told they have reached it. A Save that is lit forever cannot say
 * that.
 *
 * The Schematic Editor has behaved this way since its toolbar was built. The
 * PCB Editor did not, which is the inconsistency this module removes; its
 * previous comment cited `ShowAlways` and greyed nothing, which was right about
 * upstream and wrong about the rest of this app.
 */

/**
 * The toolbar's disabled-id set with Save added when there is nothing to write.
 *
 * @param base the frame's own disabled ids, from its `setupUIConditions` port.
 * @param modified whether an edit is still to be written down — the flag the
 *   frame title's `*` reads, so the button and the star can never disagree.
 */
export function withSaveEnablement(
  base: ReadonlySet<string> | undefined,
  modified: boolean,
): Set<string> {
  const s = new Set(base ?? []);
  if (!modified) s.add('save');
  return s;
}
