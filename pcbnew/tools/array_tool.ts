// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARRAY_TOOL` (pcbnew/tools/array_tool.cpp): Create Array, in the board and the footprint
 * editor. `CreateArray` takes the selection and puts up DIALOG_CREATE_ARRAY - not modal upstream,
 * since it can ask to pick a point; the frame draws it (ARRAY_TOOL_FRAME) and answers with the
 * options its OK left, or null - and `onDialogClosed` does the work in one BOARD_COMMIT.
 */
import type { ARRAY_OPTIONS } from '@ziroeda/common/array_options.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ARRAY_PAD_NUMBER_PROVIDER } from '../array_pad_number_provider.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { DIALOG_CREATE_ARRAY } from '../dialogs/dialog_create_array.js';
import type { PAD } from '../pad.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_GROUP } from '../pcb_group.js';
import { BOARD_REANNOTATE_TOOL } from './board_reannotate_tool.js';
import { PCB_SELECTION } from './pcb_selection.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { _ } from '@ziroeda/wx/translation.js';

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

/** The window half of the tool: DIALOG_CREATE_ARRAY, which the frame draws. */
export interface ARRAY_TOOL_FRAME {
  /**
   * `m_dialog->Show( true )`, then `onDialogClosed`: the options the dialog's OK left in its
   * ARRAY_OPTIONS, or null when it was cancelled (`m_array_opts == nullptr`).
   */
  ShowCreateArrayDialog(aDialog: DIALOG_CREATE_ARRAY): Promise<ARRAY_OPTIONS | null>;
}

export class ARRAY_TOOL extends PCB_TOOL_BASE {
  /** The selection the dialog is working on (`m_selection`). */
  private m_selection: PCB_SELECTION | null = null;

  constructor() {
    super('pcbnew.Array');
  }

  override Reset(_aReason: RESET_REASON): void {}

  override Init(): boolean {
    return true;
  }

  /** `CreateArray` (array_tool.cpp:75-113). */
  CreateArray(_aEvent: TOOL_EVENT): number {
    const selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;

    // Be sure that there is at least one item that we can modify
    const selection = selectionTool.RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
    });

    if (selection.Empty()) return 0;

    // std::make_unique<PCB_SELECTION>( selection )
    this.m_selection = new PCB_SELECTION();

    for (const item of selection.Items()) this.m_selection.Add(item);

    // we have a selection to work on now, so start the tool process
    const editFrame = this.getEditFrame<PCB_BASE_FRAME>() as PCB_BASE_FRAME &
      Partial<ARRAY_TOOL_FRAME>;

    const enableArrayNumbering = this.m_isFootprintEditor;
    const origin: VECTOR2I =
      this.m_selection.Size() === 1
        ? this.m_selection.Items()[0]!.GetPosition()
        : this.m_selection.GetCenter();

    const dialog = new DIALOG_CREATE_ARRAY(enableArrayNumbering, origin);

    // Show the dialog, but it's not modal - the user might ask to select a point, in which case
    // we'll exit and do to that.
    void editFrame.ShowCreateArrayDialog?.(dialog).then((aOpts) => this.onDialogClosed(aOpts));

    return 0;
  }

  /** `onDialogClosed` (array_tool.cpp:115-401). */
  onDialogClosed(aArrayOpts: ARRAY_OPTIONS | null): void {
    // This means the dialog failed somehow
    if (aArrayOpts === null) return;

    const selection = this.m_selection;

    if (!selection) return;

    const editFrame = this.getEditFrame<PCB_BASE_FRAME>();
    const commit = new BOARD_COMMIT(editFrame);
    const arraySize = aArrayOpts.GetArraySize();

    if (aArrayOpts.ShouldArrangeSelection()) {
      const fpDeDupe = new Set<FOOTPRINT>();
      const sortedSelection = selection.GetItemsSortedBySelectionOrder();
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
          if (!this.m_isFootprintEditor && parentFootprint) {
            // It is possible to select multiple footprint child objects in the board editor.
            // Do not create multiple copies of the same footprint when this occurs.
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
      if (firstItem !== null) commit.Push(_('Arrange selection'));

      return;
    }

    const fp = this.m_isFootprintEditor ? editFrame.GetBoard()!.GetFirstFootprint() : null;

    // Collect a list of pad numbers that will _not_ be counted as "used"
    // when finding the next pad numbers.
    // Things that are selected are fair game, as they'll give up their numbers.
    // Keeps numbers used by both selected and unselected pads as "reserved".
    const unchangingPadNumbers = new Set<string>();

    if (fp) {
      for (const pad of fp.Pads()) {
        if (!pad.IsSelected()) unchangingPadNumbers.add(pad.GetNumber());
      }
    }

    const pad_number_provider = new ARRAY_PAD_NUMBER_PROVIDER(unchangingPadNumbers, aArrayOpts);

    const will_reannotate = !this.m_isFootprintEditor && aArrayOpts.ShouldReannotateFootprints();
    const all_added_items: EDA_ITEM[] = [];
    const reannotate = will_reannotate ? new BOARD_REANNOTATE_TOOL(editFrame.GetBoard()!) : null;

    // Iterate in reverse so the original items go last, and we can
    // use them for the positions of the clones.
    for (let ptN = arraySize - 1; ptN >= 0; --ptN) {
      const items_for_this_block = new PCB_SELECTION();
      const fpDeDupe = new Set<FOOTPRINT>();

      for (const eda_item of selection) {
        if (!eda_item.IsBOARD_ITEM()) continue;

        let item = eda_item as BOARD_ITEM;
        const parentFootprint = item.GetParentFootprint() as FOOTPRINT | null;

        // If it is not the footprint editor, then duplicate the parent footprint instead.
        // This check assumes that the footprint child objects are correctly parented, if
        // they are not, this will segfault.
        if (!this.m_isFootprintEditor && parentFootprint) {
          // It is possible to select multiple footprint child objects in the board editor.
          // Do not create multiple copies of the same footprint when this occurs.
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
          if (this.m_isFootprintEditor) {
            // Fields cannot be duplicated, especially mandatory fields.
            // A given field is unique for the footprint
            if (item.Type() === KICAD_T.PCB_FIELD_T) continue;

            // Don't bother incrementing pads: the footprint won't update until commit,
            // so we can only do this once
            this_item = fp!.DuplicateItem(true, commit, item);
          } else if (DUPLICATED.has(item.Type())) {
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

        // attempt to renumber items if the array parameters define
        // a complete numbering scheme to number by (as opposed to
        // implicit numbering by incrementing the items during creation
        if (this_item && aArrayOpts.ShouldNumberItems()) {
          // Renumber non-aperture pads.
          if (this_item.Type() === KICAD_T.PCB_PAD_T) {
            const pad = this_item as PAD;

            if (pad.CanHaveNumber()) pad.SetNumber(pad_number_provider.GetNextPadNumber());
          }
        }
      }

      // Do not reannotate the first item, or it will skip its own numbering and
      // the array annotations will shift by one cell.
      if (reannotate && ptN !== arraySize - 1)
        reannotate.ReannotateDuplicates(items_for_this_block, all_added_items);

      for (const item of items_for_this_block) all_added_items.push(item);
    }

    // Make sure original items are selected (e.g. interactive point select may clear it)
    for (const eda_item of selection) all_added_items.push(eda_item);

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    this.m_toolMgr!.RunAction<EDA_ITEM[]>(ACTIONS.selectItems, all_added_items);

    commit.Push(_('Create Array'));

    this.m_selection = null;
  }

  override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.CreateArray), PCB_ACTIONS.createArray.MakeEvent());
  }
}
