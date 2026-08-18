// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rotating and mirroring text items, counterparts SCH_TEXT::Rotate90 and
 * SCH_TEXT::MirrorSpinStyle via SCH_EDIT_TOOL::Rotate's
 * SCH_TEXT_T ... SCH_DIRECTIVE_LABEL_T arm.
 *
 * A label does not orbit anything: it turns in place, and which way it faces is
 * carried by the angle (0 or 90) *together with* the horizontal justify. That
 * pairing is why a quarter turn flips the justify on one half-turn and not the
 * other, and the property that pins it down is that four rotations must be the
 * identity.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  transformItems,
  rotateText90,
  mirrorTextSpin,
  flipHJustify,
} from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const label = (justify = 'left', angle = 0): Schematic =>
  sheet(
    `(label "CLK" (at 50 50 ${angle})
       (effects (font (size 1.27 1.27)) (justify ${justify})) (uuid "l-1"))`,
  );

const labelId = (d: Schematic): string => refId('label', d.labels[0]!.uuid, 0);
const rotate = (d: Schematic, cw: boolean): Schematic =>
  transformItems(new Set([labelId(d)]), cw ? 'rotateCW' : 'rotateCCW').apply(d);

describe('flipHJustify', () => {
  it('swaps left and right', () => {
    expect(flipHJustify(['left'])).toEqual(['right']);
    expect(flipHJustify(['right'])).toEqual(['left']);
  });

  it('leaves a centred label centred, however often it turns', () => {
    // Upstream tests the two outer cases and falls through on anything else.
    expect(flipHJustify(['center'])).toEqual(['center']);
    expect(flipHJustify(undefined)).toBeUndefined();
  });

  it('leaves the vertical token alone', () => {
    expect(flipHJustify(['left', 'bottom'])).toEqual(['right', 'bottom']);
  });
});

describe('Rotate90 on one label', () => {
  it('toggles horizontal to vertical', () => {
    const l = label().labels[0]!;
    expect(rotateText90(l, true).angle).toBe(90);
    expect(rotateText90(rotateText90(l, true), true).angle).toBe(0);
  });

  it('flips the justify going clockwise from horizontal', () => {
    const l = label('left').labels[0]!;
    expect(rotateText90(l, true).effects?.justify).toEqual(['right']);
  });

  it('does not flip going anticlockwise from horizontal', () => {
    const l = label('left').labels[0]!;
    expect(rotateText90(l, false).effects?.justify).toEqual(['left']);
  });

  it('flips going anticlockwise from vertical', () => {
    const l = label('left', 90).labels[0]!;
    expect(rotateText90(l, false).effects?.justify).toEqual(['right']);
  });

  it('four quarter turns are the identity, either direction', () => {
    for (const cw of [true, false]) {
      for (const j of ['left', 'right']) {
        let l = label(j).labels[0]!;
        for (let i = 0; i < 4; i++) l = rotateText90(l, cw);
        expect({ angle: l.angle, justify: l.effects?.justify }).toEqual({
          angle: 0,
          justify: [j],
        });
      }
    }
  });
});

describe('MirrorSpinStyle', () => {
  // `leftRight` is upstream's `!vertical`: true for Mirror Horizontally. Which of
  // our two ops that is, is the wiring question the command tests below settle.
  it('left-right flips a horizontal label, up-down does not', () => {
    const l = label('left').labels[0]!;
    expect(mirrorTextSpin(l, true).effects?.justify).toEqual(['right']);
    expect(mirrorTextSpin(l, false).effects?.justify).toEqual(['left']);
  });

  it('up-down flips a vertical label, left-right does not', () => {
    const l = label('left', 90).labels[0]!;
    expect(mirrorTextSpin(l, false).effects?.justify).toEqual(['right']);
    expect(mirrorTextSpin(l, true).effects?.justify).toEqual(['left']);
  });

  it('is its own inverse', () => {
    const l = label('left').labels[0]!;
    expect(mirrorTextSpin(mirrorTextSpin(l, true), true).effects?.justify).toEqual(['left']);
  });

  it('never changes the angle', () => {
    const l = label('left', 90).labels[0]!;
    expect(mirrorTextSpin(l, false).angle).toBe(90);
  });
});

describe('the command, end to end', () => {
  it('R on a selected label actually does something', () => {
    // This is the regression: transformItems mapped doc.symbols only, so R, X
    // and Y were silent no-ops on every label in the editor.
    const d = label();
    const after = rotate(d, true);
    expect(after.labels[0]!.angle).toBe(90);
    expect(after.labels[0]!.angle).not.toBe(d.labels[0]!.angle);
  });

  it('leaves unselected labels alone', () => {
    const d = sheet(
      [
        `(label "A" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-1"))`,
        `(label "B" (at 60 60 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-2"))`,
      ].join('\n'),
    );
    const after = transformItems(new Set([refId('label', 'l-1', 0)]), 'rotateCW').apply(d);
    expect(after.labels[0]!.angle).toBe(90);
    expect(after.labels[1]!.angle).toBe(0);
  });

  it('undoes exactly', () => {
    const d = label();
    const cmd = transformItems(new Set([labelId(d)]), 'rotateCW');
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.labels[0]!.angle).toBe(0);
    expect(back.labels[0]!.effects?.justify).toEqual(['left']);
  });

  it('reaches the file — angle and justify both persist', () => {
    // The rotation changes the justify as well as the angle, and the writer
    // patches both; a model-only change would be invisible after a save.
    const d = label();
    const text = serializeSchematic(rotate(d, true));
    expect(text).toContain('(at 50 50 90)');
    expect(text).toContain('(justify right)');
  });
});

/**
 * Which *command* flips the justify, not which argument the helper takes.
 *
 * `SCH_EDIT_TOOL::Mirror` reads `vertical = ( event matches mirrorV )` and calls
 * `MirrorSpinStyle( !vertical )` (sch_edit_tool.cpp:1341), so the left-right flip
 * belongs to Mirror **Horizontally**. The helper above has always been right; the
 * call site passed the wrong one of our two ops, and every helper-level test
 * passed while the editor did the opposite of KiCad.
 *
 * These assertions never name the axis themselves. A wire rides along in the
 * selection and the test reads the axis off *it*: the op that mirrors X is by
 * definition Mirror Horizontally, whatever we have chosen to call it.
 */
describe('the mirror command picks its axis the way SCH_EDIT_TOOL does', () => {
  const withWire = (justify: string, angle: number): Schematic =>
    sheet(
      [
        `(wire (pts (xy 40 40) (xy 60 40)) (uuid "w-1"))`,
        `(label "CLK" (at 50 50 ${angle})
           (effects (font (size 1.27 1.27)) (justify ${justify})) (uuid "l-1"))`,
      ].join('\n'),
    );

  const mirror = (d: Schematic, op: 'mirrorX' | 'mirrorY') =>
    transformItems(new Set([refId('line', 'w-1', 0), refId('label', 'l-1', 0)]), op).apply(d);

  /** true when this op moved the wire in X (Mirror Horizontally), false in Y. */
  const flipsX = (before: Schematic, after: Schematic): boolean => {
    const a = before.lines[0]!.start;
    const b = after.lines[0]!.start;
    expect(a.x === b.x).not.toBe(a.y === b.y); // exactly one axis moved
    return a.x !== b.x;
  };

  for (const op of ['mirrorX', 'mirrorY'] as const) {
    it(`${op}: a horizontal label's justify flips iff it is the X mirror`, () => {
      const d = withWire('left', 0);
      const after = mirror(d, op);
      expect(after.labels[0]!.effects?.justify).toEqual(flipsX(d, after) ? ['right'] : ['left']);
    });

    it(`${op}: a vertical label's justify flips iff it is the Y mirror`, () => {
      const d = withWire('left', 90);
      const after = mirror(d, op);
      expect(after.labels[0]!.effects?.justify).toEqual(flipsX(d, after) ? ['left'] : ['right']);
    });
  }

  it('reaches the file', () => {
    const d = withWire('left', 0);
    const after = mirror(d, 'mirrorY');
    expect(flipsX(d, after)).toBe(true);
    expect(serializeSchematic(after)).toContain('(justify right)');
  });
});

/**
 * `SCH_DIRECTIVE_LABEL::MirrorSpinStyle` (sch_label.cpp:1745) runs the spin flip
 * at the opposite handedness — `SCH_TEXT::MirrorSpinStyle( !aLeftRight )` — because
 * "the text is in fact a graphic shape … so the mirroring is not exactly similar
 * to a SCH_TEXT item". A directive label carries its spin in the file angle
 * (0/90/180/270, read back by spinOfAngle and pointed by directiveGraphic), not in
 * a justify, so the flip is a half turn of that angle. It used to share the label
 * path, where the flip landed on an `effects` the type does not even have — the
 * flag went on pointing the way it did before the mirror.
 */
describe('a directive label mirrors opposite to a label', () => {
  const flag = (angle: number): Schematic =>
    sheet(
      [
        // Diagonal, so either mirror visibly moves it and the axis is readable.
        `(wire (pts (xy 40 40) (xy 60 30)) (uuid "w-1"))`,
        `(directive_label "" (length 2.54) (shape diamond) (at 50 50 ${angle})
           (uuid "d-1")
           (property "Netclass" "HV" (at 52 48 0)
             (effects (font (size 1.27 1.27)) (justify left))))`,
      ].join('\n'),
    );

  const mirror = (d: Schematic, op: 'mirrorX' | 'mirrorY') =>
    transformItems(new Set([refId('line', 'w-1', 0), refId('directive', 'd-1', 0)]), op).apply(d);

  // MirrorSpinStyle is the *single-item* arm of SCH_EDIT_TOOL::Mirror
  // (sch_edit_tool.cpp:1341). With anything else in the selection the tool falls
  // through to SCH_DIRECTIVE_LABEL::MirrorHorizontally / ::MirrorVertically
  // (sch_label.cpp:1776/1804) instead, which agree about the flag's angle but
  // move it, and treat its fields differently. Tests that are about
  // MirrorSpinStyle itself therefore have to select the flag on its own.
  const mirrorAlone = (d: Schematic, op: 'mirrorX' | 'mirrorY') =>
    transformItems(new Set([refId('directive', 'd-1', 0)]), op).apply(d);

  const movedX = (before: Schematic, after: Schematic): boolean =>
    before.lines[0]!.start.x !== after.lines[0]!.start.x;

  it('a stick pointing up turns to point down under the Y mirror, not the X one', () => {
    for (const op of ['mirrorX', 'mirrorY'] as const) {
      const d = flag(0);
      const after = mirror(d, op);
      // Angle 0 is SPIN RIGHT (stick up); the up-down mirror makes it 180 (down).
      expect(after.directiveLabels![0]!.angle).toBe(movedX(d, after) ? 0 : 180);
    }
  });

  it('a stick pointing right turns to point left under the X mirror, not the Y one', () => {
    for (const op of ['mirrorX', 'mirrorY'] as const) {
      const d = flag(90);
      const after = mirror(d, op);
      expect(after.directiveLabels![0]!.angle).toBe(movedX(d, after) ? 270 : 90);
    }
  });

  it('is the opposite op to the one that flips a plain label at the same angle', () => {
    // The whole point of the override: at the same angle the two types answer to
    // different mirrors. A plain horizontal label flips on the X mirror.
    const d = sheet(
      [
        `(wire (pts (xy 40 40) (xy 60 40)) (uuid "w-1"))`,
        `(label "CLK" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-1"))`,
        `(directive_label "" (length 2.54) (shape diamond) (at 50 50 0) (uuid "d-1"))`,
      ].join('\n'),
    );
    const ids = new Set([
      refId('line', 'w-1', 0),
      refId('label', 'l-1', 0),
      refId('directive', 'd-1', 0),
    ]);
    const x = transformItems(ids, 'mirrorY').apply(d); // the X mirror
    expect(x.labels[0]!.effects?.justify).toEqual(['right']); // label turned
    expect(x.directiveLabels![0]!.angle).toBe(0); // flag did not
    const y = transformItems(ids, 'mirrorX').apply(d); // the Y mirror
    expect(y.labels[0]!.effects?.justify).toEqual(['left']); // label did not
    expect(y.directiveLabels![0]!.angle).toBe(180); // flag turned
  });

  it('mirrors its fields about its own anchor and flips their justify', () => {
    // The second half of the same function, and it keys off aLeftRight undoubled:
    // a horizontal field flips on the left-right mirror.
    const d = flag(0);
    const before = d.directiveLabels![0]!;
    const after = mirrorAlone(d, 'mirrorY').directiveLabels![0]!; // the X mirror
    const f = after.fields[0]!;
    expect(f.at).toEqual({
      x: 2 * before.at.x - before.fields[0]!.at!.x,
      y: before.fields[0]!.at!.y,
    });
    expect(f.effects?.justify).toEqual(['right']);
  });

  it('reaches the file — the flag angle and the field both persist', () => {
    const d = flag(0);
    const after = mirrorAlone(d, 'mirrorX'); // the Y mirror
    const text = serializeSchematic(after);
    expect(text).toContain('(at 50 50 180)');
    const back = readSchematic(parse(text));
    expect(back.directiveLabels![0]!.angle).toBe(180);
  });

  it('a mirror is still its own inverse', () => {
    for (const op of ['mirrorX', 'mirrorY'] as const) {
      const d = flag(90);
      const ids = new Set([refId('line', 'w-1', 0), refId('directive', 'd-1', 0)]);
      const back = transformItems(ids, op).apply(transformItems(ids, op).apply(d));
      expect(back.directiveLabels![0]!.angle).toBe(90);
      expect(back.directiveLabels![0]!.fields[0]!.at).toEqual(d.directiveLabels![0]!.fields[0]!.at);
    }
  });
});
