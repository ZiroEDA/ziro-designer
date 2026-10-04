// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/sch_tool_base.h`: SCH_TOOL_BASE<T>, the foundation of every schematic and
 * symbol editor tool - the frame, the view and the selection tool, the basic context menu,
 * Increment and InteractiveDelete, and the undo helpers. The C++ template parameter is the frame
 * type, a generic here.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SELECTED_BY_DRAG } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { STRING_INCREMENTER } from '@ziroeda/common/increment.js';
import { ACTIONS, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import { PICKER_TOOL } from '@ziroeda/common/tool/picker_tool.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_ITEM } from '../sch_item.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_VIEW } from '../sch_view.js';
import { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import type { SCH_SELECTION_TOOL } from './sch_selection_tool.js';

export abstract class SCH_TOOL_BASE<T extends SCH_BASE_FRAME> extends TOOL_INTERACTIVE {
  protected m_frame: T | null = null;
  protected m_view: SCH_VIEW | null = null;
  protected m_selectionTool: SCH_SELECTION_TOOL | null = null;
  protected m_isSymbolEditor = false;
  protected m_pickerItem: EDA_ITEM | null = null;

  /** Create a tool with given name. The name must be unique. */
  constructor(aName: string) {
    super(TOOL_MANAGER.MakeToolId(aName), aName);
  }

  /** @copydoc TOOL_INTERACTIVE::Init() */
  override Init(): boolean {
    this.m_frame = this.getEditFrame<T>();
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as SCH_SELECTION_TOOL | null;
    this.m_isSymbolEditor = this.m_frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);

    // A basic context menu.  Many (but not all) tools will choose to override this.
    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);
    ctxMenu.AddSeparator(1);

    // Finally, add the standard zoom/grid items
    this.m_frame.AddStandardSubMenus(this.m_menu);

    return true;
  }

  /** @copydoc TOOL_INTERACTIVE::Reset() */
  override Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD || aReason === RESET_REASON.SUPERMODEL_RELOAD) {
      // Init variables used by every drawing tool
      this.m_frame = this.getEditFrame<T>();
      this.m_isSymbolEditor = this.m_frame instanceof SYMBOL_EDIT_FRAME;
    }

    this.m_view = this.getView() as SCH_VIEW | null;
  }

  /** True if the tool is running in the symbol editor. */
  IsSymbolEditor(): boolean {
    return this.m_isSymbolEditor;
  }

  Increment(aEvent: TOOL_EVENT): number {
    const incrementable = [
      KICAD_T.SCH_LABEL_T,
      KICAD_T.SCH_GLOBAL_LABEL_T,
      KICAD_T.SCH_HIER_LABEL_T,
      KICAD_T.SCH_PIN_T,
      KICAD_T.SCH_TEXT_T,
    ];

    let param: INCREMENT = { Delta: 1, Index: 0 };

    if (aEvent.HasParameter()) param = aEvent.Parameter<INCREMENT>();

    const selection = this.m_selectionTool!.RequestSelection(incrementable);

    if (selection.Empty()) return 0;

    const type = selection.Front()!.Type();
    let allSameType = true;

    for (const item of selection) {
      if (item.Type() !== type) {
        allSameType = false;
        break;
      }
    }

    // Incrementing multiple types at once seems confusing though it would work.
    if (!allSameType) return 0;

    const mousePosition = this.getViewControls()!.GetMousePosition();

    const incrementer = new STRING_INCREMENTER();
    // In schematics, it's probably less common to be operating
    // on pin numbers which are usually IOSQXZ-skippy.
    incrementer.SetSkipIOSQXZ(this.m_isSymbolEditor);

    // If we're coming via another action like 'Move', use that commit
    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const eventCommit = aEvent.Commit();
    const commit = eventCommit instanceof SCH_COMMIT ? eventCommit : localCommit;

    const modifyItem = (aItem: EDA_ITEM): void => {
      if (aItem.IsNew()) this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

      commit.Modify(aItem, this.m_frame!.GetScreen());
    };

    for (const item of selection) {
      switch (item.Type()) {
        case KICAD_T.SCH_PIN_T: {
          const pin = item as SCH_PIN;
          const layout = pin.GetLayoutCache();

          let found = false;
          let bbox = layout.GetPinNumberBBox();

          if (bbox?.Contains(mousePosition)) {
            const nextNumber = incrementer.Increment(pin.GetNumber(), param.Delta, param.Index);

            if (nextNumber !== undefined) {
              modifyItem(pin);
              pin.SetNumber(nextNumber);
            }

            found = true;
          }

          if (!found) {
            bbox = layout.GetPinNameBBox();

            if (bbox?.Contains(mousePosition)) {
              const nextName = incrementer.Increment(pin.GetName(), param.Delta, param.Index);

              if (nextName !== undefined) {
                modifyItem(pin);
                pin.SetName(nextName);
              }

              found = true;
            }
          }

          break;
        }

        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_TEXT_T: {
          const label = item as SCH_TEXT;
          const newLabel = incrementer.Increment(label.GetText(), param.Delta, param.Index);

          if (newLabel !== undefined) {
            modifyItem(label);
            label.SetText(newLabel);
          }

          break;
        }

        default:
          // No increment for other items
          break;
      }
    }

    commit.Push('Increment');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  InteractiveDelete(aEvent: TOOL_EVENT): number {
    const picker = this.m_toolMgr!.GetTool(PICKER_TOOL)!;

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    this.m_pickerItem = null;

    // Deactivate other tools; particularly important if another PICKER is currently running
    this.Activate();

    picker.SetCursor(KICURSOR.REMOVE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    picker.SetClickHandler((_aPosition: VECTOR2D): boolean => {
      if (this.m_pickerItem) {
        const selectionTool = this.selectionTool();
        selectionTool.UnbrightenItem(this.m_pickerItem);
        selectionTool.AddItemToSel(this.m_pickerItem, true /*quiet mode*/);
        this.m_toolMgr!.RunAction(ACTIONS.doDelete);
        this.m_pickerItem = null;
      }

      return true;
    });

    picker.SetMotionHandler((aPos: VECTOR2D): void => {
      const selectionTool = this.selectionTool();
      const collector = new SCH_COLLECTOR();

      selectionTool.CollectHits(collector, aPos, SCH_COLLECTOR.DeletableItems);

      // Remove unselectable items
      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        if (!selectionTool.Selectable(collector.At(i)!)) collector.Remove(i);
      }

      if (collector.GetCount() > 1) selectionTool.GuessSelectionCandidates(collector, aPos);

      const item = collector.GetCount() === 1 ? collector.At(0) : null;

      if (this.m_pickerItem !== item) {
        if (this.m_pickerItem) selectionTool.UnbrightenItem(this.m_pickerItem);

        this.m_pickerItem = item;

        if (this.m_pickerItem) selectionTool.BrightenItem(this.m_pickerItem);
      }
    });

    picker.SetFinalizeHandler((_aFinalState: number): void => {
      if (this.m_pickerItem) this.selectionTool().UnbrightenItem(this.m_pickerItem);

      // Wake the selection tool after exiting to ensure the cursor gets updated
      this.m_toolMgr!.PostAction(ACTIONS.selectionActivate);
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    return 0;
  }

  /** `m_toolMgr->GetTool<SCH_SELECTION_TOOL>()`. */
  private selectionTool(): SCH_SELECTION_TOOL {
    return this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as SCH_SELECTION_TOOL;
  }

  /** Similar to getView()->Update(), but also updates the SCH_SCREEN's RTree. */
  protected updateItem(aItem: EDA_ITEM, aUpdateRTree: boolean): void {
    this.m_frame!.UpdateItem(aItem, false, aUpdateRTree);
  }

  /** Similar to m_frame->SaveCopyInUndoList(), but also handles connectivity. */
  protected saveCopyInUndoList(
    aItem: EDA_ITEM,
    _aType: UNDO_REDO,
    aAppend = false,
    aDirtyConnectivity = true,
  ): void {
    if (!(aItem instanceof SCH_ITEM)) return;

    const item = aItem;
    const selected = item.IsSelected();

    // IS_SELECTED flag should not be set on undo items which were added for
    // a drag operation.
    if (selected && item.HasFlag(SELECTED_BY_DRAG)) item.ClearSelected();

    if (this.m_frame instanceof SYMBOL_EDIT_FRAME) {
      // SYMBOL_EDIT_FRAME::SaveCopyInUndoList( wxEmptyString, LIB_SYMBOL* ): the symbol
      // editor's undo arrives with its tools.
    } else if (this.m_frame instanceof SCH_EDIT_FRAME) {
      const schematicFrame = this.m_frame;
      schematicFrame.SaveCopyInUndoList(
        schematicFrame.GetScreen()!,
        item,
        UNDO_REDO.CHANGED,
        aAppend,
      );

      if (aDirtyConnectivity) {
        const connection = item.Connection();

        if (
          !item.IsConnectivityDirty() &&
          connection &&
          (connection.Name() === schematicFrame.GetHighlightedConnection() ||
            connection.HasDriverChanged())
        ) {
          schematicFrame.DirtyHighlightedConnection();
        }

        item.SetConnectivityDirty();
      }
    }

    if (selected && aItem.HasFlag(SELECTED_BY_DRAG)) aItem.SetSelected();
  }
}
