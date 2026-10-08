// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME::AutoRotateItem (sch_edit_frame.cpp:1792), SCH_SCREEN::GetLabelOrientationForPoint
 * (sch_screen.cpp:563) and GetPinSpinStyle (symb_transforms_utils.cpp:108): a label placed with
 * auto-rotate turns away from the pin or along the wire end it lands on.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_HIERLABEL, SCH_LABEL, SPIN_STYLE } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { GetPinSpinStyle } from '@ziroeda/eeschema/symb_transforms_utils.js';
import { SYMBOL_ORIENTATION_T } from '@ziroeda/eeschema/symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MIL = 254;
const { LEFT, RIGHT, UP, BOTTOM } = SPIN_STYLE;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

/** A symbol at the origin with one pin of orientation \a aOrient, its connection point at (-100, 0). */
function symbolWithPin(aOrient: PIN_ORIENTATION, aSymOrient = SYMBOL_ORIENTATION_T.SYM_ORIENT_0) {
  const lib = new LIB_SYMBOL('U');
  const pin = new SCH_PIN(lib);
  pin.SetPosition({ x: -100 * MIL, y: 0 });
  pin.SetOrientation(aOrient);
  pin.SetNumber('1');
  lib.AddDrawItem(pin);
  const sym = new SCH_SYMBOL(lib, new LIB_ID('L', 'U'), null, 1, 0, { x: 0, y: 0 });
  sym.SetOrientation(aSymOrient);
  return sym;
}

describe('GetPinSpinStyle', () => {
  const spin = (o: PIN_ORIENTATION, s = SYMBOL_ORIENTATION_T.SYM_ORIENT_0) => {
    const sym = symbolWithPin(o, s);
    return GetPinSpinStyle(sym.GetPins()[0]!, sym).valueOf();
  };

  it('faces away from the body', () => {
    expect(spin(PIN_ORIENTATION.PIN_RIGHT)).toBe(LEFT);
    expect(spin(PIN_ORIENTATION.PIN_LEFT)).toBe(RIGHT);
    expect(spin(PIN_ORIENTATION.PIN_UP)).toBe(BOTTOM);
    expect(spin(PIN_ORIENTATION.PIN_DOWN)).toBe(UP);
  });

  it('turns with the symbol', () => {
    expect(spin(PIN_ORIENTATION.PIN_RIGHT, SYMBOL_ORIENTATION_T.SYM_ORIENT_90)).toBe(BOTTOM);
    expect(spin(PIN_ORIENTATION.PIN_RIGHT, SYMBOL_ORIENTATION_T.SYM_ORIENT_270)).toBe(UP);
    expect(spin(PIN_ORIENTATION.PIN_RIGHT, SYMBOL_ORIENTATION_T.SYM_ORIENT_180)).toBe(RIGHT);
    expect(spin(PIN_ORIENTATION.PIN_UP, SYMBOL_ORIENTATION_T.SYM_ORIENT_90)).toBe(RIGHT);
    expect(spin(PIN_ORIENTATION.PIN_UP, SYMBOL_ORIENTATION_T.SYM_ORIENT_270)).toBe(LEFT);
  });

  it('mirrors with the symbol', () => {
    expect(spin(PIN_ORIENTATION.PIN_RIGHT, SYMBOL_ORIENTATION_T.SYM_MIRROR_Y)).toBe(RIGHT);
    expect(spin(PIN_ORIENTATION.PIN_UP, SYMBOL_ORIENTATION_T.SYM_MIRROR_X)).toBe(UP);
    expect(
      spin(
        PIN_ORIENTATION.PIN_UP,
        SYMBOL_ORIENTATION_T.SYM_ORIENT_90 + SYMBOL_ORIENTATION_T.SYM_MIRROR_Y,
      ),
    ).toBe(LEFT);
    expect(
      spin(
        PIN_ORIENTATION.PIN_RIGHT,
        SYMBOL_ORIENTATION_T.SYM_ORIENT_270 + SYMBOL_ORIENTATION_T.SYM_MIRROR_X,
      ),
    ).toBe(BOTTOM);
    expect(
      spin(
        PIN_ORIENTATION.PIN_RIGHT,
        SYMBOL_ORIENTATION_T.SYM_ORIENT_180 + SYMBOL_ORIENTATION_T.SYM_MIRROR_Y,
      ),
    ).toBe(LEFT);
  });
});

describe('SCH_SCREEN::GetLabelOrientationForPoint', () => {
  const screen = () => {
    const s = new SCH_SCREEN(null);
    return s;
  };
  const dflt = () => new SPIN_STYLE(UP);

  it('keeps the default on empty space', () => {
    expect(screen().GetLabelOrientationForPoint({ x: 0, y: 0 }, dflt(), null).valueOf()).toBe(UP);
  });

  it('takes the pin it lands on', () => {
    const s = screen();
    s.Append(symbolWithPin(PIN_ORIENTATION.PIN_RIGHT));
    expect(s.GetLabelOrientationForPoint({ x: -100 * MIL, y: 0 }, dflt(), null).valueOf()).toBe(
      LEFT,
    );
  });

  it('follows a horizontal wire: out of its end, back from its start', () => {
    const s = screen();
    const w = new SCH_LINE({ x: 0, y: 0 });
    w.SetEndPoint({ x: 500 * MIL, y: 0 });
    s.Append(w);
    expect(s.GetLabelOrientationForPoint({ x: 500 * MIL, y: 0 }, dflt(), null).valueOf()).toBe(
      RIGHT,
    );
    expect(s.GetLabelOrientationForPoint({ x: 0, y: 0 }, dflt(), null).valueOf()).toBe(LEFT);
  });

  it('follows a reversed horizontal wire', () => {
    const s = screen();
    const w = new SCH_LINE({ x: 500 * MIL, y: 0 });
    w.SetEndPoint({ x: 0, y: 0 });
    s.Append(w);
    expect(s.GetLabelOrientationForPoint({ x: 0, y: 0 }, dflt(), null).valueOf()).toBe(LEFT);
    expect(s.GetLabelOrientationForPoint({ x: 500 * MIL, y: 0 }, dflt(), null).valueOf()).toBe(
      RIGHT,
    );
  });

  it('follows vertical wires both ways', () => {
    const s = screen();
    const w = new SCH_LINE({ x: 0, y: 0 });
    w.SetEndPoint({ x: 0, y: 500 * MIL });
    s.Append(w);
    expect(s.GetLabelOrientationForPoint({ x: 0, y: 500 * MIL }, dflt(), null).valueOf()).toBe(
      BOTTOM,
    );
    expect(s.GetLabelOrientationForPoint({ x: 0, y: 0 }, dflt(), null).valueOf()).toBe(UP);
    const s2 = screen();
    const r = new SCH_LINE({ x: 0, y: 500 * MIL });
    r.SetEndPoint({ x: 0, y: 0 });
    s2.Append(r);
    expect(s2.GetLabelOrientationForPoint({ x: 0, y: 0 }, dflt(), null).valueOf()).toBe(UP);
    expect(s2.GetLabelOrientationForPoint({ x: 0, y: 500 * MIL }, dflt(), null).valueOf()).toBe(
      BOTTOM,
    );
  });
});

describe('SCH_EDIT_FRAME::AutoRotateItem', () => {
  function frame() {
    const f = new SCH_EDIT_FRAME({
      crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
      highlightNet: () => {},
      assignFootprints: () => {},
      saveProject: () => true,
    });
    const sch = new SCHEMATIC(null);
    sch.CreateDefaultScreens();
    f.SetSchematic(sch);
    return f;
  }

  it('turns a hierarchical label set to auto-rotate away from the pin under it', () => {
    const f = frame();
    const screen = f.GetScreen()!;
    screen.Append(symbolWithPin(PIN_ORIENTATION.PIN_RIGHT));
    const label = new SCH_HIERLABEL({ x: -100 * MIL, y: 0 });
    label.SetSpinStyle(new SPIN_STYLE(RIGHT));
    label.SetAutoRotateOnPlacement(true);
    f.AutoRotateItem(screen, label);
    expect(label.GetSpinStyle().valueOf()).toBe(LEFT);
  });

  it('leaves it alone without auto-rotate, and leaves local labels alone', () => {
    const f = frame();
    const screen = f.GetScreen()!;
    screen.Append(symbolWithPin(PIN_ORIENTATION.PIN_RIGHT));
    const hier = new SCH_HIERLABEL({ x: -100 * MIL, y: 0 });
    hier.SetSpinStyle(new SPIN_STYLE(RIGHT));
    f.AutoRotateItem(screen, hier);
    expect(hier.GetSpinStyle().valueOf()).toBe(RIGHT);
    const local = new SCH_LABEL({ x: -100 * MIL, y: 0 });
    local.SetSpinStyle(new SPIN_STYLE(RIGHT));
    local.SetAutoRotateOnPlacement(true);
    f.AutoRotateItem(screen, local);
    expect(local.GetSpinStyle().valueOf()).toBe(RIGHT);
  });
});
