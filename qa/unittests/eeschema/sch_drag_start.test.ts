// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a left-button drag turns into. Counterpart: the `evt->IsDrag( BUT_LEFT )`
 * arm of `SCH_SELECTION_TOOL::Main`, `selectionContains`, and
 * `RequestSelection( SCH_COLLECTOR::MovableItems )`.
 *
 * The case this file exists for is the second one: a press *near* a selected
 * symbol grips it. The canvas used to require the press to hit-test to the very
 * id that was selected, and a symbol's pins and fields are separate candidates
 * lying on top of its body — so pressing the symbol you had just selected
 * frequently resolved to a pin instead and drew a selection rectangle.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  GRIP_MARGIN_PX,
  leftDragStart,
  requestMovableSelection,
  selectionContains,
} from '@ziroeda/eeschema/src/tools/sch_drag_start.js';
import { collectPinSegments, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const at = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });

const doc: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 103 98 0))
      (property "Value" "10k" (at 103 102 0)))
    (wire (pts (xy 60 60) (xy 80 60)) (stroke (width 0) (type default)) (uuid "w1")))`),
);
const R1 = refId('symbol', 'r1', 0);

/**
 * `GRIP_MARGIN_PX` in world units. The canvas divides it by the view scale;
 * at a zoom where a 1.27 mm grid square is about 16 device pixels, 20 pixels
 * works out at roughly 1.6 mm, so 1 mm is a conservative stand-in.
 */
const margin = mmToIU(1);

describe('selectionContains (the grip test)', () => {
  it('uses the same grip margin upstream does', () => {
    expect(GRIP_MARGIN_PX).toBe(20);
  });

  it('grips a selected symbol from its own body', () => {
    expect(selectionContains(doc, LIB, new Set([R1]), at(100, 100), margin)).toBe(true);
  });

  it('grips it from a pin, which is what a second press usually lands on', () => {
    // The reported failure: press once, the symbol selects; press again a
    // couple of pixels over and the hit test answers "pin", not "symbol".
    // The grip test never asks, so it grips either way.
    const pin = collectPinSegments(doc, LIB)[0]!;
    expect(selectionContains(doc, LIB, new Set([R1]), pin.at, margin)).toBe(true);
  });

  it('grips it from its reference text, which ViewBBox covers', () => {
    expect(selectionContains(doc, LIB, new Set([R1]), at(103, 98), margin)).toBe(true);
  });

  it('does not grip from the other side of the sheet', () => {
    expect(selectionContains(doc, LIB, new Set([R1]), at(70, 60), margin)).toBe(false);
  });

  it('grips nothing when nothing is selected', () => {
    expect(selectionContains(doc, LIB, new Set(), at(100, 100), margin)).toBe(false);
  });
});

describe('requestMovableSelection (RequestSelection over MovableItems)', () => {
  it('drops pins, which are selectable but not movable', () => {
    const pin = collectPinSegments(doc, LIB)[0]!.id;
    expect([...requestMovableSelection(new Set([R1, pin]), null)]).toEqual([R1]);
  });

  it('takes what the press is over when nothing is selected', () => {
    expect([...requestMovableSelection(new Set(), { kind: 'symbol', id: R1 })]).toEqual([R1]);
  });

  it('but not a pin, so pressing one never starts a move that cannot move', () => {
    const pin = collectPinSegments(doc, LIB)[0]!.id;
    expect(requestMovableSelection(new Set(), { kind: 'pin', id: pin }).size).toBe(0);
  });
});

describe('leftDragStart', () => {
  const base = {
    hasModifier: false,
    action: 'drag_selected' as const,
    dragIsMove: false,
    selectionEmpty: false,
    gripped: true,
  };

  it('drags a gripped selection', () => {
    expect(leftDragStart(base)).toBe('drag');
  });

  it('moves it instead when drag_is_move is on', () => {
    expect(leftDragStart({ ...base, dragIsMove: true })).toBe('move');
  });

  it('rubber-bands with a modifier held, whatever is gripped', () => {
    // `hasModifier() || drag_action == SELECT` is tested first upstream, so
    // shift-drag extends a selection and never moves one.
    expect(leftDragStart({ ...base, hasModifier: true })).toBe('box');
  });

  it('rubber-bands in SELECT mode', () => {
    expect(leftDragStart({ ...base, action: 'select' })).toBe('box');
  });

  it('rubber-bands from empty space with nothing selected', () => {
    expect(leftDragStart({ ...base, selectionEmpty: true, gripped: false })).toBe('box');
  });

  it('but drag_any grabs an unselected item in one gesture', () => {
    expect(leftDragStart({ ...base, action: 'drag_any', selectionEmpty: true })).toBe('drag');
  });

  it('rubber-bands when the press is outside the selection', () => {
    expect(leftDragStart({ ...base, gripped: false })).toBe('box');
  });
});
