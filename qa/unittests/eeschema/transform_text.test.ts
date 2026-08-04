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
  it('X flips a horizontal label, Y does not', () => {
    const l = label('left').labels[0]!;
    expect(mirrorTextSpin(l, true).effects?.justify).toEqual(['right']);
    expect(mirrorTextSpin(l, false).effects?.justify).toEqual(['left']);
  });

  it('Y flips a vertical label, X does not', () => {
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
