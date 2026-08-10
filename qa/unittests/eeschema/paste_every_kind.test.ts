// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Paste puts back everything the copy took.
 *
 * `PastePayload.batch` is a `Required<ItemsBatch>` and `copySelection` fills
 * every field of it, but the two halves that follow only ever handled five
 * kinds. `translatePayload` hardcoded the other seven to `[]`:
 *
 *     sheets: [], busEntries: [], images: [], graphics: [],
 *     textBoxes: [], directiveLabels: [], tables: [],
 *
 * and `pasteItems` added the same five and no more. So a copied rectangle,
 * sheet, image, text box, table, bus entry or netclass flag was collected,
 * carried, moved to the cursor — and dropped. Copy a rectangle, paste, nothing
 * appears, with no error anywhere.
 *
 * It also blocked Import Graphics (#501), whose interactive placement rides the
 * same payload.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  pasteItems,
  translatePayload,
  type PastePayload,
} from '@ziroeda/eeschema/src/tools/clipboard.js';
import {
  makeCircle,
  makeRectangle,
  makeTable,
  makeTextBox,
} from '@ziroeda/eeschema/src/tools/build-graphics.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const blank = (): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`));

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

/** An empty batch, so each test can fill in only the kind it is about. */
const payload = (over: Partial<PastePayload['batch']>): PastePayload => ({
  batch: {
    symbols: [],
    lines: [],
    junctions: [],
    noConnects: [],
    labels: [],
    sheets: [],
    busEntries: [],
    images: [],
    graphics: [],
    textBoxes: [],
    directiveLabels: [],
    tables: [],
    ...over,
  },
  libs: [],
  refPoint: at(0, 0),
});

describe('a pasted graphic', () => {
  it('reaches the document', () => {
    const p = payload({ graphics: [makeRectangle(at(0, 0), at(10, 10))] });
    expect(pasteItems(p).apply(blank()).graphics).toHaveLength(1);
  });

  it('and moves with the cursor', () => {
    const p = translatePayload(
      payload({ graphics: [makeRectangle(at(0, 0), at(10, 10))] }),
      at(50, 0),
    );
    const g = pasteItems(p).apply(blank()).graphics[0]!;
    expect(g.kind === 'rectangle' && g.start.x).toBe(mmToIU(50));
  });

  it('a circle moves by its centre', () => {
    const p = translatePayload(
      payload({ graphics: [makeCircle(at(10, 10), mmToIU(5))] }),
      at(5, 5),
    );
    const g = pasteItems(p).apply(blank()).graphics[0]!;
    expect(g.kind === 'circle' && g.center).toEqual(at(15, 15));
  });

  it('and undo takes it away again', () => {
    const doc = blank();
    const cmd = pasteItems(payload({ graphics: [makeRectangle(at(0, 0), at(10, 10))] }));
    const after = cmd.apply(doc);
    expect(cmd.invert(doc).apply(after).graphics).toHaveLength(0);
  });

  it('undo removes only what the paste added', () => {
    // A graphic's uuid lives in its source node rather than on the model, so
    // undo drops the count off the end — which has to leave what was there.
    const doc = { ...blank(), graphics: [makeCircle(at(0, 0), mmToIU(1))] };
    const cmd = pasteItems(payload({ graphics: [makeRectangle(at(0, 0), at(10, 10))] }));
    const back = cmd.invert(doc).apply(cmd.apply(doc));
    expect(back.graphics).toHaveLength(1);
    expect(back.graphics[0]?.kind).toBe('circle');
  });
});

describe('the other kinds that were dropped', () => {
  it('a text box', () => {
    const p = translatePayload(
      payload({ textBoxes: [makeTextBox(at(0, 0), at(20, 10), 'hello')] }),
      at(5, 0),
    );
    const doc = pasteItems(p).apply(blank());
    expect(doc.textBoxes).toHaveLength(1);
    expect(doc.textBoxes[0]?.start.x).toBe(mmToIU(5));
  });

  it('a table, which moves by its cells', () => {
    const p = translatePayload(payload({ tables: [makeTable(at(0, 0), 2, 2)] }), at(10, 0));
    const doc = pasteItems(p).apply(blank());
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.cells[0]?.start.x).toBe(mmToIU(10));
  });

  it('and undo removes them', () => {
    const doc = blank();
    const cmd = pasteItems(
      payload({
        textBoxes: [makeTextBox(at(0, 0), at(20, 10), 'x')],
        tables: [makeTable(at(0, 0), 1, 1)],
      }),
    );
    const back = cmd.invert(doc).apply(cmd.apply(doc));
    expect(back.textBoxes).toHaveLength(0);
    expect(back.tables).toHaveLength(0);
  });
});

describe('what was already working stays working', () => {
  it('a pasted label still lands and still moves', () => {
    const src = readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        (label "CLK" (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
    );
    const p = translatePayload(payload({ labels: [...src.labels] }), at(5, 0));
    const doc = pasteItems(p).apply(blank());
    expect(doc.labels).toHaveLength(1);
    expect(doc.labels[0]?.at.x).toBe(mmToIU(15));
  });
});
