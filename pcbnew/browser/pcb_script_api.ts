// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import type { BOARD } from '../board.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';

/** What a host may do to the open board (PcbEditor's `registerScriptApi`). */
export interface PcbScriptApi {
  /** View > 3D Viewer: open the child 3D frame over the board. */
  show3D?(): void;
  /** The live board; edit it through a BOARD_COMMIT on `frame()`. */
  board(): BOARD | null;
  frame(): PCB_EDIT_FRAME | null;
  /** Tools > Update PCB from Schematic with the dialog's defaults plus
   *  "Delete footprints with no symbols", applied; the updater's report. */
  updateFromSchematic(): Promise<{ ok: boolean; report: string }>;
  /** Fill All Zones (PCB_ACTIONS::zoneFillAll). */
  fillZones(): void;
  /** A library footprint, ready to add (a fresh copy), or null. */
  loadFootprint(libId: string): Promise<FOOTPRINT | null>;
  /**
   * The interactive router (PNS) without the mouse: from `from` to `to` on
   * `layer`, clicking each of `through` on the way (walkaround, then shove,
   * either direction), committed only when it arrives; a route the router
   * could not finish is dropped, not left dangling. nm coordinates.
   */
  route(
    from: { x: number; y: number },
    to: { x: number; y: number },
    layer: string,
    through?: readonly { x: number; y: number }[],
  ): Promise<{ ok: boolean; reason: string }>;
}
