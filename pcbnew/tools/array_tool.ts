// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARRAY_TOOL` (pcbnew/tools/array_tool.cpp), board editor side: what the
 * Create Array dialog's close does to a live PCB_SELECTION -
 * `onDialogClosed`, one BOARD_COMMIT.
 *
 * `CreateArray` itself (the RequestSelection filters and the dialog's origin)
 * belongs with the selection tool, #636 stage 3; the caller hands over the
 * selection and the dialog's ARRAY_OPTIONS. The footprint editor's branch
 * (DuplicateItem inside the one footprint, ARRAY_PAD_NUMBER_PROVIDER's pad
 * numbering) is not ported yet: this is the board editor's tool.
 */
import type { ARRAY_OPTIONS } from '@ziroeda/common/array_options.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_GROUP } from '../pcb_group.js';
import { BOARD_REANNOTATE_TOOL } from './board_reannotate_tool.js';
import { PCB_SELECTION } from './pcb_selection.js';

/**
 * `TransformItem` (array_tool.cpp:44-50): move the item by the array
 * position's offset, then turn it about its own new position.
 */
function TransformItem(aArrOpts: ARRAY_OPTIONS, aIndex: number, aItem: BOARD_ITEM): void {
  const transform = aArrOpts.GetTransform(aIndex, aItem.GetPosition());

  aItem.Move(transform.m_offset);
  aItem.Rotate(aItem.GetPosition(), transform.m_rotation);
}

/** The types the board editor duplicates (array_tool.cpp:283-302). */
const DUPLICATED: ReadonlySet<KICAD_T> = new Set([
  KICAD_T.PCB_FOOTPRINT_T,
  KICAD_T.PCB_SHAPE_T,
  KICAD_T.PCB_BARCODE_T,
  KICAD_T.PCB_REFERENCE_IMAGE_T,
  KICAD_T.PCB_TEXT_T,
  KICAD_T.PCB_TEXTBOX_T,
  KICAD_T.PCB_TABLE_T,
  KICAD_T.PCB_TRACE_T,
  KICAD_T.PCB_ARC_T,
  KICAD_T.PCB_VIA_T,
  KICAD_T.PCB_DIM_ALIGNED_T,
  KICAD_T.PCB_DIM_CENTER_T,
  KICAD_T.PCB_DIM_RADIAL_T,
  KICAD_T.PCB_DIM_ORTHOGONAL_T,
  KICAD_T.PCB_DIM_LEADER_T,
  KICAD_T.PCB_POINT_T,
  KICAD_T.PCB_TARGET_T,
  KICAD_T.PCB_ZONE_T,
]);

export class ARRAY_TOOL {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;

  constructor(aFrame: PCB_BASE_EDIT_FRAME) {
    this.m_frame = aFrame;
  }

  /**
   * `onDialogClosed` (array_tool.cpp:115-408), board editor. Returns what
   * upstream then selects: every item added, then the originals.
   *
   * Arrange mode moves the selected items (a footprint child stands for its
   * footprint, once) onto successive array positions, all starting from the
   * first item's position: "Arrange selection". Otherwise the array
   * positions are walked in reverse, so the originals go last and take the
   * array's last position, while each earlier block duplicates them (groups
   * deep-duplicated with fresh UUIDs) onto its own position; with
   * reannotation on, every block after the first renumbers its footprints'
   * clashing references against the board and the blocks before it: "Create
   * Array".
   */
  onDialogClosed(aSelection: PCB_SELECTION, aArrayOpts: ARRAY_OPTIONS): EDA_ITEM[] {
    const commit = new BOARD_COMMIT(this.m_frame);
    const arraySize = aArrayOpts.GetArraySize();

    if (aArrayOpts.ShouldArrangeSelection()) {
      const fpDeDupe = new Set<FOOTPRINT>();
      const sortedSelection = aSelection.GetItemsSortedBySelectionOrder();
      let selectionIndex = 0;
      let firstItem: BOARD_ITEM | null = null;

      for (let arrayIndex = 0; arrayIndex < arraySize; ++arrayIndex) {
        let item: BOARD_ITEM | null = null;

        // Get the next valid item to arrange
        for (; selectionIndex < sortedSelection.length; selectionIndex++) {
          item = null;

          const candidate = sortedSelection[selectionIndex]!;

          if (!candidate.IsBOARD_ITEM()) continue;

          item = candidate as BOARD_ITEM;

          const parentFootprint = item.GetParentFootprint() as FOOTPRINT | null;

          // If it is not the footprint editor, then move the parent footprint instead.
          if (parentFootprint) {
            if (!fpDeDupe.has(parentFootprint)) {
              fpDeDupe.add(parentFootprint);
              item = parentFootprint;
            } else {
              item = null;
              continue;
            }
          }

          // Found a valid item
          selectionIndex++;
          break;
        }

        // Must be out of items to arrange, we're done
        if (item === null) break;

        commit.Modify(item, null, RECURSE_MODE.RECURSE);

        // Transform is a relative move, so when arranging the transform needs to start from
        // the same point for each item, e.g. the first item's position
        if (firstItem === null) firstItem = item;
        else item.SetPosition(firstItem.GetPosition());

        TransformItem(aArrayOpts, arrayIndex, item);
      }

      // Make sure we did something...
      if (firstItem !== null) commit.Push('Arrange selection');

      return [];
    }

    const will_reannotate = aArrayOpts.ShouldReannotateFootprints();
    const all_added_items: EDA_ITEM[] = [];
    const reannotate = new BOARD_REANNOTATE_TOOL(this.m_frame.GetBoard()!);

    // Iterate in reverse so the original items go last, and we can
    // use them for the positions of the clones.
    for (let ptN = arraySize - 1; ptN >= 0; --ptN) {
      const items_for_this_block = new PCB_SELECTION();
      const fpDeDupe = new Set<FOOTPRINT>();

      for (const eda_item of aSelection) {
        if (!eda_item.IsBOARD_ITEM()) continue;

        let item = eda_item as BOARD_ITEM;
        const parentFootprint = item.GetParentFootprint() as FOOTPRINT | null;

        // If it is not the footprint editor, then duplicate the parent footprint instead.
        if (parentFootprint) {
          if (fpDeDupe.has(parentFootprint)) continue;

          fpDeDupe.add(parentFootprint);
          item = parentFootprint;
        }

        let this_item: BOARD_ITEM | null = null;

        if (ptN === 0) {
          // the first point: we don't own this or add it, but
          // we might still modify it (position or label)
          this_item = item;

          commit.Modify(this_item, null, RECURSE_MODE.RECURSE);

          TransformItem(aArrayOpts, arraySize - 1, this_item);
        } else {
          if (DUPLICATED.has(item.Type())) {
            this_item = item.Duplicate(true, commit);
          } else if (
            item.Type() === KICAD_T.PCB_GENERATOR_T ||
            item.Type() === KICAD_T.PCB_GROUP_T
          ) {
            // Not DeepClone(): array copies must get fresh UUIDs, not the originals'.
            this_item = (item as PCB_GROUP).DeepDuplicate(true, commit);
          }
          // Silently drop other items (such as footprint texts) from duplication

          if (this_item) {
            // Because aItem is/can be created from a selected item, and inherits from
            // it this state, reset the selected stated of aItem:
            this_item.ClearSelected();
            this_item.RunOnChildren(
              (aItem: BOARD_ITEM) => aItem.ClearSelected(),
              RECURSE_MODE.RECURSE,
            );

            // We're iterating backwards, so the first item is the last in the array
            TransformItem(aArrayOpts, arraySize - ptN - 1, this_item);

            // If a group is duplicated, add also created members to the board
            if (
              this_item.Type() === KICAD_T.PCB_GROUP_T ||
              this_item.Type() === KICAD_T.PCB_GENERATOR_T
            ) {
              this_item.RunOnChildren((aItem: BOARD_ITEM) => {
                commit.Add(aItem);
              }, RECURSE_MODE.RECURSE);
            }

            commit.Add(this_item);
          }
        }

        // Add new items to selection (footprints in the selection will be reannotated)
        if (this_item) items_for_this_block.Add(this_item);
      }

      // Do not reannotate the first item, or it will skip its own numbering and
      // the array annotations will shift by one cell.
      if (will_reannotate && ptN !== arraySize - 1)
        reannotate.ReannotateDuplicates(items_for_this_block, all_added_items);

      for (const item of items_for_this_block) all_added_items.push(item);
    }

    // Make sure original items are selected (e.g. interactive point select may clear it)
    for (const eda_item of aSelection) all_added_items.push(eda_item);

    commit.Push('Create Array');

    return all_added_items;
  }
}
