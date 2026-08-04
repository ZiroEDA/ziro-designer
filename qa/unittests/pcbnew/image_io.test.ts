// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference images in the board model, and their file format.
 * Counterparts: `PCB_REFERENCE_IMAGE` (pcbnew/pcb_reference_image.h),
 * `PCB_IO_KICAD_SEXPR::format(PCB_REFERENCE_IMAGE*)` and
 * `KICAD_FORMAT::FormatStreamData`.
 *
 * A reference image is a drawing dropped on the board to trace over — a
 * datasheet outline, a mechanical drawing — not something that is fabricated.
 *
 * Two things decide whether a file survives a round trip:
 *
 * - **`(data …)` is one base64 string split across many quoted pieces** at the
 *   MIME width of 76. That split is transport, not meaning: the model holds the
 *   joined string and the writer re-splits it. A model that kept the chunks
 *   would push the wrapping onto every consumer.
 * - **`(scale …)` is written only when it is not 1**, and `(locked …)` only
 *   when set. Writing either unconditionally adds a token KiCad never produces,
 *   so an untouched file would change on every save.
 *
 * The fixture's payload is a real (tiny) PNG rather than arbitrary text, so the
 * base64 is the shape the format actually carries.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  BASE64_LINE_WIDTH,
  buildImageNode,
  serializeBoard,
} from '@ziroeda/pcbnew/src/write-board.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board, PcbImage } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** A 1x1 transparent PNG, base64 — 96 characters, so it wraps. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Split as the file does, to prove the reader joins rather than assumes one string. */
const wrapped = (s: string, width = BASE64_LINE_WIDTH): string => {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += width) parts.push(`"${s.slice(i, i + width)}"`);
  return parts.join('\n      ');
};

const IMAGE = (extra = ''): string => `(image
    (at 145.5 108.25)
    (layer "F.Cu")
    ${extra}
    (data ${wrapped(PNG)})
    (uuid "aaaaaaaa-1111-2222-3333-444444444444"))`;

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );
const only = (src: string): PcbImage => read(src).images[0]!;

describe('reading a reference image', () => {
  it('reads the position, layer and uuid', () => {
    const img = only(IMAGE());

    expect(img.at).toEqual({ x: MM(145.5), y: MM(108.25) });
    expect(img.layer).toBe('F.Cu');
    expect(img.uuid).toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('joins the wrapped data back into one base64 string', () => {
    // The fixture is split across two quoted pieces; the model holds one.
    expect(only(IMAGE()).data).toBe(PNG);
  });

  it('leaves the scale absent rather than 1 when the file omits it', () => {
    // Absent *is* 1; storing 1 would make the writer emit a token KiCad does
    // not, changing an untouched file on save.
    expect(only(IMAGE()).scale).toBeUndefined();
  });

  it('reads a scale that is there', () => {
    expect(only(IMAGE('(scale 0.159863)')).scale).toBeCloseTo(0.159863, 6);
  });

  it('reads the locked flag', () => {
    expect(only(IMAGE('(locked yes)')).locked).toBe(true);
    expect(only(IMAGE()).locked).toBeFalsy();
  });

  it('skips an image with no position', () => {
    // Nothing to place it by, and guessing an origin would silently move it.
    expect(read(IMAGE().replace('(at 145.5 108.25)', '')).images).toHaveLength(0);
  });

  it('reads an image with no data as empty rather than failing', () => {
    // A truncated file should still round-trip its geometry.
    const img = read(IMAGE().replace(/\(data[^)]*\)/s, '')).images[0]!;

    expect(img.data).toBe('');
    expect(img.at).toEqual({ x: MM(145.5), y: MM(108.25) });
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched image back unchanged', () => {
    const back = readBoard(parse(serializeBoard(read(IMAGE('(scale 0.5)')))));

    expect(back.images).toHaveLength(1);
    expect(back.images[0]!.data).toBe(PNG);
    expect(back.images[0]!.scale).toBe(0.5);
  });

  it('keeps an image when other items are edited around it', () => {
    const b = read(IMAGE());
    b.texts.push({
      kind: 'user',
      text: 'hello',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: MM(1), y: MM(1) },
      source: { kind: 'list', items: [] },
    });
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.images).toHaveLength(1);
    expect(back.images[0]!.data).toBe(PNG);
    expect(back.texts.some((t) => t.text === 'hello')).toBe(true);
  });

  it('drops a deleted image', () => {
    const b = read(IMAGE(), IMAGE('(scale 2)'));
    b.images.splice(0, 1);
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.images).toHaveLength(1);
    expect(back.images[0]!.scale).toBe(2);
  });
});

describe('building an image from scratch', () => {
  const base = (over: Partial<PcbImage> = {}): PcbImage => ({
    at: { x: MM(10), y: MM(20) },
    layer: 'F.SilkS',
    data: PNG,
    source: { kind: 'list', items: [] },
    ...over,
  });
  const text = (img: PcbImage): string => serialize(buildImageNode(img));

  it('writes the position and layer', () => {
    const s = text(base());

    expect(s).toContain('(at 10 20)');
    expect(s).toContain('(layer "F.SilkS")');
  });

  it('splits the data at the MIME width', () => {
    const node = buildImageNode(base());
    const dataNode = node.items.find(
      (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'data',
    );
    const pieces = dataNode && dataNode.kind === 'list' ? dataNode.items.slice(1) : [];

    // 96 characters at 76 per line is two pieces, the second a remainder.
    expect(pieces).toHaveLength(2);
    expect(BASE64_LINE_WIDTH).toBe(76);
  });

  it('splits so the pieces rejoin to exactly the original', () => {
    // The property that matters more than the chunk count.
    const node = buildImageNode(base());
    const dataNode = node.items.find(
      (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'data',
    );
    // The pieces are quoted strings (`str()` -> kind 'string'), not bare atoms.
    const joined =
      dataNode && dataNode.kind === 'list'
        ? dataNode.items
            .slice(1)
            .map((n) => (n.kind === 'string' ? n.value : ''))
            .join('')
        : '';

    expect(joined).toBe(PNG);
  });

  it('writes a scale only when it is not 1', () => {
    expect(text(base({ scale: 0.5 }))).toContain('(scale 0.5)');
    expect(text(base({ scale: 1 }))).not.toContain('(scale');
    expect(text(base())).not.toContain('(scale');
  });

  it('writes locked only when set', () => {
    expect(text(base({ locked: true }))).toContain('(locked yes)');
    expect(text(base())).not.toContain('(locked');
  });

  it('round-trips a built image back through the reader', () => {
    const b = read();
    b.images.push(base({ uuid: 'abc', scale: 0.25, locked: true }));
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.images).toHaveLength(1);
    expect(back.images[0]!.data).toBe(PNG);
    expect(back.images[0]!.scale).toBe(0.25);
    expect(back.images[0]!.locked).toBe(true);
    expect(back.images[0]!.at).toEqual({ x: MM(10), y: MM(20) });
  });

  it('round-trips a payload longer than one line', () => {
    // Three full lines plus a remainder, so the split is exercised properly.
    const long = 'A'.repeat(BASE64_LINE_WIDTH * 3 + 10);
    const b = read();
    b.images.push(base({ data: long }));
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.images[0]!.data).toBe(long);
  });
});
