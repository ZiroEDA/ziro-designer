// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A rotated symbol's reference and value keep reading horizontally.
 *
 * Three separate rules, and it takes all three to get there:
 *
 * 1. `SCH_SYMBOL::Rotate` (sch_symbol.cpp:2837-2853) never touches a field's
 *    stored text **angle**, and its explicit field loop only translates them by
 *    the symbol's own move vector. Their drawn **position** still turns with the
 *    body, because a symbol field's stored position is symbol-local and the
 *    drawn one is that mapped through the parent's transform
 *    (`SCH_FIELD::GetPosition`, sch_field.cpp:1425-1438).
 *    (`transform_symbol_fields.test.ts` pins that half against a KiCad probe.)
 * 2. `SCH_FIELD::GetDrawRotation` (sch_field.cpp:446-465) nevertheless *draws*
 *    a horizontal field vertically once its parent's transform has `y1 != 0`:
 *
 *        if( parentSymbol->GetTransform().y1 )   // Rotate symbol 90 degrees.
 *        {
 *            if( orient.IsHorizontal() ) orient = ANGLE_VERTICAL;
 *            else                        orient = ANGLE_HORIZONTAL;
 *        }
 *
 *    So rules 1 and 2 on their own give exactly the reported bug: the reference
 *    runs vertically up the side of the rotated body.
 * 3. `SCH_EDIT_TOOL::Rotate` puts it back, by re-running the autoplacer
 *    (sch_edit_tool.cpp:1022-1029):
 *
 *        if( m_frame->eeconfig()->m_AutoplaceFields.enable )
 *        {
 *            AUTOPLACE_ALGO fieldsAutoplaced = symbol->GetFieldsAutoplaced();
 *            if( fieldsAutoplaced == AUTOPLACE_AUTO || fieldsAutoplaced == AUTOPLACE_MANUAL )
 *                symbol->AutoplaceFields( screen, fieldsAutoplaced );
 *        }
 *
 *    and the autoplacer stores the *counteracting* angle on purpose
 *    (autoplace_fields.cpp:119-121): "Fields always display horizontally after
 *    autoplace. For 90/270 rotated symbols, GetDrawRotation() flips the stored
 *    angle, so we store VERTICAL to counteract the transform and produce
 *    horizontal display."
 *
 * Mirror is deliberately not the same: its single-item arm sets the orientation
 * and then `SetFieldsAutoplaced( AUTOPLACE_NONE )` (sch_edit_tool.cpp:1323-1331).
 * It never autoplaces, and it stops a later rotate from autoplacing either.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib, serializeSchematic } from '@ziroeda/eeschema';
import { transformItems, type TransformAutoplace } from '@ziroeda/eeschema/src/tools/transform.js';
import {
  autoplaceFields,
  autoplacePlacedSymbol,
} from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { fieldDrawRotation } from '@ziroeda/eeschema/src/fieldbox.js';
import type { LibSymbol, SchSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

/** `autoplaced` writes `(fields_autoplaced yes)`, which reads back as AUTOPLACE_AUTO. */
const sheet = (autoplaced: boolean, extra = ''): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
      (symbol (lib_id "R") (at 100 100 0) (unit 1)${autoplaced ? ' (fields_autoplaced yes)' : ''} (uuid "r1")
        (property "Reference" "R1" (at 103 98 0) (effects (font (size 1.27 1.27)) (justify left)))
        (property "Value" "10k" (at 103 102 0) (effects (font (size 1.27 1.27)) (justify left))))
      ${extra})`),
  );

const ID = refId('symbol', 'r1', 0);
const OTHER = refId('symbol', 'r2', 0);

/** `m_AutoplaceFields`, as the schematic editor's rotate handler passes it. */
const prefs = (enable: boolean): TransformAutoplace => ({
  enable,
  libById: LIB,
  opts: { allowRejustify: true, alignToGrid: true },
});

const rotate = (
  d: Schematic,
  op: 'rotateCW' | 'rotateCCW' | 'mirrorX' | 'mirrorY',
  ap: TransformAutoplace | undefined,
  ids: ReadonlySet<string> = new Set([ID]),
): Schematic => transformItems(ids, op, undefined, undefined, ap).apply(d);

/** How each field is actually drawn — the number the user sees the effect of. */
const drawn = (s: SchSymbol): (0 | 90)[] => s.fields.map((f) => fieldDrawRotation(f, s));
const stored = (s: SchSymbol): number[] => s.fields.map((f) => f.angle);
const at = (s: SchSymbol): (string | undefined)[] =>
  s.fields.map((f) => (f.at ? `${f.at.x},${f.at.y}` : undefined));

const ROTATIONS = ['rotateCW', 'rotateCCW'] as const;
const MIRRORS = ['mirrorX', 'mirrorY'] as const;

/**
 * Where this sheet's two fields land when nothing re-places them — the symbol's
 * transform alone carrying them round, per rule 1 above.
 *
 * The symbol sits at (100, 100) mm, its reference at (103, 98) and its value at
 * (103, 102), so the offsets are (+30000, -20000) and (+30000, +20000) in IU.
 * In +Y-down screen space CW is (x, y) -> (-y, x) and CCW is (x, y) -> (y, -x);
 * `mirrorX` (KiCad's hotkey Y, MirrorVertically) negates y and `mirrorY`
 * (hotkey X, MirrorHorizontally) negates x. Measured in KiCad 10.0.5 on a
 * `Device:D` at (50.8, 50.8) with its reference 2.54 mm above the body and no
 * `fields_autoplaced`: R left it 2.54 mm to the *left* of the body,
 * Shift+R 2.54 mm to the right, X unmoved (no x offset to flip) and Y 2.54 mm
 * below — the same four rules.
 */
const TURNED: Record<(typeof ROTATIONS | typeof MIRRORS)[number], string[]> = {
  rotateCW: ['1020000,1030000', '980000,1030000'],
  rotateCCW: ['980000,970000', '1020000,970000'],
  mirrorX: ['1030000,1020000', '1030000,980000'],
  mirrorY: ['970000,980000', '970000,1020000'],
};

describe.each(ROTATIONS)('%s, on an autoplaced symbol with the preference on', (op) => {
  const before = sheet(true);
  const after = rotate(before, op, prefs(true));
  const s = after.symbols[0]!;

  it('turns the body', () => {
    expect(s.angle).toBe(op === 'rotateCW' ? 270 : 90);
  });

  it('leaves every field reading horizontally', () => {
    // The whole point. Before the fix these came back [90, 90].
    expect(drawn(s)).toEqual([0, 0]);
  });

  it('gets there by storing the counteracting angle, not by leaving it alone', () => {
    // `m_field_angle = m_symbol->GetTransform().y1 ? ANGLE_VERTICAL : ANGLE_HORIZONTAL`.
    // Storing 0 here would draw at 90; that is the bug, and it is why the
    // stored value has to be asserted as well as the drawn one.
    expect(stored(s)).toEqual([90, 90]);
    expect(stored(before.symbols[0]!)).toEqual([0, 0]);
  });

  it('moves them, because the autoplacer chose where they go', () => {
    expect(at(s)).not.toEqual(at(before.symbols[0]!));
  });

  it('keeps the symbol flagged as autoplaced, so the next R does it again', () => {
    expect(s.fieldsAutoplaced).toBe('auto');
    expect(rotate(after, op, prefs(true)).symbols[0]!.fieldsAutoplaced).toBe('auto');
  });
});

describe.each(ROTATIONS)('%s, with the Autoplace Fields preference off', (op) => {
  it('leaves the fields exactly as SCH_SYMBOL::Rotate does — position and angle', () => {
    // `m_AutoplaceFields.enable` gates the whole block, so this is rules 1 and 2
    // alone: the fields swing round with the transform, their stored angle is
    // untouched, and the drawn angle therefore flips. Upstream behaves the same
    // way with the preference off, and this is what says the fix is the gate and
    // not a change to `Rotate` itself.
    const before = sheet(true);
    const after = rotate(before, op, prefs(false));
    expect(at(after.symbols[0]!)).toEqual(TURNED[op]);
    expect(stored(after.symbols[0]!)).toEqual([0, 0]);
    expect(drawn(after.symbols[0]!)).toEqual([90, 90]);
  });
});

describe.each(ROTATIONS)('%s, on a symbol whose fields the user placed', (op) => {
  it('does not touch them: AUTOPLACE_NONE fails the flag test', () => {
    // `if( fieldsAutoplaced == AUTOPLACE_AUTO || fieldsAutoplaced == AUTOPLACE_MANUAL )`.
    // A reference dragged where the user wants it is not re-placed — it keeps
    // the side of the body it was on, rather than being recomputed. It still
    // travels with the body, because that is the transform and not the
    // autoplacer: this is the exact case measured on KiCad's D1/D2, which have
    // no `fields_autoplaced` and whose fields ended up beside the turned body.
    const before = sheet(false);
    expect(before.symbols[0]!.fieldsAutoplaced).toBeUndefined();
    const after = rotate(before, op, prefs(true));
    expect(at(after.symbols[0]!)).toEqual(TURNED[op]);
    expect(stored(after.symbols[0]!)).toEqual([0, 0]);
  });
});

describe.each(MIRRORS)('%s', (op) => {
  const before = sheet(true);
  const after = rotate(before, op, prefs(true));
  const s = after.symbols[0]!;

  it('mirrors the body', () => {
    expect(s.mirror).toBe(op === 'mirrorX' ? 'x' : 'y');
  });

  it('never autoplaces: the fields are only flipped, never re-placed', () => {
    // The single-item mirror arm calls `SetOrientation` and nothing else — no
    // `MirrorHorizontally`, no autoplace. The orientation is still what the
    // drawn field position is read through, so each field crosses the axis;
    // nothing recomputes where it belongs. Measured on KiCad's D3 (hotkey X,
    // fields on the centre line so the numbers do not move) and D4 (hotkey Y,
    // reference and value swap sides).
    expect(at(s)).toEqual(TURNED[op]);
    expect(stored(s)).toEqual([0, 0]);
  });

  it('draws them the same way as before, since a mirror leaves y1 at zero', () => {
    expect(drawn(s)).toEqual(drawn(before.symbols[0]!));
  });

  it('clears the autoplaced flag (`SetFieldsAutoplaced( AUTOPLACE_NONE )`)', () => {
    expect(s.fieldsAutoplaced).toBeUndefined();
  });

  it('so a rotate after it no longer re-places the fields', () => {
    // Not "the fields do not move" — they turn with the body, as always. What
    // the cleared flag buys is that the autoplacer does not run, so the stored
    // angle is left at 0 and the offsets are simply the mirrored ones rotated
    // CW: (x, y) -> (-y, x) applied to `TURNED[op]`.
    const turned = rotate(after, 'rotateCW', prefs(true));
    expect(at(turned.symbols[0]!)).toEqual(
      op === 'mirrorX'
        ? ['980000,1030000', '1020000,1030000']
        : ['1020000,970000', '980000,970000'],
    );
    expect(stored(turned.symbols[0]!)).toEqual([0, 0]);
  });
});

describe('more than one item selected', () => {
  const two = sheet(
    true,
    `(symbol (lib_id "R") (at 120 100 0) (unit 1) (fields_autoplaced yes) (uuid "r2")
       (property "Reference" "R2" (at 123 98 0) (effects (font (size 1.27 1.27)) (justify left)))
       (property "Value" "1k" (at 123 102 0) (effects (font (size 1.27 1.27)) (justify left))))`,
  );
  const ids = new Set([ID, OTHER]);

  it('never autoplaces: the multi-item arm is `item->Rotate( rotPoint, … )` alone', () => {
    // `selection.GetSize() == 1` guards the whole switch that contains the
    // autoplace block; a group rotation goes through `SCH_SYMBOL::Rotate` and
    // nothing else.
    const after = rotate(two, 'rotateCW', prefs(true), ids);
    expect(stored(after.symbols[0]!)).toEqual([0, 0]);
    expect(stored(after.symbols[1]!)).toEqual([0, 0]);
  });

  it('moves each body about the selection centre and turns its fields with it', () => {
    // Two effects at once, and KiCad's D5/D6 pair shows both: the bodies orbit
    // the selection centre ("move the fields to the new position because the
    // symbol itself has moved"), while each field's offset from its own anchor
    // turns because that offset is read through the symbol's transform. Both
    // probe symbols came out of the group R with their reference at (-2.54, 0).
    //
    // Here the offsets start at (+30000, -20000) and (+30000, +20000), and CW in
    // +Y-down screen space is (x, y) -> (-y, x).
    const after = rotate(two, 'rotateCW', prefs(true), ids);
    for (let i = 0; i < 2; i++) {
      const b = two.symbols[i]!;
      const a = after.symbols[i]!;
      expect(a.at).not.toEqual(b.at); // the symbols really did move
      expect(a.fields.map((f) => ({ x: f.at!.x - a.at.x, y: f.at!.y - a.at.y }))).toEqual([
        { x: 20000, y: 30000 },
        { x: -20000, y: 30000 },
      ]);
    }
  });

  it('leaves the flag alone, since neither multi-item arm sets it', () => {
    const after = rotate(two, 'mirrorX', prefs(true), ids);
    expect(after.symbols[0]!.fieldsAutoplaced).toBe('auto');
    expect(after.symbols[1]!.fieldsAutoplaced).toBe('auto');
  });
});

describe.each([...ROTATIONS, ...MIRRORS])('undo of %s', (op) => {
  it('puts the fields and the flag back exactly as they were', () => {
    // Neither half inverts on its own: the autoplacer is not a function of the
    // old orientation, and clearing a flag has no opposite. Undo restores.
    const before = sheet(true);
    const cmd = transformItems(new Set([ID]), op, undefined, undefined, prefs(true));
    const after = cmd.apply(before);
    const back = cmd.invert(before).apply(after);
    expect(back.symbols[0]!.at).toEqual(before.symbols[0]!.at);
    expect(at(back.symbols[0]!)).toEqual(at(before.symbols[0]!));
    expect(stored(back.symbols[0]!)).toEqual(stored(before.symbols[0]!));
    expect(back.symbols[0]!.fieldsAutoplaced).toBe('auto');
  });
});

describe('the schematic editor hands the rotate command the preference', () => {
  // The engine can be perfect and the user still see the bug if the editor
  // never passes `m_AutoplaceFields.enable` — which is exactly the state this
  // fix found the code in. Comments are stripped so a commented-out call
  // cannot satisfy it.
  const src = readFileSync(
    fileURLToPath(
      new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
    ),
    'utf8',
  )
    .split('\n')
    .map((line) => (line.trim().startsWith('//') || line.trim().startsWith('*') ? '' : line))
    .join('\n');

  it('passes it from the R / X / Y arm', () => {
    const i = src.indexOf('else if (TX[id])');
    expect(i, 'the rotate/mirror arm was renamed').toBeGreaterThan(-1);
    const arm = src.slice(i, i + 1200);
    expect(arm).toMatch(/transformItems\(/);
    expect(arm).toMatch(/enable: es\.autoplace_fields\.enable/);
    expect(arm).toMatch(/allowRejustify: es\.autoplace_fields\.allow_rejustify/);
    expect(arm).toMatch(/alignToGrid: es\.autoplace_fields\.align_to_grid/);
  });

  it('and hands it the live document, so the autoplacer can see the page', () => {
    // `AutoplaceFields( screen, … )` — upstream always passes the screen from
    // the rotate handler, which is what lets the autoplacer skip a side that
    // would put the fields off the drawing sheet. Losing it does not stop the
    // fields being placed, so nothing above notices; this is the assertion
    // that does.
    const i = src.indexOf('else if (TX[id])');
    const arm = src.slice(i, i + 1200);
    expect(arm).toMatch(/const d = docRef\.current;/);
    expect(arm).toMatch(/drawableArea: drawableArea\(d\)/);
  });
});

describe('the flag itself', () => {
  it('reads `(fields_autoplaced yes)` as AUTOPLACE_AUTO', () => {
    expect(sheet(true).symbols[0]!.fieldsAutoplaced).toBe('auto');
    expect(sheet(false).symbols[0]!.fieldsAutoplaced).toBeUndefined();
  });

  it('is written back for a symbol that has it', () => {
    expect(serializeSchematic(sheet(true))).toContain('(fields_autoplaced yes)');
  });

  it('is *added* to a symbol whose source never had the token', () => {
    // The preserve path and the insert path are different branches, and only
    // the insert one matters for a symbol we placed or autoplaced ourselves:
    // its source node came from a file that had no `fields_autoplaced`, so
    // failing to insert loses the flag on the next save and rotate silently
    // stops re-placing the fields.
    const d = sheet(false);
    expect(serializeSchematic(d)).not.toContain('fields_autoplaced');
    const text = serializeSchematic(autoplaceFields(d, new Set([ID]), LIB)!.apply(d));
    expect(text).toContain('(fields_autoplaced yes)');
    // …and it survives the round trip, as AUTOPLACE_AUTO.
    expect(readSchematic(parse(text)).symbols[0]!.fieldsAutoplaced).toBe('auto');
  });

  it('is removed, not written as `no`, when a mirror clears it', () => {
    // `saveSymbol` prints the token only for AUTOPLACE_AUTO / AUTOPLACE_MANUAL
    // (sch_io_kicad_sexpr.cpp:780-783); `(fields_autoplaced no)` is a line KiCad
    // never writes, and writing it would be a diff on every mirrored symbol.
    const text = serializeSchematic(rotate(sheet(true), 'mirrorX', prefs(true)));
    expect(text).not.toContain('fields_autoplaced');
  });

  it('is set to AUTOPLACE_AUTO when the placement tool autoplaces a symbol', () => {
    const sym = sheet(false).symbols[0]!;
    expect(
      autoplacePlacedSymbol(sym, R, true, { allowRejustify: true, alignToGrid: true })
        .fieldsAutoplaced,
    ).toBe('auto');
  });

  it('stays clear when the placement preference is off', () => {
    const sym = sheet(false).symbols[0]!;
    expect(
      autoplacePlacedSymbol(sym, R, false, { allowRejustify: true, alignToGrid: true })
        .fieldsAutoplaced,
    ).toBeUndefined();
  });

  it('is set to AUTOPLACE_MANUAL by the O hotkey', () => {
    // Upstream's O is `AutoplaceFields( screen, AUTOPLACE_MANUAL )`, and MANUAL
    // passes the rotate handler's test just as AUTO does — so a hand-triggered
    // autoplace also opts the symbol back into being re-placed on rotate.
    const d = sheet(false);
    const cmd = autoplaceFields(d, new Set([ID]), LIB);
    expect(cmd).not.toBeNull();
    const after = cmd!.apply(d);
    expect(after.symbols[0]!.fieldsAutoplaced).toBe('manual');
    expect(rotate(after, 'rotateCW', prefs(true)).symbols[0]!.fields.map((f) => f.angle)).toEqual([
      90, 90,
    ]);
  });

  it('is restored by undoing that O, so the fields stop being re-placed again', () => {
    const d = sheet(false);
    const cmd = autoplaceFields(d, new Set([ID]), LIB)!;
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.symbols[0]!.fieldsAutoplaced).toBeUndefined();
    expect(at(back.symbols[0]!)).toEqual(at(d.symbols[0]!));
  });
});
