// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The parts of `UNIT_BINDER` (common/widgets/unit_binder.cpp) that the
 * Position Relative and Offset Item dialogs use beyond a plain distance: the
 * display origin (`SetCoordType`), `SetUnits`, `SetLabel` and the angle pair
 * `SetAngleValue` / `GetAngleValue`.
 *
 * The frame is a real PCB frame, so the transforms are `PCB_ORIGIN_TRANSFORMS`,
 * whose `ToDisplay( EDA_ANGLE )` negates a relative coordinate's angle unless
 * the Y axis is inverted (pcb_origin_transforms.cpp:76-77) - which is what the
 * expected texts below are derived from.
 */
import { describe, expect, it } from 'vitest';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../pcbnew/support/test_pcb_frame.js';

const MM = 1_000_000;

function frame(invertY: boolean): TEST_PCB_FRAME {
  const f = new TEST_PCB_FRAME(
    ParseBoard(
      '(kicad_pcb (version 20241229) (generator "t") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))',
    ),
  );
  f.settings.m_Display.m_DisplayInvertYAxis = invertY;
  return f;
}

describe('UNIT_BINDER display origin', () => {
  it('SetDoubleValue goes through ToDisplay and GetDoubleValue back through FromDisplay (:434, :603)', () => {
    const b = new UNIT_BINDER(frame(true), 'Offset Y:');
    b.SetCoordType(COORD_TYPES_T.REL_Y_COORD);
    // the Y axis is inverted, so a relative Y is shown with its sign flipped
    b.SetDoubleValue(2 * MM);
    expect(b.GetText()).toBe('-2');
    expect(b.GetDoubleValue()).toBe(2 * MM);
    expect(b.GetIntValue()).toBe(2 * MM);
  });

  it('a relative Y is shown as it is when the Y axis is not inverted', () => {
    const b = new UNIT_BINDER(frame(false), 'Offset Y:');
    b.SetCoordType(COORD_TYPES_T.REL_Y_COORD);
    b.SetDoubleValue(2 * MM);
    expect(b.GetText()).toBe('2');
  });

  it('with no coordinate type nothing is transformed', () => {
    const b = new UNIT_BINDER(frame(true), 'Width:');
    b.SetDoubleValue(2 * MM);
    expect(b.GetText()).toBe('2');
  });

  it('SetUnits( DEGREES ) writes the value as it is, with no IU scale (:159)', () => {
    const b = new UNIT_BINDER(frame(false), 'Angle:');
    b.SetUnits('degrees');
    expect(b.GetUnits()).toBe('degrees');
    b.SetDoubleValue(45);
    expect(b.GetText()).toBe('45');
    b.SetText('90');
    expect(b.GetDoubleValue()).toBe(90);
  });

  it("SetUnits( the frame's ) puts the entry back on the frame units", () => {
    const f = frame(false);
    f.SetUserUnits('mils');
    const b = new UNIT_BINDER(f, 'Angle:');
    b.SetUnits('degrees');
    b.SetUnits(f.GetUserUnits());
    expect(b.GetUnits()).toBe('mils');
  });

  it('without SetUnits the entry follows the frame live', () => {
    const f = frame(false);
    const b = new UNIT_BINDER(f, 'Width:');
    expect(b.GetUnits()).toBe('mm');
    f.SetUserUnits('in');
    expect(b.GetUnits()).toBe('in');
  });

  it('SetLabel changes what GetLabel and an error name (:691)', () => {
    const b = new UNIT_BINDER(frame(false), 'Offset X:');
    b.SetLabel('Distance:');
    expect(b.GetLabel()).toBe('Distance:');
  });

  it('SetAngleValue shows the angle negated when Y is not inverted (:447, pcb_origin_transforms.cpp:76)', () => {
    const b = new UNIT_BINDER(frame(false), 'Angle:');
    b.SetCoordType(COORD_TYPES_T.REL_Y_COORD);
    b.SetUnits('degrees');
    b.SetAngleValue(new EDA_ANGLE(30));
    expect(b.GetText()).toBe('-30');
  });

  it('GetAngleValue undoes it (:634)', () => {
    const b = new UNIT_BINDER(frame(false), 'Angle:');
    b.SetCoordType(COORD_TYPES_T.REL_Y_COORD);
    b.SetUnits('degrees');
    b.SetText('-30');
    expect(b.GetAngleValue().AsDegrees()).toBe(30);
  });

  it('with Y inverted the angle is shown as it is', () => {
    const b = new UNIT_BINDER(frame(true), 'Angle:');
    b.SetCoordType(COORD_TYPES_T.REL_Y_COORD);
    b.SetUnits('degrees');
    b.SetAngleValue(new EDA_ANGLE(30));
    // ToDisplay( angle ) keeps 30, then SetDoubleValue's own ToDisplay( REL_Y ) flips a
    // number when Y is inverted: both passes happen, as upstream calls them
    expect(b.GetText()).toBe('-30');
    expect(b.GetAngleValue().AsDegrees()).toBe(30);
  });

  it('ChangeValue writes like SetValue', () => {
    const b = new UNIT_BINDER(frame(false), 'Width:');
    b.ChangeValue(3 * MM);
    expect(b.GetText()).toBe('3');
  });
});
