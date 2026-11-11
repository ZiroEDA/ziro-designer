// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MOVE_EXACT` (pcbnew/dialogs/dialog_move_exact.cpp + .h): EDIT_TOOL::MoveExact's
 * translation, rotation and rotation anchor, typed. The dialog edits the tool's
 * MOVE_EXACT_VALUES in place on OK (KiCad's references `m_translation`, `m_rotation`,
 * `m_rotationAnchor`); the tool then moves translate-then-rotate.
 *
 * The polar box does not add fields, it re-reads the two it has: X and Y become distance and
 * bearing (updateDialogControls), and OnPolarChanged converts the typed values each way, keeping
 * the other form in m_state* so a round trip shows what was typed.
 *
 * `DialogMoveExact` below is the window, DIALOG_MOVE_EXACT_BASE over the class.
 */
import { type JSX, useEffect, useReducer, useRef, useState } from 'react';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { wxChoice } from '@ziroeda/wx/choice.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { DIALOG_MOVE_EXACT_BASE, type UNIT } from './dialog_move_exact_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `ROTATION_ANCHOR` (dialog_move_exact.h). */
export enum ROTATION_ANCHOR {
  ROTATE_AROUND_ITEM_ANCHOR,
  ROTATE_AROUND_SEL_CENTER,
  ROTATE_AROUND_USER_ORIGIN,
  ROTATE_AROUND_AUX_ORIGIN,
}

/** What DIALOG_MOVE_EXACT edits in place: the translation, the rotation and its anchor. */
export interface MOVE_EXACT_VALUES {
  translation: VECTOR2I;
  rotation: EDA_ANGLE;
  rotationAnchor: ROTATION_ANCHOR;
}

/** The base's title; DIALOG_MOVE_EXACT_BASE( parent, …, _( "Move Item" ) ). */
export const DIALOG_MOVE_EXACT_TITLE = _HKI('Move Item');

/** `std::numeric_limits<int>::max() * M_SQRT1_2`: as far as a selection may be moved. */
const MAX_BORDER = 2147483647 * Math.SQRT1_2;

export class DIALOG_MOVE_EXACT {
  private readonly m_values: MOVE_EXACT_VALUES;
  private readonly m_bbox: BOX2I;
  private readonly m_parent: PCB_BASE_FRAME;

  readonly m_moveX: UNIT_BINDER;
  readonly m_moveY: UNIT_BINDER;
  readonly m_rotate: UNIT_BINDER;
  readonly m_anchorOptions = new wxChoice();
  m_polarCoords = false;
  /** DIALOG_SHIM's `m_hash_key`. */
  readonly m_hash_key: string;
  /** OnTextChanged's verdict: the entries' red tool tip, and the affirmative button's Enable. */
  m_invalidLength = '';
  m_okEnabled = true;

  private readonly m_menuIDs: ROTATION_ANCHOR[] = [];
  private m_stateX = 0.0;
  private m_stateY = 0.0;
  private m_stateRadius = 0.0;
  private m_stateTheta: EDA_ANGLE = ANGLE_0;

  constructor(aParent: PCB_BASE_FRAME, aValues: MOVE_EXACT_VALUES, aBbox: BOX2I) {
    this.m_parent = aParent;
    this.m_values = aValues;
    this.m_bbox = aBbox;
    this.m_moveX = new UNIT_BINDER(aParent, _('Move X:'));
    this.m_moveY = new UNIT_BINDER(aParent, _('Move Y:'));
    this.m_rotate = new UNIT_BINDER(aParent, _('Rotate:'));

    // The base's wxTextCtrl( …, _("0"), … ).
    this.m_moveX.SetText('0');
    this.m_moveY.SetText('0');
    this.m_rotate.SetText('0');

    // Configure display origin transforms
    this.m_moveX.SetCoordType(COORD_TYPES_T.REL_X_COORD);
    this.m_moveY.SetCoordType(COORD_TYPES_T.REL_Y_COORD);

    this.m_menuIDs.push(aValues.rotationAnchor);
    this.m_menuIDs.push(ROTATION_ANCHOR.ROTATE_AROUND_USER_ORIGIN);

    if (aParent.IsType(FRAME_T.FRAME_PCB_EDITOR))
      this.m_menuIDs.push(ROTATION_ANCHOR.ROTATE_AROUND_AUX_ORIGIN);

    // DIALOG_SHIM needs a title- and anchor-options-specific hash_key so we don't save/restore
    // state between usage cases.
    let key = DIALOG_MOVE_EXACT_TITLE;

    if (aValues.rotationAnchor === ROTATION_ANCHOR.ROTATE_AROUND_SEL_CENTER)
      key += '|with_selection';

    if (aParent.IsType(FRAME_T.FRAME_PCB_EDITOR)) key += '|pcb_editor';

    this.m_hash_key = key;

    this.buildRotationAnchorMenu();
    this.m_rotate.SetUnits('degrees');
  }

  private buildRotationAnchorMenu(): void {
    const menuItems: string[] = [];

    for (const anchorID of this.m_menuIDs) {
      switch (anchorID) {
        case ROTATION_ANCHOR.ROTATE_AROUND_ITEM_ANCHOR:
          menuItems.push(_('Rotate around item anchor'));
          break;
        case ROTATION_ANCHOR.ROTATE_AROUND_SEL_CENTER:
          menuItems.push(_('Rotate around selection center'));
          break;
        case ROTATION_ANCHOR.ROTATE_AROUND_USER_ORIGIN:
          menuItems.push(_('Rotate around local coordinates origin'));
          break;
        case ROTATION_ANCHOR.ROTATE_AROUND_AUX_ORIGIN:
          menuItems.push(_('Rotate around drill/place origin'));
          break;
      }
    }

    // `m_anchorOptions->Set( menuItems )`
    this.m_anchorOptions.Clear();
    this.m_anchorOptions.Append(menuItems);

    // This can be -1 if uninitialized
    const currSelection = this.m_anchorOptions.GetSelection();

    if (currSelection < 0 || currSelection >= this.m_menuIDs.length)
      this.m_anchorOptions.SetSelection(0);
  }

  /** `ToPolarDeg`: linear units are not considered, the answer is in the units given. */
  private ToPolarDeg(x: number, y: number): { r: number; q: EDA_ANGLE } {
    // convert to polar coordinates
    const r = Math.hypot(x, y);

    return { r, q: r !== 0 ? EDA_ANGLE.fromVector({ x, y }) : ANGLE_0 };
  }

  /** `GetTranslationInIU`: the Cartesian translation the entries describe. */
  private GetTranslationInIU(polar: boolean): { x: number; y: number } {
    if (polar) {
      const r = this.m_moveX.GetDoubleValue();
      const q = this.m_moveY.GetAngleValue();

      return { x: r * q.Cos(), y: r * q.Sin() };
    }

    // direct read
    return { x: this.m_moveX.GetDoubleValue(), y: this.m_moveY.GetDoubleValue() };
  }

  OnPolarChanged(): void {
    const newPolar = this.m_polarCoords;
    const moveX = this.m_moveX.GetDoubleValue();
    const moveY = this.m_moveY.GetDoubleValue();
    this.updateDialogControls(newPolar);

    if (newPolar) {
      if (moveX !== this.m_stateX || moveY !== this.m_stateY) {
        this.m_stateX = moveX;
        this.m_stateY = moveY;
        const { r, q } = this.ToPolarDeg(this.m_stateX, this.m_stateY);
        this.m_stateRadius = r;
        this.m_stateTheta = q;

        this.m_moveX.SetDoubleValue(this.m_stateRadius);
        this.m_stateRadius = this.m_moveX.GetDoubleValue();
        this.m_moveY.SetAngleValue(this.m_stateTheta);
        this.m_stateTheta = this.m_moveY.GetAngleValue();
      } else {
        this.m_moveX.SetDoubleValue(this.m_stateRadius);
        this.m_moveY.SetAngleValue(this.m_stateTheta);
      }
    } else {
      if (moveX !== this.m_stateRadius || moveY !== this.m_stateTheta.AsDegrees()) {
        this.m_stateRadius = moveX;
        this.m_stateTheta = new EDA_ANGLE(moveY);
        this.m_stateX = this.m_stateRadius * this.m_stateTheta.Cos();
        this.m_stateY = this.m_stateRadius * this.m_stateTheta.Sin();

        this.m_moveX.SetDoubleValue(this.m_stateX);
        this.m_stateX = this.m_moveX.GetDoubleValue();
        this.m_moveY.SetDoubleValue(this.m_stateY);
        this.m_stateY = this.m_moveY.GetDoubleValue();
      } else {
        this.m_moveX.SetDoubleValue(this.m_stateX);
        this.m_moveY.SetDoubleValue(this.m_stateY);
      }
    }
  }

  private updateDialogControls(aPolar: boolean): void {
    if (aPolar) {
      this.m_moveX.SetLabel(_('Distance:')); // Polar radius
      this.m_moveY.SetLabel(_('Angle:')); // Polar theta or angle
      this.m_moveY.SetUnits('degrees');
    } else {
      this.m_moveX.SetLabel(_('Move X:'));
      this.m_moveY.SetLabel(_('Move Y:'));
      this.m_moveY.SetUnits(this.m_parent.GetUserUnits());
    }
  }

  /** `OnClear`, for the Reset button beside \a aCtrl. */
  OnClear(aCtrl: 'x' | 'y' | 'rot'): void {
    if (aCtrl === 'x') this.m_moveX.SetValue(0);
    else if (aCtrl === 'y') this.m_moveY.SetValue(0);
    else this.m_rotate.SetAngleValue(ANGLE_0);
  }

  TransferDataToWindow(): boolean {
    this.updateDialogControls(this.m_polarCoords);

    return true;
  }

  TransferDataFromWindow(): boolean {
    // for the output, we only deliver a Cartesian vector
    const translation = this.GetTranslationInIU(this.m_polarCoords);
    this.m_values.translation = { x: KiROUND(translation.x), y: KiROUND(translation.y) };
    this.m_values.rotation = this.m_rotate.GetAngleValue();

    const anchorSelection = this.m_anchorOptions.GetSelection();

    if (anchorSelection < 0 || anchorSelection >= this.m_menuIDs.length) return false;

    this.m_values.rotationAnchor = this.m_menuIDs[anchorSelection]!;

    return true;
  }

  /** `OnTextFocusLost`: reset a text field to be 0 if it was exited while blank. */
  OnTextFocusLost(aBinder: UNIT_BINDER): void {
    if (aBinder.GetText() === '') aBinder.SetText('0');
  }

  /** `OnTextChanged` (m_xEntry and m_yEntry only). */
  OnTextChanged(): void {
    const delta_x = this.m_moveX.GetDoubleValue();
    const delta_y = this.m_moveY.GetDoubleValue();
    const b = this.m_bbox;

    if (
      b.GetLeft() + delta_x < -MAX_BORDER ||
      b.GetRight() + delta_x > MAX_BORDER ||
      b.GetTop() + delta_y < -MAX_BORDER ||
      b.GetBottom() + delta_y > MAX_BORDER
    ) {
      this.m_invalidLength = _(
        'Invalid movement values.  Movement would place selection outside of the maximum board area.',
      );
      this.m_okEnabled = false;
    } else {
      this.m_invalidLength = '';
      this.m_okEnabled = true;
    }
  }
}

/** `ShowModal()` of DIALOG_MOVE_EXACT: `onClose( true )` is wxID_OK. */
export function DialogMoveExact({
  dialog,
  onClose,
}: {
  dialog: DIALOG_MOVE_EXACT;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const xRef = useRef<HTMLInputElement>(null);

  // OnInitDialog -> TransferDataToWindow; the first entry has the focus.
  useState(() => dialog.TransferDataToWindow());
  useEffect(() => {
    xRef.current?.focus();
  }, []);

  const unit = (aBinder: UNIT_BINDER, aChanged?: () => void): UNIT => ({
    label: aBinder.GetLabel(),
    value: aBinder.GetText(),
    units: unitLabel(aBinder.GetUnits()),
    invalid: aChanged && dialog.m_invalidLength ? dialog.m_invalidLength : undefined,
    onChange: (aText) => {
      aBinder.SetText(aText);
      aChanged?.();
      bump();
    },
    onBlur: () => {
      dialog.OnTextFocusLost(aBinder);
      bump();
    },
  });
  const textChanged = (): void => dialog.OnTextChanged();
  const clear = (aCtrl: 'x' | 'y' | 'rot') => () => {
    dialog.OnClear(aCtrl);
    bump();
  };

  return (
    <DIALOG_MOVE_EXACT_BASE
      title={DIALOG_MOVE_EXACT_TITLE}
      hashKey={dialog.m_hash_key}
      m_moveX={{ ...unit(dialog.m_moveX, textChanged), inputRef: xRef }}
      m_moveY={unit(dialog.m_moveY, textChanged)}
      m_rotate={unit(dialog.m_rotate)}
      onClearX={clear('x')}
      onClearY={clear('y')}
      onClearRot={clear('rot')}
      m_anchorOptions={{
        value: dialog.m_anchorOptions.GetSelection(),
        choices: dialog.m_anchorOptions.GetStrings(),
        onChange: (aRow) => {
          dialog.m_anchorOptions.SetSelection(aRow);
          bump();
        },
      }}
      m_polarCoords={{
        value: dialog.m_polarCoords,
        onChange: (aOn) => {
          dialog.m_polarCoords = aOn;
          dialog.OnPolarChanged();
          bump();
        },
      }}
      okEnabled={dialog.m_okEnabled}
      onOK={() => {
        if (dialog.m_okEnabled && dialog.TransferDataFromWindow()) onClose(true);
      }}
      onCancel={() => onClose(false)}
    />
  );
}
