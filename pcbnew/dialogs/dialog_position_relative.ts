// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_POSITION_RELATIVE` (`pcbnew/dialogs/dialog_position_relative.cpp`
 * + `.h`): the non-modal "Position Relative To Reference Item" dialog. It is a
 * `PCB_PICKER_TOOL::RECEIVER`: its two pick buttons hide it and run
 * `selectItemInteractively` / `selectPointInteractively`, and the picker calls
 * `UpdatePickedItem` / `UpdatePickedPoint` to bring it back.
 *
 * The class is the dialog's logic and its control state; the window is
 * `dialog_position_relative_ui.tsx`, which renders this object and calls its
 * handlers - `OnClear`, `OnPolarChanged`, `OnOkClick` ... - as wx does.
 * `Show` / `Hide` / `Destroy` are the window's: the UI subscribes with
 * `Subscribe` and draws the dialog while `IsShown()`.
 *
 * Every field of `_base.cpp`'s sizer tree that the logic changes is a field
 * here: the labels, the unit labels, the Reset tooltips, the reference line.
 */
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { type EdaUnits, pcbIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_ACTIONS } from '../tools/pcb_actions.js';

/** `DIALOG_POSITION_RELATIVE::ANCHOR_TYPE`: persistent dialog options. */
export enum ANCHOR_TYPE {
  ANCHOR_GRID_ORIGIN,
  ANCHOR_USER_ORIGIN,
  ANCHOR_ITEM,
  ANCHOR_POINT,
}

/**
 * `PCB_PICKER_TOOL::RECEIVER` (`pcb_picker_tool.h:45`): what the picker calls
 * back with.
 */
export interface PICKER_RECEIVER {
  UpdatePickedPoint(aPoint: VECTOR2I | null): void;
  UpdatePickedItem(aItem: EDA_ITEM | null): void;
}

/**
 * The slice of `POSITION_RELATIVE_TOOL` the dialog asks for. Asked by name
 * ("pcbnew.PositionRelative"), as `m_toolMgr->GetTool<POSITION_RELATIVE_TOOL>()`
 * would - the tool imports this module, so asking by type would be a cycle.
 */
export interface POSITION_RELATIVE_TOOL_LIKE {
  GetSelectionAnchorPosition(): VECTOR2I;
  RelativeItemSelectionMove(aAnchor: VECTOR2I, aTranslation: VECTOR2I): number;
}

/** `PCB_PICKER_TOOL` is asked only whether it exists (`wxCHECK( pickerTool, )`). */
const PICKER_TOOL_NAME = 'pcbnew.InteractivePicker';
const POSITION_RELATIVE_TOOL_NAME = 'pcbnew.PositionRelative';

/** `DIALOG_POSITION_RELATIVE_BASE`'s title. */
export const DIALOG_POSITION_RELATIVE_TITLE = 'Position Relative To Reference Item';

export class DIALOG_POSITION_RELATIVE implements PICKER_RECEIVER {
  /** `static ANCHOR_TYPE s_anchorType = ANCHOR_ITEM`. */
  static s_anchorType: ANCHOR_TYPE = ANCHOR_TYPE.ANCHOR_ITEM;

  private readonly m_parentFrame: PCB_BASE_FRAME;
  private readonly m_toolMgr: TOOL_MANAGER;
  /** `DIALOG_SHIM::m_units`: the frame's units when the dialog was made. */
  private readonly m_units: EdaUnits;

  private m_anchorItemPosition: VECTOR2I = { x: 0, y: 0 };

  readonly m_xOffset: UNIT_BINDER;
  readonly m_yOffset: UNIT_BINDER;

  private m_stateX = 0.0;
  private m_stateY = 0.0;
  private m_stateRadius = 0.0;
  private m_stateTheta: EDA_ANGLE = ANGLE_0;

  // ---- the controls `_base.cpp` builds, as far as the logic reads or sets them
  /** `m_polarCoords->SetValue( true )`. */
  m_polarCoords = true;
  /** `m_referenceInfo`: `_("Reference item: <none selected>")`. */
  m_referenceInfo = 'Reference item: <none selected>';
  /** `m_clearX->SetToolTip(...)`; the base file gives none. */
  m_clearXToolTip = '';
  m_clearYToolTip = '';

  private m_shown = false;
  private m_destroyed = false;
  private m_raised = 0;
  private m_version = 0;
  private readonly m_listeners = new Set<() => void>();

  constructor(aParent: PCB_BASE_FRAME) {
    this.m_parentFrame = aParent;
    this.m_toolMgr = aParent.GetToolManager()!;
    this.m_units = aParent.GetUserUnits();

    // m_xOffset( aParent, m_xLabel, m_xEntry, m_xUnit ), the labels as _base.cpp states them
    this.m_xOffset = new UNIT_BINDER(aParent, 'Offset X:');
    this.m_yOffset = new UNIT_BINDER(aParent, 'Offset Y:');
    this.m_xOffset.SetText('0');
    this.m_yOffset.SetText('0');

    // Configure display origin transforms
    this.m_xOffset.SetCoordType(COORD_TYPES_T.REL_X_COORD);
    this.m_yOffset.SetCoordType(COORD_TYPES_T.REL_Y_COORD);

    // SetInitialFocus( m_xEntry ): the window's first focus is the X entry.
    // SetupStandardButtons(), finishDialogSettings(): the window's.
  }

  // ---- DIALOG_SHIM, as the window sees it ----------------------------------

  /** `DIALOG_SHIM::GetUserUnits()`. */
  GetUserUnits(): EdaUnits {
    return this.m_units;
  }

  /**
   * `wxDialog::Show( aShow )`. A first or later `Show( true )` runs
   * `InitDialog()`, i.e. `TransferDataToWindow()`.
   */
  Show(aShow: boolean): void {
    if (this.m_destroyed) return;

    if (aShow) this.TransferDataToWindow();

    this.m_shown = aShow;
    this.notify();
  }

  Hide(): void {
    this.Show(false);
  }

  IsShown(): boolean {
    return this.m_shown;
  }

  /** `wxWindow::Raise()` / `SetFocus()`: the window brings itself to the front. */
  Raise(): void {
    this.m_raised++;
    this.notify();
  }

  /** How many times `Raise()` was asked; the window re-takes the focus when it changes. */
  GetRaiseCount(): number {
    return this.m_raised;
  }

  SetFocus(): void {
    this.notify();
  }

  Destroy(): void {
    this.m_destroyed = true;
    this.m_shown = false;
    this.notify();
  }

  IsDestroyed(): boolean {
    return this.m_destroyed;
  }

  /** The window's subscription: called after every change of the dialog's state. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  /** Changes on every state change; what `useSyncExternalStore` compares. */
  GetVersion(): number {
    return this.m_version;
  }

  private notify(): void {
    this.m_version++;
    for (const l of [...this.m_listeners]) l();
  }

  // ---- the labels the binders write into the controls ----------------------

  GetXLabel(): string {
    return this.m_xOffset.GetLabel();
  }
  GetYLabel(): string {
    return this.m_yOffset.GetLabel();
  }
  /** `m_xUnit`: `EDA_UNIT_UTILS::GetLabel( m_units )`. */
  GetXUnitLabel(): string {
    return unitLabel(this.m_xOffset.GetUnits());
  }
  GetYUnitLabel(): string {
    return unitLabel(this.m_yOffset.GetUnits());
  }

  // ---- DIALOG_POSITION_RELATIVE --------------------------------------------

  TransferDataToWindow(): boolean {
    this.updateDialogControls(this.m_polarCoords);
    return true;
  }

  ToPolarDeg(x: number, y: number): { r: number; q: EDA_ANGLE } {
    // convert to polar coordinates
    const r = Math.hypot(x, y);

    const q = r !== 0 ? EDA_ANGLE.fromVector({ x, y }) : ANGLE_0;

    return { r, q };
  }

  getTranslationInIU(polar: boolean): VECTOR2I {
    const val = { x: 0, y: 0 };

    if (polar) {
      const r = this.m_xOffset.GetDoubleValue();
      const q = this.m_yOffset.GetAngleValue();

      val.x = KiROUND(r * q.Cos());
      val.y = KiROUND(r * q.Sin());
    } else {
      // direct read
      val.x = KiROUND(this.m_xOffset.GetDoubleValue());
      val.y = KiROUND(this.m_yOffset.GetDoubleValue());
    }

    // no validation to do here, but in future, you could return false here
    return val;
  }

  /** `OnPolarChanged`: the check box has already toggled, as on `wxEVT_COMMAND_CHECKBOX_CLICKED`. */
  OnPolarChanged(aChecked: boolean): void {
    this.m_polarCoords = aChecked;

    const newPolar = this.m_polarCoords;
    const xOffset = this.m_xOffset.GetDoubleValue();
    const yOffset = this.m_yOffset.GetDoubleValue();
    this.updateDialogControls(newPolar);

    if (newPolar) {
      if (xOffset !== this.m_stateX || yOffset !== this.m_stateY) {
        this.m_stateX = xOffset;
        this.m_stateY = yOffset;
        const { r, q } = this.ToPolarDeg(this.m_stateX, this.m_stateY);
        this.m_stateRadius = r;
        this.m_stateTheta = q;

        this.m_xOffset.SetDoubleValue(this.m_stateRadius);
        this.m_stateRadius = this.m_xOffset.GetDoubleValue();
        this.m_yOffset.SetAngleValue(this.m_stateTheta);
        this.m_stateTheta = this.m_yOffset.GetAngleValue();
      } else {
        this.m_xOffset.SetDoubleValue(this.m_stateRadius);
        this.m_yOffset.SetAngleValue(this.m_stateTheta);
      }
    } else {
      if (xOffset !== this.m_stateRadius || yOffset !== this.m_stateTheta.AsDegrees()) {
        this.m_stateRadius = xOffset;
        this.m_stateTheta = new EDA_ANGLE(yOffset);
        this.m_stateX = this.m_stateRadius * this.m_stateTheta.Cos();
        this.m_stateY = this.m_stateRadius * this.m_stateTheta.Sin();

        this.m_xOffset.SetDoubleValue(this.m_stateX);
        this.m_stateX = this.m_xOffset.GetDoubleValue();
        this.m_yOffset.SetDoubleValue(this.m_stateY);
        this.m_stateY = this.m_yOffset.GetDoubleValue();
      } else {
        this.m_xOffset.SetDoubleValue(this.m_stateX);
        this.m_yOffset.SetDoubleValue(this.m_stateY);
      }
    }

    this.notify();
  }

  /** Update controls and their labels after changing the coordinates type (polar/cartesian). */
  private updateDialogControls(aPolar: boolean): void {
    if (aPolar) {
      this.m_xOffset.SetLabel('Distance:'); // Polar radius
      this.m_yOffset.SetLabel('Angle:'); // Polar theta or angle
      this.m_yOffset.SetUnits('degrees');
      this.m_clearXToolTip = 'Reset to the current distance from the reference position.';
      this.m_clearYToolTip = 'Reset to the current angle from the reference position.';
    } else {
      this.m_xOffset.SetLabel('Offset X:');
      this.m_yOffset.SetLabel('Offset Y:');
      this.m_yOffset.SetUnits(this.GetUserUnits());
      this.m_clearXToolTip = 'Reset to the current X offset from the reference position.';
      this.m_clearYToolTip = 'Reset to the current Y offset from the reference position.';
    }
  }

  /** `OnClear`: which of the two Reset buttons was clicked. */
  OnClear(aWhich: 'x' | 'y'): void {
    const posrelTool = this.m_toolMgr.FindTool(
      POSITION_RELATIVE_TOOL_NAME,
    ) as unknown as POSITION_RELATIVE_TOOL_LIKE | null;
    console.assert(!!posrelTool);

    const anchor = posrelTool!.GetSelectionAnchorPosition();
    const here = this.getAnchorPos();
    const offset = { x: anchor.x - here.x, y: anchor.y - here.y };
    const { r, q } = this.ToPolarDeg(offset.x, offset.y);

    if (aWhich === 'x') {
      this.m_stateX = offset.x;
      this.m_xOffset.SetDoubleValue(r);
      this.m_stateRadius = this.m_xOffset.GetDoubleValue();

      if (this.m_polarCoords) this.m_xOffset.SetDoubleValue(this.m_stateRadius);
      else this.m_xOffset.SetValue(this.m_stateX);
    } else {
      this.m_stateY = offset.y;
      this.m_yOffset.SetAngleValue(q);
      this.m_stateTheta = this.m_yOffset.GetAngleValue();

      if (this.m_polarCoords) this.m_yOffset.SetAngleValue(this.m_stateTheta);
      else this.m_yOffset.SetValue(this.m_stateY);
    }

    this.notify();
  }

  /** `OnSelectItemClick`. */
  OnSelectItemClick(): void {
    const pickerTool = this.m_toolMgr.FindTool(PICKER_TOOL_NAME);
    if (!pickerTool) return;

    this.Hide();

    this.m_toolMgr.RunAction(PCB_ACTIONS.selectItemInteractively, {
      m_Receiver: this,
      m_Prompt: 'Select reference item...',
      m_ItemFilter: null,
    });
  }

  /** `OnSelectPointClick`. */
  OnSelectPointClick(): void {
    const pickerTool = this.m_toolMgr.FindTool(PICKER_TOOL_NAME);
    if (!pickerTool) return;

    // Hide, but do not close, the dialog
    this.Hide();

    this.m_toolMgr.RunAction(PCB_ACTIONS.selectPointInteractively, {
      m_Receiver: this,
      m_Prompt: 'Select reference point...',
      m_ItemFilter: null,
    });
  }

  /** Update controls and labels after changing anchor type. */
  private updateAnchorInfo(aItem: BOARD_ITEM | null): void {
    switch (DIALOG_POSITION_RELATIVE.s_anchorType) {
      case ANCHOR_TYPE.ANCHOR_GRID_ORIGIN:
        this.m_referenceInfo = 'Reference location: grid origin';
        break;

      case ANCHOR_TYPE.ANCHOR_USER_ORIGIN:
        this.m_referenceInfo = 'Reference location: local coordinates origin';
        break;

      case ANCHOR_TYPE.ANCHOR_ITEM: {
        const unitsProvider = new UNITS_PROVIDER(pcbIUScale, this.GetUserUnits());
        let msg = '<none selected>';

        if (aItem) msg = aItem.GetItemDescription(unitsProvider, true);

        this.m_referenceInfo = `Reference item: ${msg}`;
        break;
      }

      case ANCHOR_TYPE.ANCHOR_POINT: {
        const up = this.m_parentFrame.GetUnitsProvider();

        this.m_referenceInfo = `Reference location: selected point (${up.MessageTextFromValue(this.m_anchorItemPosition.x)}, ${up.MessageTextFromValue(this.m_anchorItemPosition.y)})`;
        break;
      }
    }

    this.notify();
  }

  /** Get the current anchor position. */
  getAnchorPos(): VECTOR2I {
    switch (DIALOG_POSITION_RELATIVE.s_anchorType) {
      case ANCHOR_TYPE.ANCHOR_GRID_ORIGIN:
        return (this.m_toolMgr.GetModel() as BOARD).GetDesignSettings().GetGridOrigin();

      case ANCHOR_TYPE.ANCHOR_USER_ORIGIN:
        return (this.m_toolMgr.GetToolHolder() as PCB_BASE_FRAME).GetScreen()!.m_LocalOrigin;

      case ANCHOR_TYPE.ANCHOR_ITEM:
      case ANCHOR_TYPE.ANCHOR_POINT:
        return this.m_anchorItemPosition;
    }

    // Needed by some compilers to avoid a fatal compil error (no return value).
    return this.m_anchorItemPosition;
  }

  OnUseGridOriginClick(): void {
    DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_GRID_ORIGIN;
    this.updateAnchorInfo(null);
  }

  OnUseUserOriginClick(): void {
    DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_USER_ORIGIN;
    this.updateAnchorInfo(null);
  }

  UpdatePickedItem(aItem: EDA_ITEM | null): void {
    let item: BOARD_ITEM | null = null;

    if (aItem?.IsBOARD_ITEM()) item = aItem as BOARD_ITEM;

    DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_ITEM;
    this.updateAnchorInfo(item);

    if (item) this.m_anchorItemPosition = item.GetPosition();

    this.Show(true);
    this.Raise();
    this.SetFocus();
  }

  UpdatePickedPoint(aPoint: VECTOR2I | null): void {
    DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_POINT;

    if (aPoint) this.m_anchorItemPosition = { x: aPoint.x, y: aPoint.y };

    this.updateAnchorInfo(null);

    this.Show(true);
    this.Raise();
    this.SetFocus();
  }

  /**
   * `OnOkClick`: moves the selection, then `event.Skip()` lets wx's default OK
   * handler close the dialog - a modeless dialog is hidden.
   */
  OnOkClick(): void {
    // for the output, we only deliver a Cartesian vector
    const translation = this.getTranslationInIU(this.m_polarCoords);

    const posrelTool = this.m_toolMgr.FindTool(
      POSITION_RELATIVE_TOOL_NAME,
    ) as unknown as POSITION_RELATIVE_TOOL_LIKE | null;

    posrelTool!.RelativeItemSelectionMove(this.getAnchorPos(), translation);

    this.Hide();
  }

  /** wxID_CANCEL, and the title bar's close box: a modeless dialog is hidden. */
  OnCancel(): void {
    this.Hide();
  }

  /** `OnTextFocusLost`: reset a text field to be 0 if it was exited while blank. */
  OnTextFocusLost(aEntry: UNIT_BINDER): void {
    if (aEntry.GetText() === '') {
      aEntry.SetText('0');
      this.notify();
    }
  }

  /** The text of an entry the user is typing in. */
  SetEntryText(aEntry: UNIT_BINDER, aText: string): void {
    aEntry.SetText(aText);
    this.notify();
  }
}
