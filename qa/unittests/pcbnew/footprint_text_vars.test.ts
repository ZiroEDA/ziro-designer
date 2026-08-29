// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `${REFERENCE}` and `${VALUE}` follow the field they quote.
 *
 * Every KiCad footprint library since v6 carries a third text on F.Fab whose
 * content is the literal `${REFERENCE}`, and upstream resolves it inside
 * `EDA_TEXT::GetShownText` -> `FOOTPRINT::ResolveTextVar` every time the item is
 * drawn, so it is never stale. Our reader bakes the substitution once, at parse
 * time (`read-board.ts`), which left it frozen at whatever the reference was
 * when the node was read.
 *
 * On a netlist update that moment is `placeFootprint`, which builds the board
 * node and hands it to `readBoardFootprint` BEFORE
 * `BOARD_NETLIST_UPDATER::updateFootprintParameters` assigns the designator — so
 * the F.Fab text was baked to the library's own "REF**" and stayed there, which
 * is exactly what a side-by-side against pcbnew showed: every new footprint
 * labelled "D1" on the silkscreen and "REF**" in the middle.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoardFootprint, readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import {
  footprintTextRaw,
  resolveFootprintTextVars,
  setFootprintReference,
  setFootprintValue,
} from '@ziroeda/pcbnew/src/edit-footprint.js';

/** A library footprint the way KiCad ships one: REF** plus a `${REFERENCE}`. */
const SRC = `(footprint "D_DO-41"
  (version 20241229) (generator "pcbnew")
  (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2.5 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "D_DO-41" (at 0 2.5 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "\${VALUE}" (at 0 4 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" thru_hole circle (at -5 0) (size 1.6 1.6) (drill 0.9) (layers "*.Cu"))
)
`;

const boardFp = () => readBoardFootprint(parse(SRC))!;
const userText = (fp: ReturnType<typeof boardFp>, i: number): string =>
  fp.texts.filter((t) => t.kind === 'user')[i]!.text;

describe('footprint text variables', () => {
  it('the board reader resolves them against the reference it reads', () => {
    // This is the baking that goes stale; it is correct at read time.
    expect(userText(boardFp(), 0)).toBe('REF**');
    expect(userText(boardFp(), 1)).toBe('D_DO-41');
  });

  it('the library reader leaves the literal alone, as an FPHOLDER board does', () => {
    // `FOOTPRINT::ResolveTextVar` returns false on an FPHOLDER, so the footprint
    // editor really does paint `${REFERENCE}` (footprint.cpp:1185-1188).
    const lib = readFootprintFile(parse(SRC))!;
    expect(lib.texts.filter((t) => t.kind === 'user')[0]!.text).toBe('${REFERENCE}');
  });

  it('recovers the unresolved literal from the source node', () => {
    const fp = boardFp();
    const users = fp.texts.filter((t) => t.kind === 'user');
    expect(footprintTextRaw(users[0]!)).toBe('${REFERENCE}');
    expect(footprintTextRaw(users[1]!)).toBe('${VALUE}');
    // A plain text is its own raw text.
    expect(footprintTextRaw(fp.texts.find((t) => t.kind === 'reference')!)).toBe('REF**');
  });

  it('setting the reference re-resolves ${REFERENCE}', () => {
    const fp = setFootprintReference(boardFp(), 'D1');
    expect(fp.reference).toBe('D1');
    expect(fp.texts.find((t) => t.kind === 'reference')!.text).toBe('D1');
    expect(userText(fp, 0)).toBe('D1'); // was frozen at "REF**"
    expect(userText(fp, 1)).toBe('D_DO-41'); // the value did not change
  });

  it('setting the value re-resolves ${VALUE} and leaves ${REFERENCE} alone', () => {
    const fp = setFootprintValue(boardFp(), '1N4007');
    expect(fp.value).toBe('1N4007');
    expect(userText(fp, 1)).toBe('1N4007');
    expect(userText(fp, 0)).toBe('REF**');
  });

  it('re-resolving twice is stable, and the literal survives every pass', () => {
    const once = setFootprintReference(boardFp(), 'D1');
    const twice = setFootprintReference(once, 'D2');
    expect(userText(twice, 0)).toBe('D2');
    expect(footprintTextRaw(twice.texts.filter((t) => t.kind === 'user')[0]!)).toBe('${REFERENCE}');
  });

  it('leaves a footprint with no variables untouched, object identity included', () => {
    const plain = readBoardFootprint(
      parse(`(footprint "X" (layer "F.Cu")
        (property "Reference" "REF**" (at 0 0 0) (layer "F.SilkS"))
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))`),
    )!;
    expect(resolveFootprintTextVars(plain)).toBe(plain);
  });

  it('reannotating a board footprint moves the F.Fab designator too', () => {
    // board_reannotate.ts had its own SetReference that patched the model and
    // the source and stopped there; it goes through the shared one now.
    const renamed = setFootprintReference(setFootprintReference(boardFp(), 'D1'), 'D7');
    expect(renamed.texts.find((t) => t.kind === 'reference')!.text).toBe('D7');
    expect(userText(renamed, 0)).toBe('D7');
  });
});
