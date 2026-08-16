// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Select on PCB, both ends of it.
 *
 * The schematic builds a `$SELECT:` packet (`SendSelectItemsToPcb`) and the
 * board reads it back (`FindItemsFromSyncSelection`). Keeping the packet rather
 * than passing objects between two frames that are mounted together looks like
 * ceremony until you notice what the three part shapes encode:
 *
 *   - a sheet is a *prefix* of a footprint's path, so one part selects
 *     everything on the sheet and on every subsheet below it, without anyone
 *     walking the hierarchy;
 *   - a pin resolves to a *pad*, through the pin map, and one pin can stand for
 *     several pads;
 *   - both are escaped, because the parts are comma-joined and the paths are
 *     slash-split, so a reference designator containing either would otherwise
 *     tear the packet in half.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, syncSelectionParts } from '@ziroeda/eeschema';
import { readBoard } from '@ziroeda/pcbnew';
import { findItemsFromSyncSelection, crossProbeZoomScale } from '@ziroeda/pcbnew';
import { escapeIpc } from '@ziroeda/common/src/string_utils.js';
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

const SCH = `(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1) (uuid "sym-1")
    (property "Reference" "R1" (at 100 95 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "R_0402" (at 100 105 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "Device:R") (at 120 100 0) (unit 1) (uuid "sym-2")
    (property "Reference" "R,2" (at 120 95 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "wire-1"))
  (sheet (at 20 20) (size 30 20) (uuid "sheet-1")
    (property "Sheetname" "sub" (at 20 19 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 20 51 0) (effects (font (size 1.27 1.27)))))
  (sheet_instances (path "/" (page "1"))))
`;

const doc = readSchematic(parse(SCH));
const libById = new Map<string, LibSymbol>(doc.libSymbols.map((s) => [s.libId, s]));
const ids = (...list: string[]): Set<string> => new Set(list);

describe('the parts a schematic selection sends', () => {
  it('names a symbol by its reference', () => {
    expect(syncSelectionParts(doc, ids('sym-1'), '/')).toEqual(['FR1']);
  });

  it('escapes a reference that would break the packet', () => {
    // The parts are joined with commas, so a comma inside one has to go.
    expect(syncSelectionParts(doc, ids('sym-2'), '/')).toEqual(['FR{comma}2']);
    expect(escapeIpc('R,2')).toBe('R{comma}2');
  });

  it('names a sheet by the path of the sheet it sits on, plus its own uuid', () => {
    expect(syncSelectionParts(doc, ids('sheet-1'), '/')).toEqual(['S/sheet-1']);
    // Two instances of the same sheet differ only by where they hang, which is
    // exactly what the prefix carries.
    expect(syncSelectionParts(doc, ids('sheet-1'), '/top/')).toEqual(['S/top/sheet-1']);
  });

  it('names a pin down to its pad', () => {
    expect(syncSelectionParts(doc, ids('sym-1:pin1'), '/', libById)).toEqual(['PR1/2']);
  });

  it('sends nothing for a wire — there is no board item to name', () => {
    // `crossProbingSelection` is a HasTypes over symbols, pins and sheets; this
    // emptiness is what hides the menu entry.
    expect(syncSelectionParts(doc, ids('wire-1'), '/')).toEqual([]);
  });

  it('sends nothing for a pin whose symbol is gone', () => {
    // A selection can outlive what it points at — an undo removes the symbol
    // while its pin id is still in the set — and the packet is built from the
    // ids, not from the objects.
    expect(syncSelectionParts(doc, ids('no-such-symbol:pin0'), '/', libById)).toEqual([]);
  });

  it('sends nothing for a pin whose library is not loaded', () => {
    // Without the library there is no pin number, and a guessed one would
    // select the wrong pad.
    expect(syncSelectionParts(doc, ids('sym-1:pin0'), '/')).toEqual([]);
  });
});

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (footprint "R_0402" (layer "F.Cu") (uuid "fp-1") (at 10 10)
    (path "/sheet-1/sym-1")
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "t1")
      (effects (font (size 1 1) (thickness 0.15)))))
  (footprint "R_0402" (layer "F.Cu") (uuid "fp-2") (at 30 10)
    (path "/sym-2")
    (property "Reference" "R,2" (at 0 0 0) (layer "F.SilkS") (uuid "t2")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -0.5 0) (size 0.6 0.6) (layers "F.Cu"))
    (pad "2" smd rect (at 0.5 0) (size 0.6 0.6) (layers "F.Cu")))
  (footprint "C_0402" (layer "F.Cu") (uuid "fp-3") (at 50 10)
    (path "/sheet-1/deeper/sym-3")
    (property "Reference" "C3" (at 0 0 0) (layer "F.SilkS") (uuid "t3")
      (effects (font (size 1 1) (thickness 0.15))))))
`;

const board = readBoard(parse(BOARD));

describe('the board items those parts name', () => {
  it('matches a footprint by reference', () => {
    expect(findItemsFromSyncSelection(board, ['FR1'])).toEqual(['footprint:0']);
  });

  it('matches an escaped reference', () => {
    expect(findItemsFromSyncSelection(board, ['FR{comma}2'])).toEqual(['footprint:1']);
  });

  it('takes the subsheets with the sheet', () => {
    // fp-1 sits on /sheet-1 and fp-3 on /sheet-1/deeper; the prefix test is the
    // only thing that reaches the second one.
    expect(findItemsFromSyncSelection(board, ['S/sheet-1'])).toEqual([
      'footprint:0',
      'footprint:2',
    ]);
  });

  it('leaves a footprint on another sheet alone', () => {
    expect(findItemsFromSyncSelection(board, ['S/sheet-1'])).not.toContain('footprint:1');
  });

  it('selects the pad, not its footprint', () => {
    expect(findItemsFromSyncSelection(board, ['PR{comma}2/2'])).toEqual(['pad:1:1']);
  });

  it('keeps the order of the parts, not of the board', () => {
    // The first item is the one the view centres on, so it has to be the one
    // the user's selection started from.
    expect(findItemsFromSyncSelection(board, ['FC3', 'FR1'])).toEqual([
      'footprint:2',
      'footprint:0',
    ]);
  });

  it('ignores a part it does not understand', () => {
    expect(findItemsFromSyncSelection(board, ['XR1', 'FR1'])).toEqual(['footprint:0']);
  });

  it('returns each item once when two parts name it', () => {
    expect(findItemsFromSyncSelection(board, ['FR1', 'S/sheet-1'])).toEqual([
      'footprint:0',
      'footprint:2',
    ]);
  });
});

describe('how far the board zooms on a probe', () => {
  const screen = { x: pcbMmToIU(100), y: pcbMmToIU(75) };
  const boxOf = (w: number, h: number) => ({
    minX: 0,
    minY: 0,
    maxX: pcbMmToIU(w),
    maxY: pcbMmToIU(h),
  });

  it('does not fill the screen with one 0402', () => {
    // The point of the LUT: a small part is drawn small, with board around it.
    // A plain zoom-to-fit would put a 1 mm resistor across a 100 mm viewport.
    const scale = crossProbeZoomScale(boxOf(1, 0.5), screen, 1)!;
    expect(scale).not.toBeNull();
    // The part ends up a few percent of the viewport, not most of it.
    const visible = pcbMmToIU(1) / (screen.x / (scale / 1));
    expect(visible).toBeLessThan(0.25);
  });

  it('zooms a big footprint closer than a small one', () => {
    const small = crossProbeZoomScale(boxOf(1, 0.5), screen, 1)!;
    const big = crossProbeZoomScale(boxOf(20, 20), screen, 1)!;
    expect(big).toBeGreaterThan(0);
    expect(small).toBeGreaterThan(big);
  });

  it('leaves the zoom alone when it would barely move', () => {
    // `ratio` between 0.5 and 1.0 — upstream skips the zoom outright, because
    // re-zooming on every probe is unwatchable.
    let skipped = 0;
    for (let mm = 1; mm <= 60; mm++)
      if (crossProbeZoomScale(boxOf(mm, mm), screen, 1) === null) skipped++;
    expect(skipped).toBeGreaterThan(0);
  });

  it('gives the box a fifth of its width of breathing room first', () => {
    // Worked through for a 20 mm square on a 100x75 mm viewport:
    //   inflate  = 20 * 0.2 = 4 per side, so bbSize = 28 x 28
    //   compRatio = 28 / 1 mm of default text = 28, between the LUT's
    //               (24, 1.3) and (32, 1.0): 1.3 - 0.3 * 4/8 = 1.15
    //   ratio    = 28 / 75 = 0.37333, not too wide, * 1.15 = 0.42933
    //   scale    = 1 / 0.42933
    // Dropping the inflation alone lands on 2.679 instead, which is why the
    // number is spelled out rather than bounded.
    expect(crossProbeZoomScale(boxOf(20, 20), screen, 1)!).toBeCloseTo(1 / 0.4293333, 4);
  });

  it('says nothing about a zero-width selection', () => {
    expect(crossProbeZoomScale(boxOf(0, 5), screen, 1)).toBeNull();
  });

  it('falls back to the plain fit for a part too wide for the screen', () => {
    // A long, flat item: the height-driven ratio would cut its ends off, so
    // upstream switches to the width-driven one.
    const wide = crossProbeZoomScale(boxOf(400, 1), screen, 1)!;
    expect(wide).not.toBeNull();
    // 400 mm across a 100 mm viewport has to zoom *out*, below the old scale.
    expect(wide).toBeLessThan(1);
  });
});
