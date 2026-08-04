// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol fields as first-class selectable items.
 *
 * KiCad lists SCH_FIELD_T in both SCH_COLLECTOR::EditableItems and
 * ::MovableItems, so a reference, value or footprint text is picked and dragged
 * on its own rather than acting as part of the symbol body. The ranking that
 * decides a field beats its symbol is SCH_SELECTION_TOOL::GuessSelectionCandidates:
 * exact hits beat sloppy ones, then the closest item wins, and on a tie a child
 * beats its parent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  hitTest,
  refId,
  fieldId,
  collectFieldBoxes,
  collectPinSegments,
  pinId,
  itemRefById,
} from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  itemPassesFilter,
  defaultSelectionFilter,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';
import { collectAndGuess } from '@ziroeda/eeschema/src/tools/sch_collectors.js';
import { moveItems, planMove } from '@ziroeda/eeschema/src/tools/index.js';
import { placeSymbol } from '@ziroeda/eeschema/src/tools/index.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { symbolBodyBBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

function sheetWithResistor(): { doc: Schematic; lib: Map<string, LibSymbol> } {
  const empty = readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
  const doc = placeSymbol(R, { x: mmToIU(100), y: mmToIU(100) }, { angle: 0 }, 1).apply(empty);
  return { doc, lib: new Map([[R.libId, R]]) };
}

const centreOf = (b: { minX: number; minY: number; maxX: number; maxY: number }) => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

describe('symbol fields are selectable items', () => {
  it('gives every visible field a stable id under its symbol', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const fields = collectFieldBoxes(doc, lib);

    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f.id).toBe(fieldId(symId, f.index));
    // Reference and Value are visible on a placed resistor.
    expect(fields.length).toBeGreaterThanOrEqual(2);
  });

  it('hit-tests a field rather than the symbol body under it', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const field = collectFieldBoxes(doc, lib)[0]!;

    const hit = hitTest(doc, lib, centreOf(field.bbox), 100);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('field');
    expect(hit!.id).toBe(field.id);
    expect(hit!.id).not.toBe(symId);
  });

  it('ranks the field first when its text is clicked', () => {
    const { doc, lib } = sheetWithResistor();
    const field = collectFieldBoxes(doc, lib)[0]!;
    const cands = collectAndGuess(doc, lib, centreOf(field.bbox), mmToIU(0.5));
    expect(cands[0]?.id).toBe(field.id);
  });

  it('still picks the symbol on a part of the body no field covers', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const body = symbolBodyBBox(doc.symbols[0]!, R);
    const boxes = collectFieldBoxes(doc, lib).map((f) => f.bbox);
    const inside = (
      b: { minX: number; minY: number; maxX: number; maxY: number },
      x: number,
      y: number,
    ) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

    // Somewhere on the body that no field text sits over.
    let probe: { x: number; y: number } | null = null;
    for (let fx = 0.1; fx <= 0.9 && !probe; fx += 0.1) {
      for (let fy = 0.1; fy <= 0.9 && !probe; fy += 0.1) {
        const x = body.minX + (body.maxX - body.minX) * fx;
        const y = body.minY + (body.maxY - body.minY) * fy;
        if (!boxes.some((b) => inside(b, x, y))) probe = { x, y };
      }
    }
    expect(probe).not.toBeNull();
    expect(collectAndGuess(doc, lib, probe!, mmToIU(0.5))[0]?.id).toBe(symId);
  });

  it('gives a tie to the field, as GuessSelectionCandidates does', () => {
    // This library's Value sits at the symbol origin (`(at 0 0 90)`), so a click
    // there is an exact hit on both the text and the body, at distance zero from
    // each. Upstream breaks that tie with `if( item->GetParent() == closest )
    // closest = item`, the child wins, and the text is picked.
    const { doc, lib } = sheetWithResistor();
    const value = collectFieldBoxes(doc, lib).find(
      (f) => doc.symbols[0]!.fields[f.index]!.key === 'Value',
    );
    expect(value).toBeDefined();
    const cands = collectAndGuess(doc, lib, doc.symbols[0]!.at, mmToIU(0.5));
    expect(cands[0]?.id).toBe(value!.id);
  });

  it('moves only the field, leaving the symbol in place', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const field = collectFieldBoxes(doc, lib)[0]!;
    const before = doc.symbols[0]!;
    const delta = { x: mmToIU(5), y: mmToIU(-2) };

    const after = moveItems(new Set([field.id]), delta).apply(doc).symbols[0]!;
    expect(after.at).toEqual(before.at); // the symbol did not move
    const moved = after.fields[field.index]!;
    const orig = before.fields[field.index]!;
    expect(moved.at).toEqual({ x: orig.at!.x + delta.x, y: orig.at!.y + delta.y });
    // Its siblings stayed put.
    after.fields.forEach((f, k) => {
      if (k !== field.index && f.at) expect(f.at).toEqual(before.fields[k]!.at);
    });
  });

  it('moves the field through the drag path too, without dragging wires', () => {
    const { doc, lib } = sheetWithResistor();
    const field = collectFieldBoxes(doc, lib)[0]!;
    const delta = { x: mmToIU(3), y: 0 };
    const spec = planMove(doc, lib, new Set([field.id]));
    const after = moveWithConnections(spec, delta).apply(doc).symbols[0]!;

    expect(after.at).toEqual(doc.symbols[0]!.at);
    expect(after.fields[field.index]!.at!.x).toBe(
      doc.symbols[0]!.fields[field.index]!.at!.x + delta.x,
    );
  });

  it('moves the field through orthoMove, the drag path the editor actually uses', () => {
    // The canvas picks orthoMove whenever the line mode is not "free", and the
    // default line mode is 90, so this, not moveWithConnections, is what a
    // plain drag runs. It has its own applyMove and needs the same handling.
    const { doc, lib } = sheetWithResistor();
    const field = collectFieldBoxes(doc, lib)[0]!;
    const delta = { x: mmToIU(4), y: mmToIU(1) };
    const spec = planMove(doc, lib, new Set([field.id]));
    const after = orthoMove(doc, spec, delta, lib).apply(doc).symbols[0]!;

    expect(after.at).toEqual(doc.symbols[0]!.at); // symbol stayed put
    const orig = doc.symbols[0]!.fields[field.index]!;
    expect(after.fields[field.index]!.at).toEqual({
      x: orig.at!.x + delta.x,
      y: orig.at!.y + delta.y,
    });
  });

  it('carries fields along when the whole symbol moves', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const delta = { x: mmToIU(10), y: mmToIU(10) };
    const after = moveItems(new Set([symId]), delta).apply(doc).symbols[0]!;

    expect(after.at).toEqual({
      x: doc.symbols[0]!.at.x + delta.x,
      y: doc.symbols[0]!.at.y + delta.y,
    });
    after.fields.forEach((f, k) => {
      const orig = doc.symbols[0]!.fields[k]!;
      if (f.at && orig.at) expect(f.at).toEqual({ x: orig.at.x + delta.x, y: orig.at.y + delta.y });
    });
  });
});

// ---- selection shadows -------------------------------------------------------

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context stand-in that records calls and property sets. */
function shadowRecorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set(_t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, args: [value] });
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

class ShadowPath2D {
  rect(): void {}
  moveTo(): void {}
  lineTo(): void {}
}

/**
 * How many glyph runs are stroked with the wide selection pen, i.e. how many
 * texts got a shadow. The shadow pass is the only thing that strokes text at
 * more than the ordinary text pen, so counting those isolates it.
 */
function shadowedTextCount(
  doc: Schematic,
  lib: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
): number {
  const orig = globalThis.Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = ShadowPath2D;
  try {
    const ctx = shadowRecorder();
    const scale = 0.002;
    const at = doc.symbols[0]!.at;
    renderSchematic(
      ctx,
      doc,
      { scale, offsetX: 400 - at.x * scale, offsetY: 300 - at.y * scale },
      KICAD_DEFAULT,
      800,
      600,
      selection,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showPageLimits: false,
        showDrawingSheet: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
    // Glyph runs are the only thing stroked as `ctx.stroke(path)`; everything
    // else in the shadow pass strokes the current path. Counting those drawn in
    // the shadow colour therefore counts exactly the shadowed texts.
    let colour = '';
    let shadowed = 0;
    for (const c of ctx.__calls) {
      if (c.op === 'set:strokeStyle') colour = String(c.args[0]);
      else if (c.op === 'stroke' && c.args.length > 0 && colour === KICAD_DEFAULT.selectionShadow)
        shadowed++;
    }
    return shadowed;
  } finally {
    (globalThis as { Path2D?: unknown }).Path2D = orig;
  }
}

describe('selecting a symbol covers its children', () => {
  it('glows every field of a selected symbol, not just the body', () => {
    // SCH_SELECTION_TOOL::highlight() runs RunOnChildren over a selected item
    // ("Highlight pins and fields") marking each child SELECTED, and
    // SCH_PAINTER::draw(SCH_SYMBOL) paints them on the shadow layer while
    // selection.draw_selected_children is on, true by default.
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const fieldCount = collectFieldBoxes(doc, lib).length;
    expect(fieldCount).toBeGreaterThan(0);

    expect(shadowedTextCount(doc, lib, new Set([symId]))).toBe(fieldCount);
  });

  it('glows only the picked field when one is selected alone', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const one = collectFieldBoxes(doc, lib)[0]!;
    expect(shadowedTextCount(doc, lib, new Set([fieldId(symId, one.index)]))).toBe(1);
  });

  it('glows nothing when the selection is empty', () => {
    const { doc, lib } = sheetWithResistor();
    expect(shadowedTextCount(doc, lib, new Set())).toBe(0);
  });
});

/** Lines stroked in the anchor colour: the anchor cross and the umbilical. */
function anchorLines(
  doc: Schematic,
  lib: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
  moving: boolean,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const orig = globalThis.Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = ShadowPath2D;
  try {
    const ctx = shadowRecorder();
    const scale = 0.002;
    const at = doc.symbols[0]!.at;
    renderSchematic(
      ctx,
      doc,
      { scale, offsetX: 400 - at.x * scale, offsetY: 300 - at.y * scale },
      KICAD_DEFAULT,
      800,
      600,
      selection,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showPageLimits: false,
        showDrawingSheet: false,
        movingSelection: moving,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    let colour = '';
    let from: { x: number; y: number } | null = null;
    for (const c of ctx.__calls) {
      if (c.op === 'set:strokeStyle') colour = String(c.args[0]);
      else if (c.op === 'moveTo') from = { x: c.args[0] as number, y: c.args[1] as number };
      else if (c.op === 'lineTo' && from && colour === KICAD_DEFAULT.anchor)
        out.push({ x1: from.x, y1: from.y, x2: c.args[0] as number, y2: c.args[1] as number });
    }
    return out;
  } finally {
    (globalThis as { Path2D?: unknown }).Path2D = orig;
  }
}

describe('field anchor and umbilical', () => {
  it('draws an anchor cross on a selected field', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const one = collectFieldBoxes(doc, lib)[0]!;
    const at = doc.symbols[0]!.fields[one.index]!.at!;

    const lines = anchorLines(doc, lib, new Set([fieldId(symId, one.index)]), false);
    // drawAnchor: one horizontal and one vertical stroke through the position.
    expect(lines).toHaveLength(2);
    const horiz = lines.find((l) => l.y1 === l.y2);
    const vert = lines.find((l) => l.x1 === l.x2);
    expect(horiz).toBeDefined();
    expect(vert).toBeDefined();
    expect(horiz!.y1).toBe(at.y);
    expect(vert!.x1).toBe(at.x);
    // Centred on the field position.
    expect((horiz!.x1 + horiz!.x2) / 2).toBeCloseTo(at.x, 6);
    expect((vert!.y1 + vert!.y2) / 2).toBeCloseTo(at.y, 6);
  });

  it('draws the umbilical from the field to its symbol while moving', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const one = collectFieldBoxes(doc, lib)[0]!;
    // Drag the field clear of the symbol, as the ghost document would be.
    const moved = moveItems(new Set([fieldId(symId, one.index)]), {
      x: mmToIU(8),
      y: mmToIU(-6),
    }).apply(doc);
    const at = moved.symbols[0]!.fields[one.index]!.at!;

    const lines = anchorLines(moved, lib, new Set([fieldId(symId, one.index)]), true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      x1: at.x,
      y1: at.y,
      x2: moved.symbols[0]!.at.x,
      y2: moved.symbols[0]!.at.y,
    });
  });

  it('suppresses both when the symbol itself is the thing selected', () => {
    // parentMoving / parent selected: the field travels with the symbol, so a
    // line between them would just be a stray.
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    expect(anchorLines(doc, lib, new Set([symId]), false)).toHaveLength(0);
    expect(anchorLines(doc, lib, new Set([symId]), true)).toHaveLength(0);
  });
});

describe('pins are selectable items', () => {
  it('picks a pin when its line is clicked, not the symbol', () => {
    // SCH_SELECTION_TOOL::Selectable has a SCH_PIN_T case, and
    // GuessSelectionCandidates takes an exact pin hit outright.
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const pins = collectPinSegments(doc, lib);
    expect(pins.length).toBe(2); // a resistor has two

    for (const seg of pins) {
      expect(seg.id).toBe(pinId(symId, seg.index));
      const mid = { x: (seg.at.x + seg.bodyEnd.x) / 2, y: (seg.at.y + seg.bodyEnd.y) / 2 };
      const hit = hitTest(doc, lib, mid, 100);
      expect(hit?.kind).toBe('pin');
      expect(hit?.id).toBe(seg.id);
      expect(collectAndGuess(doc, lib, mid, mmToIU(0.1))[0]?.id).toBe(seg.id);
    }
  });

  it('resolves a pin id back to a pin', () => {
    const { doc, lib } = sheetWithResistor();
    const seg = collectPinSegments(doc, lib)[0]!;
    expect(itemRefById(doc, seg.id)).toEqual({ kind: 'pin', id: seg.id });
  });

  it('is gated on the Pins selection filter', () => {
    const { doc, lib } = sheetWithResistor();
    const seg = collectPinSegments(doc, lib)[0]!;
    expect(itemPassesFilter(doc, seg.id, defaultSelectionFilter())).toBe(true);
    expect(itemPassesFilter(doc, seg.id, { ...defaultSelectionFilter(), pins: false })).toBe(false);
    // A field follows its parent symbol's category, not the pin one.
    const fid = fieldId(
      refId('symbol', doc.symbols[0]!.uuid, 0),
      collectFieldBoxes(doc, lib)[0]!.index,
    );
    expect(itemPassesFilter(doc, fid, { ...defaultSelectionFilter(), pins: false })).toBe(true);
    expect(itemPassesFilter(doc, fid, { ...defaultSelectionFilter(), symbols: false })).toBe(false);
  });

  it('glows on its own without moving anything', () => {
    // SCH_PIN_T is in neither MovableItems nor DeletableItems: a pin can be
    // picked, but it belongs to its symbol and does not move on its own.
    const { doc, lib } = sheetWithResistor();
    const seg = collectPinSegments(doc, lib)[0]!;
    const before = JSON.stringify(doc.symbols[0]);
    const spec = planMove(doc, lib, new Set([seg.id]));
    const after = orthoMove(doc, spec, { x: mmToIU(5), y: 0 }, lib).apply(doc);
    expect(JSON.stringify(after.symbols[0])).toBe(before);
    expect(after.lines).toEqual(doc.lines);
  });
});

/**
 * `collectPinSegments` and `collectFieldBoxes` are memoised per document,
 * because `hitTest` calls both on every click and both walk every symbol —
 * ~6 ms and several thousand throwaway objects per click on a 2000-symbol
 * sheet, recomputing an answer that cannot have changed.
 *
 * The cache is keyed on the document, which is immutable and replaced on every
 * edit. These pin the two things that would make it wrong: an answer that goes
 * stale, and a flag that is not part of the key.
 */
describe('the collectors are memoised on the document', () => {
  it('hands back the same array for the same document', () => {
    const { doc, lib } = sheetWithResistor();
    expect(collectFieldBoxes(doc, lib)).toBe(collectFieldBoxes(doc, lib));
    expect(collectPinSegments(doc, lib)).toBe(collectPinSegments(doc, lib));
  });

  it('recomputes for a different document, so an edit is never stale', () => {
    // A new document object is what an edit produces, and it must miss.
    const a = sheetWithResistor();
    const b = sheetWithResistor();
    expect(collectFieldBoxes(a.doc, a.lib)).not.toBe(collectFieldBoxes(b.doc, b.lib));
    // Same shape, computed twice — the ids differ only because placeSymbol
    // mints a fresh uuid, which is the fixture rather than the cache.
    expect(collectFieldBoxes(a.doc, a.lib).map((f) => f.index)).toEqual(
      collectFieldBoxes(b.doc, b.lib).map((f) => f.index),
    );
  });

  it('keeps the hidden-pin variants apart', () => {
    // showHidden is part of the key; sharing one entry would hand the renderer
    // the hit-tester's answer and hide pins that should be drawn.
    const { doc, lib } = sheetWithResistor();
    const shown = collectPinSegments(doc, lib, false);
    const hidden = collectPinSegments(doc, lib, true);
    expect(shown).not.toBe(hidden);
    expect(collectPinSegments(doc, lib, true)).toBe(hidden);
  });
});
