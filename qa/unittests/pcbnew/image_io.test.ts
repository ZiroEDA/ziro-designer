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
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SList } from '@ziroeda/sexpr/types.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import { base64Decode } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_items.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { childNode, flatText, writtenNode } from './support/written_node.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A 1x1 transparent PNG, base64 — 96 characters, so it wraps. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** `FormatStreamData`'s MIME width: "the MIME standard character width for base64 encoding is 76". */
const BASE64_LINE_WIDTH = 76;

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

const read = (...extra: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`);
const images = (b: BOARD): PCB_REFERENCE_IMAGE[] =>
  b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T) as PCB_REFERENCE_IMAGE[];
const only = (src: string): PCB_REFERENCE_IMAGE => images(read(src))[0]!;
/** The image's bytes as `FormatStreamData` writes them: base64 of the original file. */
const dataOf = (img: PCB_REFERENCE_IMAGE): string => {
  const bytes = img.GetReferenceImage().GetImage().SaveImageData() ?? new Uint8Array(0);
  return btoa(String.fromCharCode(...bytes));
};

describe('reading a reference image (parsePCB_REFERENCE_IMAGE)', () => {
  it('reads the position, layer and uuid', () => {
    const img = only(IMAGE());

    expect(img.GetPosition()).toEqual({ x: MM(145.5), y: MM(108.25) });
    expect(img.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(img.m_Uuid).toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('joins the wrapped data back into one image', () => {
    // The fixture is split across two quoted pieces; the image holds one file.
    expect(dataOf(only(IMAGE()))).toBe(PNG);
  });

  it('reads the scale, 1 when the file omits it', () => {
    expect(only(IMAGE()).GetReferenceImage().GetImageScale()).toBe(1);
    expect(only(IMAGE('(scale 0.159863)')).GetReferenceImage().GetImageScale()).toBeCloseTo(
      0.159863,
      6,
    );
  });

  it('reads the locked flag', () => {
    expect(only(IMAGE('(locked yes)')).IsLocked()).toBe(true);
    expect(only(IMAGE()).IsLocked()).toBe(false);
  });

  it('keeps an image with no position, at the origin the constructor gave it', () => {
    // `parsePCB_REFERENCE_IMAGE` never insists on `(at …)`.
    const all = images(read(IMAGE().replace('(at 145.5 108.25)', '')));
    expect(all).toHaveLength(1);
    expect(all[0]!.GetPosition()).toEqual({ x: 0, y: 0 });
  });

  it('reads an image with no data as empty rather than failing', () => {
    const img = only(IMAGE().replace(/\(data[^)]*\)/s, ''));

    expect(dataOf(img)).toBe('');
    expect(img.GetPosition()).toEqual({ x: MM(145.5), y: MM(108.25) });
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched image back unchanged', () => {
    const back = images(ParseBoard(FormatBoard(read(IMAGE('(scale 0.5)')))));

    expect(back).toHaveLength(1);
    expect(dataOf(back[0]!)).toBe(PNG);
    expect(back[0]!.GetReferenceImage().GetImageScale()).toBe(0.5);
  });

  it('drops a deleted image', () => {
    const b = read(IMAGE(), IMAGE('(scale 2)'));
    b.Remove(images(b)[0]!);
    const back = images(ParseBoard(FormatBoard(b)));

    expect(back).toHaveLength(1);
    expect(back[0]!.GetReferenceImage().GetImageScale()).toBe(2);
  });
});

describe('writing an image built from scratch (format( PCB_REFERENCE_IMAGE* ))', () => {
  const build = (
    edit: (img: PCB_REFERENCE_IMAGE) => void = () => {},
    data: string = PNG,
  ): BOARD => {
    const b = read();
    const img = new PCB_REFERENCE_IMAGE(b, { x: MM(10), y: MM(20) }, PCB_LAYER_ID.F_SilkS);
    img.GetReferenceImage().ReadImageFile(base64Decode(data));
    edit(img);
    b.Add(img);
    return b;
  };
  const node = (edit?: (img: PCB_REFERENCE_IMAGE) => void): SList =>
    writtenNode(build(edit), 'image');
  const text = (edit?: (img: PCB_REFERENCE_IMAGE) => void): string => flatText(node(edit));

  it('writes the position and layer', () => {
    const s = text();

    expect(s).toContain('(at 10 20)');
    expect(s).toContain('(layer "F.SilkS")');
  });

  it('splits the data at the MIME width', () => {
    const pieces = childNode(node(), 'data')?.items.slice(1) ?? [];

    // 96 characters at 76 per line is two pieces, the second a remainder.
    expect(pieces).toHaveLength(2);
  });

  it('splits so the pieces rejoin to exactly the original', () => {
    const joined = (childNode(node(), 'data')?.items.slice(1) ?? [])
      .map((n) => (n.kind === 'string' ? n.value : ''))
      .join('');

    expect(joined).toBe(PNG);
  });

  it('writes a scale only when it is not 1', () => {
    expect(text((i) => i.GetReferenceImage().SetImageScale(0.5))).toContain('(scale 0.5)');
    expect(text((i) => i.GetReferenceImage().SetImageScale(1))).not.toContain('(scale');
    expect(text()).not.toContain('(scale');
  });

  it('writes locked only when set', () => {
    expect(text((i) => i.SetLocked(true))).toContain('(locked yes)');
    expect(text()).not.toContain('(locked');
  });

  it('round-trips a built image back through the reader', () => {
    const back = images(
      ParseBoard(
        FormatBoard(
          build((i) => {
            i.GetReferenceImage().SetImageScale(0.25);
            i.SetLocked(true);
          }),
        ),
      ),
    )[0]!;

    expect(dataOf(back)).toBe(PNG);
    expect(back.GetReferenceImage().GetImageScale()).toBe(0.25);
    expect(back.IsLocked()).toBe(true);
    expect(back.GetPosition()).toEqual({ x: MM(10), y: MM(20) });
  });

  it('round-trips a payload longer than one line', () => {
    // A real PNG: 20 x 20 pixels stored uncompressed is well over three lines.
    const long = btoa(String.fromCharCode(...new WX_IMAGE(20, 20).SaveFilePng()!));
    expect(long.length).toBeGreaterThan(BASE64_LINE_WIDTH * 3);
    const back = images(ParseBoard(FormatBoard(build(() => {}, long))))[0]!;

    expect(dataOf(back)).toBe(long);
  });
});
