// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A label's stored angle is not its text angle, and its bounding box has to use
 * the text angle.
 *
 * `SCH_IO_KICAD_SEXPR::saveText` folds the spin style into the angle it writes:
 *
 *     // The angle of the text is always 0 or 90 degrees for readibility reasons,
 *     // but the item itself can have more rotation (-90 and 180 deg)
 *     case SPIN_STYLE::LEFT:   angle += ANGLE_180; break;
 *     case SPIN_STYLE::BOTTOM: angle += ANGLE_180; break;
 *
 * and the parser undoes it, mapping the file's 0/90/180/270 to a spin style that
 * `SetSpinStyle` splits into a text angle of *only* 0 or 90 plus a horizontal
 * justification. `GetTextAngle()` therefore never returns 180, and
 * `SCH_LABEL::GetBodyBoundingBox` — which rotates the text box by it — never
 * rotates a horizontal label at all.
 *
 * We keep the file's angle on the item. Everything that reads the spin already
 * handles that (`labelSpin` takes `angle % 180` plus the justify, which is what
 * the painter draws with), but the box rotated by the stored 180 and so came
 * out reflected through the anchor: a spin-LEFT label draws its text to the
 * left and was clickable only to the right, over empty sheet.
 *
 * 829 of the labels in KiCad's own demo projects are stored at 180, so this was
 * every leftward label on a real schematic.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import { labelBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();
const ANCHOR = mmToIU(100);

/** One label at (100, `y`), written the way KiCad writes that spin style. */
const sheet = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (label "LEFTWARD" (at 100 100 180)
        (effects (font (size 1.27 1.27)) (justify right)) (uuid "l1"))
      (label "RIGHTWARD" (at 100 110 0)
        (effects (font (size 1.27 1.27)) (justify left)) (uuid "l2"))
      (label "DOWNWARD" (at 100 120 270)
        (effects (font (size 1.27 1.27)) (justify right)) (uuid "l3"))
      (label "UPWARD" (at 100 130 90)
        (effects (font (size 1.27 1.27)) (justify left)) (uuid "l4")))`),
  );

const byUuid = (doc: Schematic, uuid: string) => doc.labels.find((l) => l.uuid === uuid)!;

describe('the box sits on the side the text is drawn', () => {
  const doc = sheet();

  it('a spin-LEFT label (stored at 180) boxes to the left of its anchor', () => {
    const b = labelBox(byUuid(doc, 'l1'));
    expect(b.minX).toBeLessThan(ANCHOR);
    // It may overhang the anchor by the pen, but its bulk is on the left.
    expect(b.maxX - ANCHOR).toBeLessThan(ANCHOR - b.minX);
  });

  it('a spin-RIGHT label boxes to the right, as it always did', () => {
    const b = labelBox(byUuid(doc, 'l2'));
    expect(b.maxX).toBeGreaterThan(ANCHOR);
    expect(b.maxX - ANCHOR).toBeGreaterThan(ANCHOR - b.minX);
  });

  it('and the two are mirror images, since they carry the same text length', () => {
    // Same string length either way would be ideal, but the point that matters
    // is that neither box crosses to the wrong side.
    const left = labelBox(byUuid(doc, 'l1'));
    const right = labelBox(byUuid(doc, 'l2'));
    expect(left.minX).toBeLessThan(right.minX);
    expect(left.maxX).toBeLessThan(right.maxX);
  });

  it('a spin-BOTTOM label (stored at 270) boxes below its anchor', () => {
    const b = labelBox(byUuid(doc, 'l3'));
    const y = mmToIU(120);
    expect(b.maxY).toBeGreaterThan(y);
    expect(b.maxY - y).toBeGreaterThan(y - b.minY);
  });

  it('a spin-UP label boxes above its anchor', () => {
    const b = labelBox(byUuid(doc, 'l4'));
    const y = mmToIU(130);
    expect(b.minY).toBeLessThan(y);
    expect(y - b.minY).toBeGreaterThan(b.maxY - y);
  });
});

describe('clicking, which is what the user actually does', () => {
  const doc = sheet();
  const id = refId('label', 'l1', 0);
  // A point well inside the text of the leftward label, and its mirror image on
  // the empty side of the anchor.
  const onText = { x: mmToIU(95), y: mmToIU(99.5) };
  const onEmpty = { x: mmToIU(105), y: mmToIU(99.5) };

  it('selects the label when the click lands on its letters', () => {
    expect(hitTest(doc, LIB, onText, 0)?.id).toBe(id);
  });

  it('and selects nothing on the empty side opposite the text', () => {
    // This was backwards: the letters missed and the blank sheet hit.
    expect(hitTest(doc, LIB, onEmpty, 0)).toBeNull();
  });
});

describe('free text keeps the angle it was written with', () => {
  // `saveText` only folds the spin in `if( label )`, so SCH_TEXT is not
  // spin-encoded and its stored angle *is* its text angle. Reducing 180 to 0
  // for free text would box a piece of upside-down text on the wrong side.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (text "NOTE" (at 100 100 180) (effects (font (size 1.27 1.27))) (uuid "t1")))`),
  );

  it('is rotated by its full angle, not folded to 0 or 90', () => {
    const b = labelBox(doc.labels.find((l) => l.uuid === 't1')!);
    // Centre-justified and turned through 180, so it straddles the anchor.
    expect(b.minX).toBeLessThan(ANCHOR);
    expect(b.maxX).toBeGreaterThan(ANCHOR);
  });
});

describe('centre-justified text straddles its anchor', () => {
  // `GetTextBox`: CENTER does `bbox.SetX( bbox.GetX() - bbox.GetWidth() / 2 )`.
  // Both arms of the conditional used to return the anchor unchanged, so
  // centred text was boxed entirely to its right.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (text "CENTRED" (at 100 100 0) (effects (font (size 1.27 1.27))) (uuid "t2")))`),
  );

  it('extends about as far left of the anchor as right', () => {
    const b = labelBox(doc.labels.find((l) => l.uuid === 't2')!);
    const leftOf = ANCHOR - b.minX;
    const rightOf = b.maxX - ANCHOR;
    expect(leftOf).toBeGreaterThan(0);
    expect(Math.abs(leftOf - rightOf) / Math.max(leftOf, rightOf)).toBeLessThan(0.05);
  });
});
