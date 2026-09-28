// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/readwrite_dlgs.cpp`: `CVPCB_MAINFRAME::SaveFootprintAssociation`,
 * what a save asks the frame to send. See `cvpcb_mainframe.ts` for why saving
 * is two separate things.
 */

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
