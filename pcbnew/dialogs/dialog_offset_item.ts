// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_OFFSET_ITEM` (`pcbnew/dialogs/dialog_offset_item.cpp` + `.h`): the
 * modal "Offset Item" dialog `POSITION_RELATIVE_TOOL::InteractiveOffset` shows
 * once the user has drawn the offset with the ruler. It invites the user to
 * edit one offset vector, Cartesian or polar.
 *
 * The class is the dialog's logic and control state; the window is
 * `dialog_offset_item_ui.tsx`. `aOffset` is `OFFSET_VECTOR& aOffset`: the dialog
 * writes the edited vector back into the object it was given, in
 * `TransferDataFromWindow`.
 */
import { type EdaUnits, unitLabel } from '@ziroeda/common/eda_units.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
/** `OFFSET_VECTOR`, which the dialog writes through (`OFFSET_VECTOR& aOffset`). */
export type OFFSET_VECTOR = { x: number; y: number };
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';

/** `DIALOG_OFFSET_ITEM_BASE`'s title. */
export const DIALOG_OFFSET_ITEM_TITLE = 'Offset Item';

/** `ToPolar`, the file-static of `dialog_offset_item.cpp`. */
function ToPolar(x: number, y: number): { r: number; q: EDA_ANGLE } {
  // convert to polar coordinates
  const r = Math.hypot(x, y);

  const q = r !== 0 ? EDA_ANGLE.fromVector({ x, y }) : ANGLE_0;

  return { r, q };
}

export class DIALOG_OFFSET_ITEM {
  private readonly m_units: EdaUnits;

  /** `const OFFSET_VECTOR m_originalOffset`. */
  private readonly m_originalOffset: OFFSET_VECTOR;
  /** `OFFSET_VECTOR& m_updatedOffset`: the caller's vector. */
  private readonly m_updatedOffset: OFFSET_VECTOR;

  readonly m_xOffset: UNIT_BINDER;
  readonly m_yOffset: UNIT_BINDER;

  private m_stateX = 0.0;
  private m_stateY = 0.0;
  private m_stateRadius = 0.0;
  private m_stateTheta: EDA_ANGLE = ANGLE_0;

  /** `m_polarCoords->SetValue( true )`. */
  m_polarCoords = true;
  m_clearXToolTip = '';
  m_clearYToolTip = '';

  private m_version = 0;
  private readonly m_listeners = new Set<() => void>();

  constructor(aFrame: PCB_BASE_FRAME, aOffset: OFFSET_VECTOR) {
    this.m_units = aFrame.GetUserUnits();
    this.m_originalOffset = { x: aOffset.x, y: aOffset.y };
    this.m_updatedOffset = aOffset;

    // m_xOffset( &aParent, m_xLabel, m_xEntry, m_xUnit ), the labels as _base.cpp states them
    this.m_xOffset = new UNIT_BINDER(aFrame, 'Offset X:');
    this.m_yOffset = new UNIT_BINDER(aFrame, 'Offset Y:');
    this.m_xOffset.SetText('0');
    this.m_yOffset.SetText('0');

    this.m_xOffset.SetCoordType(COORD_TYPES_T.REL_X_COORD);
    this.m_yOffset.SetCoordType(COORD_TYPES_T.REL_Y_COORD);

    // SetInitialFocus( m_xEntry ), SetupStandardButtons(), finishDialogSettings(): the window's.
  }

  /** `DIALOG_SHIM::GetUserUnits()`. */
  GetUserUnits(): EdaUnits {
    return this.m_units;
  }

  /** The window's subscription: called after every change of the dialog's state. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  GetVersion(): number {
    return this.m_version;
  }

  private notify(): void {
    this.m_version++;
    for (const l of [...this.m_listeners]) l();
  }

  GetXLabel(): string {
    return this.m_xOffset.GetLabel();
  }
  GetYLabel(): string {
    return this.m_yOffset.GetLabel();
  }
  GetXUnitLabel(): string {
    return unitLabel(this.m_xOffset.GetUnits());
  }
  GetYUnitLabel(): string {
    return unitLabel(this.m_yOffset.GetUnits());
  }

  /** `OnTextFocusLost`. */
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

  /** `OnClear`: which of the two Reset buttons was clicked. */
  OnClear(aWhich: 'x' | 'y'): void {
    const offset = this.m_originalOffset;
    const { r, q } = ToPolar(offset.x, offset.y);

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

  /** `OnPolarChanged`: the check box has already toggled. */
  OnPolarChanged(aChecked: boolean = this.m_polarCoords): void {
    this.m_polarCoords = aChecked;

    const newPolar = this.m_polarCoords;
    const xOffset = this.m_xOffset.GetDoubleValue();
    const yOffset = this.m_yOffset.GetDoubleValue();
    this.updateDialogControls(newPolar);

    if (newPolar) {
      if (xOffset !== this.m_stateX || yOffset !== this.m_stateY) {
        this.m_stateX = xOffset;
        this.m_stateY = yOffset;
        const { r, q } = ToPolar(this.m_stateX, this.m_stateY);
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

  TransferDataToWindow(): boolean {
    this.m_xOffset.ChangeValue(this.m_originalOffset.x);
    this.m_yOffset.ChangeValue(this.m_originalOffset.y);

    if (this.m_polarCoords) this.OnPolarChanged(this.m_polarCoords);

    this.notify();
    return true;
  }

  TransferDataFromWindow(): boolean {
    if (this.m_polarCoords) {
      this.m_stateRadius = this.m_xOffset.GetDoubleValue();
      this.m_stateTheta = this.m_yOffset.GetAngleValue();

      this.m_updatedOffset.x = KiROUND(this.m_stateRadius * this.m_stateTheta.Cos());
      this.m_updatedOffset.y = KiROUND(this.m_stateRadius * this.m_stateTheta.Sin());
    } else {
      this.m_updatedOffset.x = this.m_xOffset.GetIntValue();
      this.m_updatedOffset.y = this.m_yOffset.GetIntValue();
    }

    return true;
  }
}
