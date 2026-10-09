// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB editor's clipboard: cut, copy, copy-with-reference, paste and paste
 * special, as pure functions over the typed `Board`.
 *
 * Counterparts:
 *   - `pcbnew/kicad_clipboard.cpp` — `CLIPBOARD_IO::SaveSelection` (:119) writes
 *     the payload, `CLIPBOARD_IO::Parse` (:460) reads it back.
 *   - `pcbnew/tools/edit_tool.cpp` — `EDIT_TOOL::copyToClipboard` (:3535) picks
 *     the reference point and filters the selection; `EDIT_TOOL::cutToClipboard`
 *     (:3692) is copy followed by Remove.
 *   - `pcbnew/tools/pcb_control.cpp` — `PCB_CONTROL::Paste` (:1077) chooses the
 *     paste mode and remaps nets; `PCB_CONTROL::pruneItemLayers` (:1007) drops
 *     items whose layers this board does not have; `PCB_CONTROL::placeBoardItems`
 *     (:1970) re-stamps identifiers and hands the result to the move tool.
 *   - `common/dialogs/dialog_paste_special.cpp` and
 *     `include/dialogs/dialog_paste_special.h` — the `PASTE_MODE` enum and the
 *     "Clear net assignments" checkbox that `ACTIONS::pasteSpecial` adds over
 *     `ACTIONS::paste`.
 *
 * The clipboard payload is *text* — a `.kicad_pcb` document, or a bare
 * `(footprint …)` when exactly one footprint is copied — because that is what
 * KiCad puts on the system clipboard and the two applications have to
 * interoperate through it. Serialization goes through `PCB_IO_KICAD_SEXPR`
 * with `CTL_FOR_CLIPBOARD` and back through the board parser — the same pair
 * `SaveSelection` and `CLIPBOARD_IO::Parse` use.
 *
 * Nothing here touches the DOM, `navigator.clipboard`, React or the tool
 * manager. The caller owns the actual clipboard I/O (which is asynchronous in a
 * browser and permission-gated, unlike wxTheClipboard) and owns the interactive
 * placement that upstream runs inside `placeBoardItems`; every function here is
 * synchronous and returns a new `Board` rather than mutating one.
 *
 * ## What is not ported, and why
 *
 *  - **The footprint editor's clipboard.** `pasteFootprintItemsToFootprintEditor`
 *    (pcb_control.cpp:926) reparents a pasted footprint's children onto the
 *    footprint being edited, un-rotating and re-rotating each one across the two
 *    orientations. That is FOOTPRINT_EDIT_FRAME's clipboard, not the board's,
 *    and it belongs beside `edit-footprint.ts`.
 *  - **Pasting into a table's cells.** `PCB_EDIT_TABLE_TOOL::pasteCellsIntoSelection`
 *    (reached from pcb_control.cpp:1121 when the selection holds PCB_TABLECELL_T)
 *    and `SaveSelection`'s matching `deleteUnselectedCells`, which crops a copied
 *    table down to the selected block. Our selection ids reach a table but not
 *    its cells (`BOARD_ITEM_KINDS` has no `tablecell`), so there is no selection
 *    to crop to or paste into.
 *  - **`ACTIONS::copyAsText`** (`EDIT_TOOL::copyToClipboardAsText`,
 *    edit_tool.cpp:3594). A separate context-menu row with a separate payload —
 *    plain text, tab/newline separated for a table — not part of this one.
 *  - **The non-payload paste fallbacks.** When the clipboard does not parse,
 *    upstream pastes a bitmap as a PCB_REFERENCE_IMAGE or the raw text as a
 *    PCB_TEXT (pcb_control.cpp:1165), and warns above
 *    `ADVANCED_CFG::m_MaxPastedTextLength`. Both need the system clipboard's
 *    other flavours, which only the caller can see; {@link parseClipboardText}
 *    returning `null` is the signal to do it.
 *  - **The entered group.** `placeBoardItems` adds pasted items to
 *    `PCB_SELECTION_TOOL::GetEnteredGroup()` when the user has stepped inside a
 *    group. That is live tool state, not board state.
 *  - **`PCB_DIMENSION_BASE::UpdateUnits()`** and
 *    **`FOOTPRINT::ResolveComponentClassNames`**, both in `placeBoardItems`'s
 *    per-item pass: the first re-resolves an *automatic* dimension unit against
 *    the frame's display units, which we have no frame to ask; the second needs
 *    component classes, which our board model does not carry.
 *  - **PCB_GENERATOR** items (tuning patterns and the like) have no counterpart
 *    in our model, so their `DeepClone` branch has nothing to port to.
 */

import { newKiid } from '@ziroeda/common/kiid.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import {
  CTL_FOR_CLIPBOARD,
  MAJOR_MINOR_VERSION,
  PCB_IO_KICAD_SEXPR,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { SEXPR_BOARD_FILE_VERSION } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { FORMAT_MODE } from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import { GENERATOR } from '@ziroeda/common/generator.js';
import { GetClipboardText, SaveClipboard } from '@ziroeda/common/clipboard.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import { FOOTPRINT as FOOTPRINT_CLASS } from './footprint.js';
import type { PAD } from './pad.js';
import type { PCB_FIELD } from './pcb_field.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_GENERATOR } from './pcb_generator.js';
import { PCB_TEXT } from './pcb_text.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TABLECELL } from './pcb_tablecell.js';
import type { PCB_SELECTION } from './tools/pcb_selection.js';

// ----- paste-special options --------------------------------------------------

/**
 * `PASTE_MODE` (include/dialogs/dialog_paste_special.h:33), the three choices in
 * the "Reference Designators" radio box of DIALOG_PASTE_SPECIAL. The dialog's
 * own labels are quoted so a caller building the dialog does not re-invent them
 * (common/dialogs/dialog_paste_special_base.cpp:22):
 *
 *   - `unique_annotations`  "Assign unique reference designators to pasted symbols"
 *   - `keep_annotations`    "Keep existing reference designators, even if they are duplicated"
 *   - `remove_annotations`  "Clear reference designators on all pasted symbols"
 */
export const PASTE_MODES = [
  'unique_annotations',
  'keep_annotations',
  'remove_annotations',
] as const;

export type PasteMode = (typeof PASTE_MODES)[number];

/**
 * `PCB_CONTROL::Paste`'s `defaultRef` (pcb_control.cpp:1210). A plain
 * `ACTIONS::paste` never uses it — `mode` starts at `KEEP_ANNOTATIONS` and only
 * DIALOG_PASTE_SPECIAL can move it — so this is the string
 * `remove_annotations` writes into every pasted footprint's Reference.
 */
export const PASTE_DEFAULT_REFERENCE = 'REF**';

export interface PasteOptions {
  /**
   * Which of DIALOG_PASTE_SPECIAL's three annotation choices to apply. Upstream
   * initialises `PASTE_MODE mode = PASTE_MODE::KEEP_ANNOTATIONS` before the
   * dialog is even shown, so a plain `ACTIONS::paste` — which never shows it —
   * is exactly this default (pcb_control.cpp:1208).
   */
  mode?: PasteMode;
  /**
   * The dialog's "Clear net assignments" checkbox. When set, every connected
   * item lands with no net at all rather than being matched into the
   * destination board's netlist:
   *
   *     for( BOARD_CONNECTED_ITEM* item : clipBoard->AllConnectedItems() )
   *         item->SetNet( NETINFO_LIST::OrphanedItem() );
   *
   * `OrphanedItem()` is a NETINFO_ITEM built with `NETINFO_LIST::UNCONNECTED`
   * (netinfo.h:255), i.e. net code 0 and an empty name — so "clear" really is
   * "unconnected", not a sentinel. The checkbox is hidden for a footprint
   * payload (`if( clipItem->Type() != PCB_T ) dlg.HideClearNets()`), which is
   * why {@link ParsedClipboard.form} is reported to the caller.
   */
  clearNets?: boolean;
  /**
   * Where the payload's origin lands, in board internal units.
   *
   * Upstream has no such parameter: `placeBoardItems` sets the selection's
   * reference point to (0,0) and then runs `PCB_ACTIONS::move` synchronously,
   * so the pasted items hang off the cursor until the user clicks. We cannot
   * block on a mouse click inside a pure function, so the caller drives that
   * interaction and tells us where the drop happened. Omitted means (0,0),
   * which is the payload exactly as copied.
   */
  offset?: Vec2;
}

/**
 * `CLIPBOARD_IO` (kicad_clipboard.h/.cpp), the writing half, on the live BOARD:
 * `SaveSelection` formats the selection the way KiCad puts it on the system
 * clipboard. The reading half (`Parse`, `PCB_CONTROL::Paste`) is still the
 * view-board functions above (TRANSITIONAL, #636 stage 3: with PCB_CONTROL).
 */
export class CLIPBOARD_IO {
  private m_board: BOARD | null = null;
  /** `m_writer`: where the formatted text goes. `SaveClipboard` upstream. */
  m_writer: (aText: string) => void = (aText) => {
    SaveClipboard(aText);
  };

  /** `m_reader`: where the text to parse comes from. `clipboardReader` upstream. */
  m_reader: () => string = () => GetClipboardText() ?? '';

  SetBoard(aBoard: BOARD | null): void {
    this.m_board = aBoard;
  }

  /**
   * `CLIPBOARD_IO::Parse` (kicad_clipboard.cpp:460-474): the clipboard text as a
   * board or a footprint, or null when it is neither.
   */
  Parse(): BOARD_ITEM | null {
    const result = this.m_reader();

    try {
      return new PCB_IO_KICAD_SEXPR_PARSER(result, 'clipboard').Parse();
    } catch {
      return null;
    }
  }

  /** `CLIPBOARD_IO::SaveSelection( const PCB_SELECTION&, bool )` (kicad_clipboard.cpp:115). */
  SaveSelection(aSelected: PCB_SELECTION, isFootprintEditor: boolean): void {
    let refPoint = { x: 0, y: 0 };

    // dont even start if the selection is empty
    if (aSelected.Empty()) return;

    if (aSelected.HasReferencePoint()) refPoint = aSelected.GetReferencePoint();

    const board = this.m_board!;
    const formatter = new PRETTIFIED_STRING_FORMATTER(FORMAT_MODE.COMPACT_TEXT_PROPERTIES);
    const io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_CLIPBOARD, GENERATOR);

    io.SetBoard(board);

    const Format = (aItem: BOARD_ITEM): void => io.Format(aItem);
    const back = { x: -refPoint.x, y: -refPoint.y };

    const deleteUnselectedCells = (aTable: PCB_TABLE): void => {
      let minCol = aTable.GetColCount();
      let maxCol = -1;
      let minRow = aTable.GetRowCount();
      let maxRow = -1;

      for (let row = 0; row < aTable.GetRowCount(); ++row) {
        for (let col = 0; col < aTable.GetColCount(); ++col) {
          const cell = aTable.GetCell(row, col)!;

          if (cell.IsSelected()) {
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
          } else {
            cell.SetFlags(STRUCT_DELETED);
          }
        }
      }

      if (!(maxCol >= minCol && maxRow >= minRow)) return; // No selected cells!

      // aTable is always a clone in the clipboard case
      let destRow = 0;

      for (let row = minRow; row <= maxRow; row++)
        aTable.SetRowHeight(destRow++, aTable.GetRowHeight(row));

      let destCol = 0;

      for (let col = minCol; col <= maxCol; col++)
        aTable.SetColWidth(destCol++, aTable.GetColWidth(col));

      aTable.DeleteMarkedCells();
      aTable.SetColCount(maxCol - minCol + 1);
      aTable.Normalize();
    };

    const promotedTables = new Set<PCB_TABLE>();

    const parentIsPromoted = (cell: PCB_TABLECELL): boolean => {
      for (const table of promotedTables) {
        if (table.m_Uuid === cell.GetParent()!.m_Uuid) return true;
      }

      return false;
    };

    if (aSelected.Size() === 1 && aSelected.Front()!.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      // make the footprint safe to transfer to other pcbs
      const footprint = aSelected.Front() as unknown as FOOTPRINT;
      // Do not modify existing board
      const newFootprint = footprint.Clone() as FOOTPRINT;

      for (const pad of newFootprint.Pads()) pad.SetNetCode(0);

      // locked means "locked in place"; copied items therefore can't be locked
      newFootprint.SetLocked(false);

      // locate the reference point at (0, 0) in the copied items
      newFootprint.Move(back);

      Format(newFootprint);

      newFootprint.SetParent(null);
      newFootprint.SetParentGroup(null);
    } else if (isFootprintEditor) {
      const partialFootprint = new FOOTPRINT_CLASS(board);

      // Useful to copy the selection to the board editor (if any), and provides
      // a dummy lib id.
      // Perhaps not a good Id, but better than a empty id
      partialFootprint.SetFPID(new LIB_ID('clipboard', newKiid()));

      for (const item of aSelected) {
        if (!item.IsBOARD_ITEM()) continue;

        const boardItem = item as unknown as BOARD_ITEM;
        let copy: BOARD_ITEM | null = null;

        if (item.Type() === KICAD_T.PCB_FIELD_T && (item as unknown as PCB_FIELD).IsMandatory())
          continue;

        if (boardItem.Type() === KICAD_T.PCB_GROUP_T) {
          copy = (boardItem as PCB_GROUP).DeepClone();
        } else if (boardItem.Type() === KICAD_T.PCB_GENERATOR_T) {
          copy = (boardItem as PCB_GENERATOR).DeepClone();
        } else if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
          if (parentIsPromoted(item as unknown as PCB_TABLECELL)) continue;

          copy = item.GetParent()!.Clone() as unknown as BOARD_ITEM;
          promotedTables.add(copy as PCB_TABLE);
        } else {
          copy = boardItem.Clone() as BOARD_ITEM;
        }

        // If it is only a footprint, clear the nets from the pads
        if (copy.Type() === KICAD_T.PCB_PAD_T) (copy as PAD).SetNetCode(0);

        // Don't copy group membership information for the 1st level objects being copied
        // since the group they belong to isn't being copied.
        copy.SetParentGroup(null);

        // Add the pad to the new footprint before moving to ensure the local coords are
        // correct
        partialFootprint.Add(copy);

        // A list of not added items, when adding items to the footprint
        // some PCB_TEXT (reference and value) cannot be added to the footprint
        const skipped_items: BOARD_ITEM[] = [];

        // Will catch at least PCB_GROUP_T and PCB_GENERATOR_T
        if (copy.Type() === KICAD_T.PCB_GROUP_T || copy.Type() === KICAD_T.PCB_GENERATOR_T) {
          copy.RunOnChildren((descendant: BOARD_ITEM) => {
            // One cannot add an additional mandatory field to a given footprint:
            // only one is allowed. So add only non-mandatory fields.
            let can_add = true;

            if (item.Type() === KICAD_T.PCB_FIELD_T && (item as unknown as PCB_FIELD).IsMandatory())
              can_add = false;

            if (can_add) partialFootprint.Add(descendant);
            else skipped_items.push(descendant);
          }, RECURSE_MODE.RECURSE);
        }

        // locate the reference point at (0, 0) in the copied items
        copy.Move(back);

        // Now delete items, duplicated but not added:
        for (const skipped_item of skipped_items) {
          (copy as PCB_GROUP).RemoveItem(skipped_item);
          skipped_item.SetParentGroup(null);
        }
      }

      // Set the new relative internal local coordinates of copied items
      const editedFootprint = board.Footprints()[0]!;
      const p = partialFootprint.GetPosition();
      const e = editedFootprint.GetPosition();
      partialFootprint.MoveAnchorPosition({ x: p.x + e.x, y: p.y + e.y });

      for (const table of promotedTables) deleteUnselectedCells(table);

      Format(partialFootprint);

      partialFootprint.SetParent(null);
    } else {
      // we will fake being a .kicad_pcb to get the full parser kicking
      // This means we also need layers and nets
      formatter.Print(
        `(kicad_pcb (version ${SEXPR_BOARD_FILE_VERSION}) (generator ${formatter.Quotew(GENERATOR)}) (generator_version ${formatter.Quotew(MAJOR_MINOR_VERSION)})`,
      );

      io.FormatBoardLayers(board);

      for (const item of aSelected) {
        if (!item.IsBOARD_ITEM()) continue;

        const boardItem = item as unknown as BOARD_ITEM;
        let copy: BOARD_ITEM | null = null;

        if (boardItem.Type() === KICAD_T.PCB_FIELD_T) {
          const field = boardItem as unknown as PCB_FIELD;
          const textItem = new PCB_TEXT(board);

          textItem.SetPosition(field.GetPosition());
          textItem.SetLayer(field.GetLayer());
          textItem.SetHyperlink(field.GetHyperlink());
          textItem.SetText(field.GetText());
          textItem.SetAttributes(field.GetAttributes());
          textItem.SetTextAngle(field.GetDrawRotation());

          if (textItem.GetText() === '${VALUE}')
            textItem.SetText(boardItem.GetParentFootprint()!.GetValue());
          else if (textItem.GetText() === '${REFERENCE}')
            textItem.SetText(boardItem.GetParentFootprint()!.GetReference());

          copy = textItem;
        } else if (boardItem.Type() === KICAD_T.PCB_TEXT_T) {
          const textItem = boardItem.Clone() as PCB_TEXT;

          if (textItem.GetText() === '${VALUE}')
            textItem.SetText(boardItem.GetParentFootprint()!.GetValue());
          else if (textItem.GetText() === '${REFERENCE}')
            textItem.SetText(boardItem.GetParentFootprint()!.GetReference());

          copy = textItem;
        } else if (boardItem.Type() === KICAD_T.PCB_GROUP_T) {
          copy = (boardItem as PCB_GROUP).DeepClone();
        } else if (boardItem.Type() === KICAD_T.PCB_GENERATOR_T) {
          copy = (boardItem as PCB_GENERATOR).DeepClone();
        } else if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
          if (parentIsPromoted(item as unknown as PCB_TABLECELL)) continue;

          copy = item.GetParent()!.Clone() as unknown as BOARD_ITEM;
          promotedTables.add(copy as PCB_TABLE);
        } else {
          copy = boardItem.Clone() as BOARD_ITEM;
        }

        if (copy) {
          if (copy.Type() === KICAD_T.PCB_FIELD_T || copy.Type() === KICAD_T.PCB_PAD_T) {
            // Create a parent footprint to own the copied item
            const footprint = new FOOTPRINT_CLASS(board);

            footprint.SetPosition(copy.GetPosition());
            footprint.Add(copy);

            // Convert any mandatory fields to user fields.  The destination footprint
            // will already have its own mandatory fields.
            if (copy.Type() === KICAD_T.PCB_FIELD_T) {
              const field = copy as unknown as PCB_FIELD;

              if (field.IsMandatory()) field.SetOrdinal(footprint.GetNextFieldOrdinal());
            }

            copy = footprint;
          }

          copy.SetLocked(false);
          copy.SetParent(board);
          copy.SetParentGroup(null);

          // locate the reference point at (0, 0) in the copied items
          copy.Move(back);

          if (copy.Type() === KICAD_T.PCB_TABLE_T) {
            const table = copy as PCB_TABLE;

            if (promotedTables.has(table)) deleteUnselectedCells(table);
          }

          Format(copy);

          if (copy.Type() === KICAD_T.PCB_GROUP_T || copy.Type() === KICAD_T.PCB_GENERATOR_T) {
            copy.RunOnChildren((descendant: BOARD_ITEM) => {
              descendant.SetLocked(false);
              Format(descendant);
            }, RECURSE_MODE.RECURSE);
          }
        }
      }

      formatter.Print(')');
    }

    // These are placed at the end to minimize the open time of the clipboard
    this.m_writer(formatter.Finish());
  }
}
