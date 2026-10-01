// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PAD_TOOL` (pcbnew/tools/pad_tool.h, pad_tool.cpp): the pad tools - copy,
 * paste and push a pad's settings, renumber pads by clicking them, place a pad
 * in the footprint editor, edit a pad's shape as separate primitives (explode and
 * recombine), and the Pad Table - on the live BOARD, through BOARD_COMMIT.
 *
 * What the tool asks the window for - its modal dialogs and the infobar - is
 * the frame's, through PAD_TOOL_FRAME (the frame's hooks). A browser dialog
 * answers a promise, so the two methods that need an answer before they can go
 * on finish in it: `pushPadSettings` does its push when DIALOG_PUSH_PAD_PROPERTIES
 * answers, and `EnumeratePads` runs its loop when DIALOG_ENUM_PADS answers (the
 * answer re-runs the action with the parameters in hand, where the C++ just reads
 * them off the returned dialog).
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ENTERED } from '@ziroeda/common/eda_item_flags.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  MD_CTRL,
  MD_SHIFT,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { niluuid, type KIID } from '@ziroeda/common/kiid.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { type RESET_REASON, RESET_REASON as RESET } from '@ziroeda/common/tool/tool_base.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { KeyNameFromKeyCode } from '@ziroeda/common/hotkeys_basic.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD } from '../board.js';
import { DELETED_BOARD_ITEM, type BOARD_ITEM } from '../board_item.js';
import { GENERAL_COLLECTOR } from '../collectors.js';
import {
  DEFAULT_PAD_ENUMERATION_PARAMS,
  DIALOG_ENUM_PADS,
  type SequentialPadEnumerationParams,
} from '../dialogs/dialog_enum_pads.js';
import type { DIALOG_FP_EDIT_PAD_TABLE } from '../dialogs/dialog_fp_edit_pad_table.js';
import { DIALOG_FP_EDIT_PAD_TABLE as DIALOG_FP_EDIT_PAD_TABLE_CTOR } from '../dialogs/dialog_fp_edit_pad_table.js';
import { DIALOG_PUSH_PAD_PROPERTIES, wxID_CANCEL } from '../dialogs/dialog_push_pad_properties.js';
import type { FOOTPRINT } from '../footprint.js';
import { PAD } from '../pad.js';
import { PADSTACK, PAD_ATTRIB, PAD_SHAPE } from '../padstack.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_DISPLAY_OPTIONS, type PCB_PAINTER } from '../pcb_painter.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { MAGNETIC_OPTIONS, MAGNETIC_SETTINGS } from '../pcbnew_settings.js';
import { ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM } from '../zones.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import {
  INTERACTIVE_PLACEMENT_OPTIONS,
  INTERACTIVE_PLACER_BASE,
  PCB_TOOL_BASE,
} from './pcb_tool_base.js';

/**
 * The window half of the tool: the modal dialogs `PAD_TOOL` shows and the infobar,
 * answered by the frame's hooks.
 */
export interface PAD_TOOL_FRAME {
  /**
   * `DIALOG_PUSH_PAD_PROPERTIES( frame ).ShowModal()`: what `PadPropertiesAccept`
   * returned for OK (0) or Apply (1), `wxID_CANCEL` for a dismissal.
   */
  ShowPushPadPropertiesDialog(aDialog: DIALOG_PUSH_PAD_PROPERTIES): Promise<number>;
  /** `DIALOG_ENUM_PADS( frame, params ).ShowModal() == wxID_OK`, after `TransferDataFromWindow()`. */
  ShowEnumPadsDialog(aDialog: DIALOG_ENUM_PADS): Promise<boolean>;
  /** `DIALOG_FP_EDIT_PAD_TABLE( frame, footprint ).ShowQuasiModal()`. */
  ShowPadTableDialog(aDialog: DIALOG_FP_EDIT_PAD_TABLE): void;
  /** `WX_INFOBAR::RemoveAllButtons(); ShowMessage( aMsg, wxICON_INFORMATION )`. */
  ShowInfoBarMsg(aMsg: string): void;
  /** `WX_INFOBAR::Dismiss()`. */
  DismissInfoBar(): void;
}

/**
 * `doPushPadProperties` (pad_tool.cpp:179): the source pad's settings onto the
 * pads of the same footprint, or of every footprint of the same library ID,
 * that pass the filters.
 */
function doPushPadProperties(
  aBoard: BOARD,
  aSrcPad: PAD,
  commit: BOARD_COMMIT,
  aSameFootprints: boolean,
  aPadShapeFilter: boolean,
  aPadOrientFilter: boolean,
  aPadLayerFilter: boolean,
  aPadTypeFilter: boolean,
): void {
  const refFootprint = aSrcPad.GetParentFootprint() as FOOTPRINT;

  const srcPadAngle = aSrcPad.GetOrientation().sub(refFootprint.GetOrientation());

  for (const footprint of aBoard.Footprints()) {
    if (!aSameFootprints && footprint !== refFootprint) continue;

    if (!footprint.GetFPID().equals(refFootprint.GetFPID())) continue;

    for (const pad of footprint.Pads()) {
      // TODO(JE) padstacks
      if (
        aPadShapeFilter &&
        pad.GetShape(PADSTACK.ALL_LAYERS) !== aSrcPad.GetShape(PADSTACK.ALL_LAYERS)
      )
        continue;

      const padAngle = pad.GetOrientation().sub(footprint.GetOrientation());

      if (aPadOrientFilter && !padAngle.equals(srcPadAngle)) continue;

      if (aPadLayerFilter && !pad.GetLayerSet().equals(aSrcPad.GetLayerSet())) continue;

      if (aPadTypeFilter && pad.GetAttribute() !== aSrcPad.GetAttribute()) continue;

      // Special-case for aperture pads
      if (aPadTypeFilter && pad.GetAttribute() === PAD_ATTRIB.CONN) {
        if (pad.IsAperturePad() !== aSrcPad.IsAperturePad()) continue;
      }

      commit.Modify(pad);

      // Apply source pad settings to this pad
      pad.ImportSettingsFrom(aSrcPad);
    }
  }
}

/**
 * `GetSequentialPadNumberingParams`' `static SEQUENTIAL_PAD_ENUMERATION_PARAMS
 * s_lastUsedParams`: persistent settings for the pad enumeration dialog.
 */
const s_lastUsedParams: SequentialPadEnumerationParams = { ...DEFAULT_PAD_ENUMERATION_PARAMS };

/**
 * `PlacePad`'s `static bool neednewPadNumber`: a new pad number for a new pad, the
 * last entered one for a pad recreated before the last was placed.
 */
let neednewPadNumber = false;

export class PAD_TOOL extends PCB_TOOL_BASE {
  private m_lastPadNumber = '';

  private m_previousHighContrastMode: HIGH_CONTRAST_MODE = HIGH_CONTRAST_MODE.NORMAL;
  private m_editPad: KIID = niluuid;

  /** The parameters `EnumeratePads` is to go on with once the dialog has answered. */
  private m_enumParams: SequentialPadEnumerationParams | null = null;

  constructor() {
    super('pcbnew.PadTool');
  }

  /** The frame, with the window half of the tool. */
  private editFrame(): PCB_BASE_EDIT_FRAME & Partial<PAD_TOOL_FRAME> {
    return this.getEditFrame<PCB_BASE_EDIT_FRAME>() as PCB_BASE_EDIT_FRAME &
      Partial<PAD_TOOL_FRAME>;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  private selTool(): PCB_SELECTION_TOOL {
    return this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;
  }

  ///< React to model/view changes
  override Reset(aReason: RESET_REASON): void {
    if (aReason === RESET.MODEL_RELOAD) this.m_lastPadNumber = '1';

    const board = this.m_toolMgr?.GetModel() as BOARD | null;

    if (board && board.ResolveItem(this.m_editPad) === DELETED_BOARD_ITEM.GetInstance()) {
      const opts = this.copyDisplayOptions();

      if (this.m_previousHighContrastMode !== opts.m_ContrastModeDisplay) {
        opts.m_ContrastModeDisplay = this.m_previousHighContrastMode;
        this.frame<PCB_BASE_FRAME>().SetDisplayOptions(opts);
      }

      this.editFrame().DismissInfoBar?.();

      this.m_editPad = niluuid;
    }
  }

  /** `PCB_DISPLAY_OPTIONS opts = frame()->GetDisplayOptions()`: a copy. */
  private copyDisplayOptions(): PCB_DISPLAY_OPTIONS {
    return Object.assign(
      new PCB_DISPLAY_OPTIONS(),
      this.frame<PCB_BASE_FRAME>().GetDisplayOptions(),
    );
  }

  ///< Basic initialization
  override Init(): boolean {
    const padTypes = [KICAD_T.PCB_PAD_T];

    const selTool = this.selTool();

    if (selTool) {
      // Add context menu entries that are displayed when selection tool is active
      const menu = selTool.GetToolMenu().GetMenu();

      const padSel = SELECTION_CONDITIONS.HasType(KICAD_T.PCB_PAD_T);
      const singlePadSel = SELECTION_CONDITIONS.And(
        SELECTION_CONDITIONS.Count(1),
        SELECTION_CONDITIONS.OnlyTypes(padTypes),
      );

      const explodeCondition = (aSel: SELECTION): boolean =>
        this.m_editPad === niluuid && aSel.Size() === 1 && aSel.at(0)!.Type() === KICAD_T.PCB_PAD_T;

      const recombineCondition = (_aSel: SELECTION): boolean => this.m_editPad !== niluuid;

      menu.AddSeparator(400);

      if (this.m_isFootprintEditor) {
        menu.AddItem(PCB_ACTIONS.padTable, SELECTION_CONDITIONS.ShowAlways, 400);
        menu.AddItem(PCB_ACTIONS.enumeratePads, SELECTION_CONDITIONS.ShowAlways, 400);
        menu.AddItem(PCB_ACTIONS.recombinePad, recombineCondition, 400);
        menu.AddItem(PCB_ACTIONS.explodePad, explodeCondition, 400);
      }

      menu.AddItem(PCB_ACTIONS.copyPadSettings, singlePadSel, 400);
      menu.AddItem(PCB_ACTIONS.applyPadSettings, padSel, 400);
      menu.AddItem(PCB_ACTIONS.pushPadSettings, singlePadSel, 400);
    }

    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);
    ctxMenu.AddSeparator(1);

    ctxMenu.AddItem(PCB_ACTIONS.rotateCcw, SELECTION_CONDITIONS.ShowAlways);
    ctxMenu.AddItem(PCB_ACTIONS.rotateCw, SELECTION_CONDITIONS.ShowAlways);
    ctxMenu.AddItem(PCB_ACTIONS.flip, SELECTION_CONDITIONS.ShowAlways);
    ctxMenu.AddItem(PCB_ACTIONS.mirrorH, SELECTION_CONDITIONS.ShowAlways);
    ctxMenu.AddItem(PCB_ACTIONS.mirrorV, SELECTION_CONDITIONS.ShowAlways);
    ctxMenu.AddItem(PCB_ACTIONS.properties, SELECTION_CONDITIONS.ShowAlways);

    // Finally, add the standard zoom/grid items
    this.getEditFrame<PCB_BASE_FRAME>().AddStandardSubMenus(this.m_menu);

    return true;
  }

  ///< Apply pad settings from board design settings to a pad.
  pastePadProperties(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().GetSelection();
    const masterPad = this.frame<PCB_BASE_FRAME>().GetDesignSettings().m_Pad_Master;

    const commit = new BOARD_COMMIT(this.frame<PCB_BASE_FRAME>());

    // for every selected pad, paste global settings
    for (const item of selection) {
      if (item.Type() === KICAD_T.PCB_PAD_T) {
        commit.Modify(item);
        (item as PAD).ImportSettingsFrom(masterPad);
      }
    }

    commit.Push('Paste Pad Properties');

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
    this.frame<PCB_BASE_FRAME>().GetCanvas()?.Refresh();

    return 0;
  }

  ///< Copy pad settings from a pad to the board design settings.
  copyPadSettings(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().GetSelection();

    // can only copy from a single pad
    if (selection.Size() === 1) {
      const item = selection.at(0)!;

      if (item.Type() === KICAD_T.PCB_PAD_T) {
        const selPad = item as PAD;
        this.frame<PCB_BASE_FRAME>().GetDesignSettings().m_Pad_Master.ImportSettingsFrom(selPad);
      }
    }

    return 0;
  }

  ///< Push pad settings from a pad to other pads on board or footprint.
  pushPadSettings(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().GetSelection();

    if (selection.Size() === 1 && selection.at(0)!.Type() === KICAD_T.PCB_PAD_T) {
      const srcPad = selection.at(0) as PAD;
      const footprint = srcPad.GetParentFootprint();

      if (footprint) {
        const frame = this.editFrame();
        frame.SetMsgPanel(footprint);

        if (!frame.ShowPushPadPropertiesDialog) return 0;

        const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame);

        void frame.ShowPushPadPropertiesDialog(dlg).then((dialogRet) => {
          if (dialogRet === wxID_CANCEL) return;

          const edit_Same_Modules = dialogRet === 1;

          const commit = new BOARD_COMMIT(frame);

          doPushPadProperties(
            this.board(),
            srcPad,
            commit,
            edit_Same_Modules,
            dlg.GetPadShapeFilter(),
            dlg.GetPadOrientFilter(),
            dlg.GetPadLayerFilter(),
            dlg.GetPadTypeFilter(),
          );

          commit.Push('Push Pad Settings');

          this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
          frame.GetCanvas()?.Refresh();
        });
      }
    }

    return 0;
  }

  /**
   * Tool for quick pad enumeration.
   */
  *EnumeratePads(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isFootprintEditor || this.InPadEditMode()) return 0;

    if (!this.board().GetFirstFootprint() || this.board().GetFirstFootprint()!.Pads().length === 0)
      return 0;

    // GetSequentialPadNumberingParams: the dialog answers a promise, and its answer runs the
    // action again with the parameters it wrote into `s_lastUsedParams`
    let params: SequentialPadEnumerationParams;

    if (this.m_enumParams) {
      params = this.m_enumParams;
      this.m_enumParams = null;
    } else {
      const frame = this.editFrame();

      if (!frame.ShowEnumPadsDialog) return 0;

      const settingsDlg = new DIALOG_ENUM_PADS(s_lastUsedParams);

      void frame.ShowEnumPadsDialog(settingsDlg).then((aOk) => {
        // Cancelled or otherwise failed to get any useful parameters
        if (!aOk) return;

        this.m_enumParams = { ...s_lastUsedParams };
        this.m_toolMgr!.RunAction(PCB_ACTIONS.enumeratePads);
      });

      return 0;
    }

    const frame = this.frame<PCB_BASE_EDIT_FRAME>();
    const collector = new GENERAL_COLLECTOR();
    const guide = this.getCollectorsGuide();
    guide.SetIgnoreFPTextOnBack(true);
    guide.SetIgnoreFPTextOnFront(true);
    guide.SetIgnoreFPValues(true);
    guide.SetIgnoreFPReferences(true);

    let seqPadNum = params.startNumber;

    const storedPadNumbers: number[] = [];
    const oldNumbers = new Map<string, [number, string]>();

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    frame.PushTool(aEvent);

    let oldMousePos: VECTOR2I = { x: 0, y: 0 }; // store the previous mouse cursor position, during mouse drag
    let selectedPads: PAD[] = [];
    const commit = new BOARD_COMMIT(frame);
    let isFirstPoint = true; // make sure oldMousePos is initialized at least once
    const pads: PAD[] = [...this.board().GetFirstFootprint()!.Pads()];
    const mag_settings = new MAGNETIC_SETTINGS();

    mag_settings.graphics = false;
    mag_settings.tracks = MAGNETIC_OPTIONS.NO_EFFECT;
    mag_settings.pads = MAGNETIC_OPTIONS.CAPTURE_ALWAYS;

    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, mag_settings);

    grid.SetSnap(true);
    grid.SetUseGrid(false);

    const setCursor = (): void => {
      this.canvas()!.SetCurrentCursor(KICURSOR.BULLSEYE);
    };

    const view = this.m_toolMgr!.GetView()!;
    const settings = view.GetPainter().GetSettings();
    const activeLayers = settings.GetHighContrastLayers();
    const isHighContrast = settings.GetHighContrast();

    const checkVisibility = (item: BOARD_ITEM): boolean => {
      if (!view.IsVisible(item)) return false;

      for (const layer of item.GetLayerSet().Seq()) {
        if ((isHighContrast && activeLayers.has(layer)) || view.IsLayerVisible(layer)) {
          if (item.ViewGetLOD(layer, view) < view.GetScale()) return true;
        }
      }

      return false;
    };

    for (const pad of this.board().GetFirstFootprint()!.Pads()) {
      if (checkVisibility(pad)) pads.push(pad);
    }

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    this.controls().ShowCursor(true);
    this.controls().ForceCursorPosition(false);
    // Set initial cursor
    setCursor();

    const statusPopup = new STATUS_TEXT_POPUP();

    // Callable lambda to construct the pad number string for the given value
    const constructPadNumber = (aValue: number): string => `${params.prefix ?? ''}${aValue}`;

    // Callable lambda to set the popup text for the given pad value
    const setPopupTextForValue = (aValue: number): void => {
      statusPopup.SetText(
        `Click on pad ${constructPadNumber(aValue)}\nPress <esc> to cancel all; double-click to finish`,
      );
    };

    setPopupTextForValue(seqPadNum);
    statusPopup.Popup();
    const mouseAt = KIPLATFORM_UI.GetMousePosition();
    statusPopup.Move({ x: mouseAt.x + 20, y: mouseAt.y + 20 });
    this.canvas()!.SetStatusPopup({
      HasFocus: () => {
        const panel = statusPopup.GetPanel();
        return !!panel && typeof document !== 'undefined' && panel.contains(document.activeElement);
      },
    });

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      const mousePos = this.controls().GetMousePosition();
      const cursorPos = grid.SnapToPad(mousePos, pads);
      this.controls().ForceCursorPosition(true, cursorPos);

      if (evt.IsCancelInteractive()) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        commit.Revert();

        frame.PopTool(aEvent);
        break;
      } else if (evt.IsActivate()) {
        commit.Push('Renumber Pads');

        frame.PopTool(aEvent);
        break;
      } else if (evt.IsDrag(BUT_LEFT) || evt.IsClick(BUT_LEFT)) {
        selectedPads = [];

        // Be sure the old cursor mouse position was initialized:
        if (isFirstPoint) {
          oldMousePos = mousePos;
          isFirstPoint = false;
        }

        // wxWidgets deliver mouse move events not frequently enough, resulting in skipping
        // pads if the user moves cursor too fast. To solve it, create a line that approximates
        // the mouse move and search pads that are on the line.
        const distance = EuclideanNormI({
          x: mousePos.x - oldMousePos.x,
          y: mousePos.y - oldMousePos.y,
        });
        // Search will be made every 0.1 mm:
        const segments = Math.trunc(distance / Math.trunc(0.1 * pcbIUScale.IU_PER_MM)) + 1;
        const line_step: VECTOR2I = {
          x: Math.trunc((mousePos.x - oldMousePos.x) / segments),
          y: Math.trunc((mousePos.y - oldMousePos.y) / segments),
        };

        collector.Empty();

        for (let j = 0; j < segments; ++j) {
          const testpoint: VECTOR2I = {
            x: mousePos.x - j * line_step.x,
            y: mousePos.y - j * line_step.y,
          };
          collector.Collect(this.board(), [KICAD_T.PCB_PAD_T], testpoint, guide);

          for (let i = 0; i < collector.GetCount(); ++i) {
            const pad = collector.At(i) as PAD;

            if (pad.CanHaveNumber() && checkVisibility(pad)) selectedPads.push(pad);
          }
        }

        // std::list::unique: adjacent duplicates only
        selectedPads = selectedPads.filter((p, i) => i === 0 || p !== selectedPads[i - 1]);

        for (const pad of selectedPads) {
          // If pad was not selected, then enumerate it
          if (!pad.IsSelected()) {
            commit.Modify(pad);

            // Rename pad and store the old name
            let newval: number;

            if (storedPadNumbers.length > 0) {
              newval = storedPadNumbers.shift()!;
            } else {
              newval = seqPadNum;
              seqPadNum += params.step;
            }

            const newNumber = constructPadNumber(newval);
            oldNumbers.set(newNumber, [newval, pad.GetNumber()]);
            pad.SetNumber(newNumber);
            this.SetLastPadNumber(newNumber);
            pad.SetSelected();
            this.getView()!.Update(pad);

            // Ensure the popup text shows the correct next value
            if (storedPadNumbers.length > 0) newval = storedPadNumbers[0]!;
            else newval = seqPadNum;

            setPopupTextForValue(newval);
          }

          // ... or restore the old name if it was enumerated and clicked again
          else if (pad.IsSelected() && evt.IsClick(BUT_LEFT)) {
            const it = oldNumbers.get(pad.GetNumber());
            console.assert(it !== undefined);

            if (it) {
              storedPadNumbers.push(it[0]);
              pad.SetNumber(it[1]);
              this.SetLastPadNumber(it[1]);
              oldNumbers.delete(pad.GetNumber());

              const newval = storedPadNumbers[0]!;
              setPopupTextForValue(newval);
            }

            pad.ClearSelected();
            this.getView()!.Update(pad);
          }
        }
      } else if (evt.IsDblClick(BUT_LEFT)) {
        commit.Push('Renumber Pads');
        frame.PopTool(aEvent);
        break;
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      } else {
        evt.SetPassEvent();
      }

      // Prepare the next loop by updating the old cursor mouse position
      // to this last mouse cursor position
      oldMousePos = mousePos;
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y + 20 });
    }

    for (const p of this.board().GetFirstFootprint()!.Pads()) {
      p.ClearSelected();
      this.getView()!.Update(p);
    }

    this.canvas()!.SetStatusPopup(null);
    statusPopup.Hide();

    this.canvas()!.SetCurrentCursor(KICURSOR.ARROW);
    this.controls().ForceCursorPosition(false);
    return 0;
  }

  /** `PCB_BASE_FRAME::GetCollectorsGuide()`, as the selection tool builds it. */
  private getCollectorsGuide(): ReturnType<PCB_SELECTION_TOOL['getCollectorsGuide']> {
    return this.selTool().getCollectorsGuide();
  }

  PadTable(_aEvent: TOOL_EVENT): number {
    if (!this.m_isFootprintEditor || this.InPadEditMode()) return 0;

    const footprint = this.board().GetFirstFootprint();

    if (!footprint) return 0;

    const frame = this.editFrame();

    if (!frame.ShowPadTableDialog) return 0;

    const dlg = new DIALOG_FP_EDIT_PAD_TABLE_CTOR(frame, footprint);
    frame.ShowPadTableDialog(dlg);

    return 0;
  }

  /**
   * Place a pad in footprint editor.
   */
  *PlacePad(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isFootprintEditor) return 0;

    if (!this.board().GetFirstFootprint()) return 0;

    class PAD_PLACER extends INTERACTIVE_PLACER_BASE {
      private readonly m_padTool: PAD_TOOL;
      private readonly m_gridHelper: PCB_GRID_HELPER;

      constructor(aPadTool: PAD_TOOL, aFrame: PCB_BASE_EDIT_FRAME) {
        super();
        this.m_padTool = aPadTool;
        this.m_frame = aFrame;
        this.m_gridHelper = new PCB_GRID_HELPER(
          aPadTool.GetManager()!,
          aFrame.GetMagneticItemsSettings(),
        );

        neednewPadNumber = true; // Use a new pad number when creating a pad by default
      }

      CreateItem(): BOARD_ITEM | null {
        // TODO(JE) padstacks
        const pad = new PAD(this.m_board.GetFirstFootprint());
        const master = this.m_frame.GetDesignSettings().m_Pad_Master;

        pad.ImportSettingsFrom(master);

        if (pad.CanHaveNumber()) {
          let padNumber = this.m_padTool.GetLastPadNumber();

          // Use the last entered pad number when recreating a pad without using the
          // previously created pad, and a new number when creating a really new pad
          if (neednewPadNumber)
            padNumber = this.m_board.GetFirstFootprint()!.GetNextPadNumber(padNumber);

          pad.SetNumber(padNumber);
          this.m_padTool.SetLastPadNumber(padNumber);

          // If a pad is recreated and the previously created was not placed, use
          // the last entered pad number
          neednewPadNumber = false;
        }

        return pad;
      }

      override PlaceItem(aItem: BOARD_ITEM, aCommit: BOARD_COMMIT): boolean {
        const pad = aItem.Type() === KICAD_T.PCB_PAD_T ? (aItem as PAD) : null;
        // We are using this pad number.
        // therefore use a new pad number for a newly created pad
        neednewPadNumber = true;

        if (pad) {
          this.m_frame.GetDesignSettings().m_Pad_Master.ImportSettingsFrom(pad);
          aCommit.Add(aItem);
          return true;
        }

        return false;
      }

      override SnapItem(aItem: BOARD_ITEM): void {
        this.m_gridHelper.SetSnap(!(this.m_modifiers & MD_SHIFT));
        this.m_gridHelper.SetUseGrid(!(this.m_modifiers & MD_CTRL));

        if (!this.m_gridHelper.GetSnap()) return;

        const settings = this.m_frame.GetMagneticItemsSettings();
        const pad = aItem as PAD;
        const viewControls = this.m_padTool.getViewControls() as unknown as VIEW_CONTROLS;
        const position = viewControls.GetMousePosition();
        const ignored_items: BOARD_ITEM[] = [pad];

        if (settings.pads === MAGNETIC_OPTIONS.NO_EFFECT)
          ignored_items.push(...this.m_board.GetFirstFootprint()!.Pads());

        if (!settings.graphics)
          ignored_items.push(...this.m_board.GetFirstFootprint()!.GraphicalItems());

        const cursorPos = this.m_gridHelper.BestSnapAnchor(
          position,
          LSET.AllLayersMask(),
          GRID_HELPER_GRIDS.GRID_CURRENT,
          ignored_items,
        );
        viewControls.ForceCursorPosition(true, cursorPos);
        aItem.SetPosition(cursorPos);
      }
    }

    const placer = new PAD_PLACER(this, this.frame<PCB_BASE_EDIT_FRAME>());

    yield* this.doInteractiveItemPlacement(
      aEvent,
      placer,
      'Place pad',
      INTERACTIVE_PLACEMENT_OPTIONS.IPO_REPEAT |
        INTERACTIVE_PLACEMENT_OPTIONS.IPO_SINGLE_CLICK |
        INTERACTIVE_PLACEMENT_OPTIONS.IPO_ROTATE |
        INTERACTIVE_PLACEMENT_OPTIONS.IPO_FLIP,
    );

    return 0;
  }

  /**
   * Enter/exit WYSIWYG pad shape editing.
   */
  EditPad(_aEvent: TOOL_EVENT): number {
    if (!this.m_isFootprintEditor) return 0;

    this.Activate();

    const painter = this.view()!.GetPainter() as PCB_PAINTER;
    const settings = painter.GetSettings();
    const selection = this.selTool().GetSelection();
    const frame = this.frame<PCB_BASE_EDIT_FRAME>();

    if (this.m_editPad !== niluuid) {
      const pad = frame.ResolveItem(this.m_editPad, true);

      if (pad && pad.Type() === KICAD_T.PCB_PAD_T) {
        const commit = new BOARD_COMMIT(frame);
        commit.Modify(pad);

        const mergedShapes = this.RecombinePad(pad as PAD, false);

        for (const shape of mergedShapes) commit.Remove(shape);

        commit.Push('Edit Pad');
      }

      this.m_editPad = niluuid;
    } else if (selection.Size() === 1 && selection.at(0)!.Type() === KICAD_T.PCB_PAD_T) {
      const pad = selection.at(0) as PAD;
      const commit = new BOARD_COMMIT(frame);

      commit.Modify(pad);
      const layer = this.explodePad(pad, commit);
      commit.Push('Edit Pad');

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      frame.SetActiveLayer(layer);

      settings.m_PadEditModePad = pad;
      this.enterPadEditMode();
    }

    if (this.m_editPad === niluuid) this.ExitPadEditMode();

    return 0;
  }

  OnUndoRedo(_aEvent: TOOL_EVENT): number {
    let flaggedPad: PAD | null = null;
    let flaggedPadId: KIID = niluuid;

    for (const fp of this.board().Footprints()) {
      for (const pad of fp.Pads()) {
        if (pad.IsEntered()) {
          flaggedPad = pad;
          flaggedPadId = pad.m_Uuid;
          break;
        }
      }
    }

    if (flaggedPadId !== this.m_editPad) {
      const painter = this.view()!.GetPainter() as PCB_PAINTER;
      const settings = painter.GetSettings();

      this.m_editPad = flaggedPadId;
      settings.m_PadEditModePad = flaggedPad;

      if (flaggedPad) this.enterPadEditMode();
      else this.ExitPadEditMode();
    }

    return 0;
  }

  InPadEditMode(): boolean {
    return this.m_editPad !== niluuid;
  }

  ExitPadEditMode(): void {
    const painter = this.view()!.GetPainter() as PCB_PAINTER;
    const settings = painter.GetSettings();
    const opts = this.copyDisplayOptions();

    settings.m_PadEditModePad = null;

    if (this.m_previousHighContrastMode !== opts.m_ContrastModeDisplay) {
      opts.m_ContrastModeDisplay = this.m_previousHighContrastMode;
      this.frame<PCB_BASE_FRAME>().SetDisplayOptions(opts);
    }

    // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as
    // they won't be found in the view layer's itemset for re-painting.
    this.canvas()!
      .GetView()
      .UpdateAllItemsConditionally(
        VIEW_UPDATE_FLAGS.ALL,
        (aItem) => (aItem as unknown as BOARD_ITEM).Type?.() === KICAD_T.PCB_PAD_T,
      );

    // Refresh now (otherwise there's an uncomfortably long pause while the infoBar
    // closes before refresh).
    this.canvas()!.ForceRefresh();

    this.editFrame().DismissInfoBar?.();
  }

  GetLastPadNumber(): string {
    return this.m_lastPadNumber;
  }

  SetLastPadNumber(aPadNumber: string): void {
    this.m_lastPadNumber = aPadNumber;
  }

  /**
   * Recombine an exploded pad (or one produced with overlapping polygons in an older version).
   * @param aPad the pad to run the recombination algorithm on
   * @param aIsDryRun if true the list will be generated but no changes will be made
   * @return a list of PCB_SHAPEs that will be combined
   */
  RecombinePad(aPad: PAD, aIsDryRun: boolean): PCB_SHAPE[] {
    const maxError = this.board().GetDesignSettings().m_MaxError;

    // Don't leave an object in the point editor that might no longer exist after recombining.
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return aPad.Recombine(aIsDryRun, maxError);
  }

  private enterPadEditMode(): void {
    const opts = this.copyDisplayOptions();
    const frame = this.frame<PCB_BASE_FRAME>();

    this.canvas()!
      .GetView()
      .UpdateAllItemsConditionally(
        VIEW_UPDATE_FLAGS.REPAINT,
        (aItem) => (aItem as unknown as BOARD_ITEM).Type?.() === KICAD_T.PCB_PAD_T,
      );

    this.m_previousHighContrastMode = opts.m_ContrastModeDisplay;

    if (opts.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.NORMAL) {
      opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
      frame.SetDisplayOptions(opts);
    }

    let msg: string;

    if (PCB_ACTIONS.explodePad.GetHotKey() === PCB_ACTIONS.recombinePad.GetHotKey()) {
      msg = `Pad Edit Mode.  Press ${KeyNameFromKeyCode(PCB_ACTIONS.recombinePad.GetHotKey())} again to exit.`;
    } else {
      msg = `Pad Edit Mode.  Press ${KeyNameFromKeyCode(PCB_ACTIONS.recombinePad.GetHotKey())} to exit.`;
    }

    this.editFrame().ShowInfoBarMsg?.(msg);
  }

  /** `explodePad`: the layer the pad's primitives go to, with the primitives added to the commit. */
  private explodePad(aPad: PAD, aCommit: BOARD_COMMIT): PCB_LAYER_ID {
    let layer: PCB_LAYER_ID;

    if (aPad.IsOnLayer(PCB_LAYER_ID.F_Cu)) layer = PCB_LAYER_ID.F_Cu;
    else if (aPad.IsOnLayer(PCB_LAYER_ID.B_Cu)) layer = PCB_LAYER_ID.B_Cu;
    else layer = aPad.GetLayerSet().UIOrder()[0]!;

    // TODO(JE) padstacks
    if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM) {
      for (const primitive of aPad.GetPrimitives(PADSTACK.ALL_LAYERS)) {
        const shape = primitive.Duplicate(true, aCommit) as PCB_SHAPE;

        shape.SetParent(this.board().GetFirstFootprint());
        shape.Rotate({ x: 0, y: 0 }, aPad.GetOrientation());
        shape.Move(aPad.ShapePos(PADSTACK.ALL_LAYERS));
        shape.SetLayer(layer);

        if (shape.IsProxyItem() && shape.GetShape() === SHAPE_T.SEGMENT) {
          if (aPad.GetLocalThermalSpokeWidthOverride() !== undefined)
            shape.SetWidth(aPad.GetLocalThermalSpokeWidthOverride()!);
          else shape.SetWidth(pcbIUScale.mmToIU(ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM));
        }

        aCommit.Add(shape);
      }

      // TODO(JE) padstacks
      aPad.SetShape(PADSTACK.ALL_LAYERS, aPad.GetAnchorPadShape(PADSTACK.ALL_LAYERS));
      aPad.DeletePrimitivesList();
    }

    aPad.SetFlags(ENTERED);
    this.m_editPad = aPad.m_Uuid;

    return layer;
  }

  ///< Bind handlers to corresponding TOOL_ACTIONs.
  protected override setTransitions(): void {
    const S = SYNC_HANDLER<PAD_TOOL>;

    this.Go(S(this.pastePadProperties), PCB_ACTIONS.applyPadSettings.MakeEvent());
    this.Go(S(this.copyPadSettings), PCB_ACTIONS.copyPadSettings.MakeEvent());
    this.Go(S(this.pushPadSettings), PCB_ACTIONS.pushPadSettings.MakeEvent());

    this.Go(this.PlacePad, PCB_ACTIONS.placePad.MakeEvent());
    this.Go(this.EnumeratePads, PCB_ACTIONS.enumeratePads.MakeEvent());
    this.Go(S(this.PadTable), PCB_ACTIONS.padTable.MakeEvent());

    this.Go(S(this.EditPad), PCB_ACTIONS.explodePad.MakeEvent());
    this.Go(S(this.EditPad), PCB_ACTIONS.recombinePad.MakeEvent());

    this.Go(S(this.OnUndoRedo), EVENTS.UndoRedoPostEvent);
  }
}
