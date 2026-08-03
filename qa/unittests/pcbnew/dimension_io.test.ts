// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dimensions in the board model, and their file format.
 * Counterparts: `PCB_DIMENSION_BASE` and its five subclasses
 * (pcbnew/pcb_dimension.h), `PCB_IO_KICAD_SEXPR::format(PCB_DIMENSION_BASE*)`
 * and `parseDIMENSION`.
 *
 * Every `(dimension …)` fixture below is copied **verbatim from a real KiCad
 * file** — the aligned one from `demos/tiny_tapeout`, the orthogonal from
 * `demos/cm5_minima`, the radial from `demos/constraints`, the leader from
 * `demos/royalblue54L_feather` and the centre from KiCad's own
 * `qa/data/pcbnew/api_kitchen_sink.kicad_pcb`. Hand-written fixtures would let
 * me invent a field layout and then "confirm" it.
 *
 * The rule that is easy to get wrong: an **orthogonal** dimension writes every
 * *aligned* field too. Upstream reaches those through
 * `dynamic_cast<PCB_DIM_ALIGNED*>`, which succeeds for orthogonal because
 * `PCB_DIM_ORTHOGONAL` derives from `PCB_DIM_ALIGNED` — so the `(type)` test
 * putting orthogonal first does *not* make the aligned fields exclusive. The
 * real cm5_minima node below carries `height`, `extension_height`,
 * `arrow_direction` and `orientation` all at once, which is the proof.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard, buildDimensionNode } from '@ziroeda/pcbnew/src/write-board.js';
import { isAlignedKind, type Board, type PcbDimension } from '@ziroeda/pcbnew/src/types.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

const ALIGNED = `(dimension
    (type aligned)
    (layer "User.2")
    (uuid "12e7f53c-3ecc-4d32-b518-0ba4f0397502")
    (pts (xy 161 56.5) (xy 56.5 56.5))
    (height 10.65)
    (format (prefix "") (suffix "") (units 3) (units_format 1) (precision 4))
    (style (thickness 0.15) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "104.5000 mm" (at 108.75 44.7 0) (layer "User.2")
      (uuid "12e7f53c-3ecc-4d32-b518-0ba4f0397502")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const ORTHOGONAL = `(dimension
    (type orthogonal)
    (layer "Dwgs.User")
    (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
    (pts (xy 113.6 58.975) (xy 113.35 28.975))
    (height 12.85)
    (orientation 1)
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User")
      (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const RADIAL = `(dimension
    (type radial)
    (layer "F.Fab")
    (uuid "1b85eaf0-8034-4a99-a6e5-4e1fe6cb017d")
    (pts (xy 170.8145 147.646701) (xy 172.824419 143.564701))
    (leader_length 3.81)
    (format (prefix "R ") (suffix "") (units 3) (units_format 0) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.05) (arrow_length 1.27) (text_position_mode 0)
      (extension_offset 0.5) (keep_text_aligned yes))
    (gr_text "R 4.55" (at 180.447155 140.121106 0) (layer "F.Fab")
      (uuid "1b85eaf0-8034-4a99-a6e5-4e1fe6cb017d")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const LEADER = `(dimension
    (type leader)
    (layer "Cmts.User")
    (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
    (pts (xy 152.94971 67.310695) (xy 156.29971 63.960695))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4)
      (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (text_frame 0) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.99971 63.960695 0) (layer "Cmts.User")
      (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const CENTER = `(dimension
    (type center)
    (layer "F.SilkS")
    (uuid "6c3890f3-95ec-403d-a195-7e14eaa0059b")
    (pts (xy 106.5 90.75) (xy 106.5 87.25))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (extension_offset 0.5) (keep_text_aligned yes)))`;

const boardWith = (...dims: string[]): string => `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${dims.join('\n  ')}
)`;

const read = (...dims: string[]): Board => readBoard(parse(boardWith(...dims)));
const only = (...dims: string[]): PcbDimension => read(...dims).dimensions[0]!;

describe('which kinds count as aligned', () => {
  it('is aligned and orthogonal, matching the dynamic_cast', () => {
    expect(isAlignedKind('aligned')).toBe(true);
    expect(isAlignedKind('orthogonal')).toBe(true);
  });

  it('is not the other three', () => {
    expect(isAlignedKind('leader')).toBe(false);
    expect(isAlignedKind('center')).toBe(false);
    expect(isAlignedKind('radial')).toBe(false);
  });
});

describe('reading dimensions', () => {
  it('reads all five kinds off one board', () => {
    const b = read(ALIGNED, ORTHOGONAL, RADIAL, LEADER, CENTER);

    expect(b.dimensions.map((d) => d.kind)).toEqual([
      'aligned',
      'orthogonal',
      'radial',
      'leader',
      'center',
    ]);
  });

  it('reads the feature points, layer and uuid', () => {
    const d = only(ALIGNED);

    expect(d.layer).toBe('User.2');
    expect(d.uuid).toBe('12e7f53c-3ecc-4d32-b518-0ba4f0397502');
    expect(d.start).toEqual({ x: mmToIU(161), y: mmToIU(56.5) });
    expect(d.end).toEqual({ x: mmToIU(56.5), y: mmToIU(56.5) });
  });

  it('takes only the first two xy children as the feature points', () => {
    // `(pts …)` is a generic point list elsewhere in the format; a dimension has
    // exactly two feature points and reading a third as `end` would silently
    // move the measurement.
    const d = only(ALIGNED.replace('(xy 56.5 56.5))', '(xy 56.5 56.5) (xy 99 99))'));

    expect(d.end).toEqual({ x: mmToIU(56.5), y: mmToIU(56.5) });
  });

  it('reads the format block', () => {
    const d = only(RADIAL);

    expect(d.format).toEqual({
      prefix: 'R ',
      suffix: '',
      units: 3,
      unitsFormat: 0,
      precision: 4,
      overrideValue: undefined,
      suppressZeroes: true,
    });
  });

  it('reads an override value where one is set', () => {
    expect(only(LEADER).format?.overrideValue).toBe('0.3mm Thickness');
  });

  it('reads the style block', () => {
    const d = only(ALIGNED);

    expect(d.style.thickness).toBe(mmToIU(0.15));
    expect(d.style.arrowLength).toBe(mmToIU(1.27));
    expect(d.style.textPositionMode).toBe(0);
    expect(d.style.arrowDirection).toBe('outward');
    expect(d.style.extensionHeight).toBe(mmToIU(0.58642));
    expect(d.style.extensionOffset).toBe(mmToIU(0.5));
    expect(d.style.keepTextAligned).toBe(true);
  });

  it('reads the kind-specific members', () => {
    expect(only(ALIGNED).height).toBe(mmToIU(10.65));
    expect(only(RADIAL).leaderLength).toBe(mmToIU(3.81));
    expect(only(LEADER).style.textFrame).toBe(0);
  });

  it('reads the dimension text as a text item', () => {
    const d = only(ORTHOGONAL);

    expect(d.text?.text).toBe('30');
    expect(d.text?.angle).toBe(90);
    expect(d.text?.layer).toBe('Dwgs.User');
  });

  it('gives a centre dimension neither a format nor text', () => {
    // It marks a point rather than measuring one, so there is nothing to render
    // as a number.
    const d = only(CENTER);

    expect(d.format).toBeUndefined();
    expect(d.text).toBeUndefined();
  });

  it('reads an orthogonal dimension as carrying the aligned members too', () => {
    // The whole point: orthogonal IS-A aligned upstream.
    const d = only(ORTHOGONAL);

    expect(d.orientation).toBe(1);
    expect(d.height).toBe(mmToIU(12.85));
    expect(d.style.extensionHeight).toBe(mmToIU(0.58642));
    expect(d.style.arrowDirection).toBe('outward');
  });

  it('skips a dimension whose type it does not know', () => {
    // Rather than guessing a kind and writing back something different.
    expect(read(ALIGNED.replace('(type aligned)', '(type ordinate)')).dimensions).toHaveLength(0);
  });
});

describe('round-tripping through the writer', () => {
  it('gives back every dimension unchanged', () => {
    // The lossless patch-in-place contract: an untouched item is re-emitted from
    // its own source node.
    const text = boardWith(ALIGNED, ORTHOGONAL, RADIAL, LEADER, CENTER);
    const out = serializeBoard(readBoard(parse(text)));
    const back = readBoard(parse(out));

    expect(back.dimensions).toHaveLength(5);
    expect(back.dimensions.map((d) => d.kind)).toEqual(
      read(ALIGNED, ORTHOGONAL, RADIAL, LEADER, CENTER).dimensions.map((d) => d.kind),
    );
    for (const k of [
      '(type aligned)',
      '(type orthogonal)',
      '(type radial)',
      '(type leader)',
      '(type center)',
    ])
      expect(out).toContain(k);
  });

  it('keeps a dimension when other items are edited around it', () => {
    const b = read(ALIGNED, CENTER);
    b.texts.push({
      kind: 'user',
      text: 'hello',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: mmToIU(1), y: mmToIU(1) },
      source: { kind: 'list', items: [] },
    });
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.dimensions).toHaveLength(2);
    expect(back.texts.some((t) => t.text === 'hello')).toBe(true);
  });

  it('drops a deleted dimension and keeps the rest, in model order', () => {
    // The positional walk fills each source `(dimension …)` slot from the model
    // array in order and drops the trailing slots. So removing the *middle*
    // dimension leaves the first and last — not the first two. Getting this
    // backwards would silently rewrite one dimension into another's slot.
    const b = read(ALIGNED, ORTHOGONAL, CENTER);
    b.dimensions.splice(1, 1);
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.dimensions.map((d) => d.kind)).toEqual(['aligned', 'center']);
  });
});

describe('building a dimension node from scratch', () => {
  // The source-less path, used by a freshly-drawn dimension. Here the
  // kind decides which children exist, so each kind is checked for what it must
  // and must not write.
  const base = (over: Partial<PcbDimension> = {}): PcbDimension => ({
    kind: 'aligned',
    layer: 'Dwgs.User',
    start: { x: 0, y: 0 },
    end: { x: mmToIU(10), y: 0 },
    height: mmToIU(5),
    style: {
      thickness: mmToIU(0.1),
      arrowLength: mmToIU(1.27),
      textPositionMode: 0,
      arrowDirection: 'outward',
      extensionHeight: mmToIU(0.5),
      extensionOffset: mmToIU(0.5),
    },
    format: { prefix: '', suffix: '', units: 3, unitsFormat: 1, precision: 4 },
    source: { kind: 'list', items: [] },
    ...over,
  });
  const text = (d: PcbDimension): string => serialize(buildDimensionNode(d));

  it('writes the aligned members for an aligned dimension', () => {
    const s = text(base());

    expect(s).toContain('(type aligned)');
    expect(s).toContain('(height 5)');
    expect(s).toContain('(extension_height 0.5)');
    expect(s).toContain('(arrow_direction outward)');
  });

  it('writes the aligned members for an orthogonal one as well', () => {
    // The dynamic_cast rule. If this ever regresses, an orthogonal dimension
    // silently loses its crossbar height on save.
    const s = text(base({ kind: 'orthogonal', orientation: 1 }));

    expect(s).toContain('(height 5)');
    expect(s).toContain('(extension_height 0.5)');
    expect(s).toContain('(arrow_direction outward)');
    expect(s).toContain('(orientation 1)');
  });

  it('writes orientation only for an orthogonal one', () => {
    expect(text(base())).not.toContain('(orientation');
  });

  it('withholds the aligned members from the other three kinds', () => {
    for (const kind of ['radial', 'leader', 'center'] as const) {
      const s = text(base({ kind }));
      expect(s, kind).not.toContain('(height ');
      expect(s, kind).not.toContain('(extension_height');
      expect(s, kind).not.toContain('(arrow_direction');
    }
  });

  it('writes leader_length only for a radial one', () => {
    expect(text(base({ kind: 'radial', leaderLength: mmToIU(3.81) }))).toContain(
      '(leader_length 3.81)',
    );
    expect(text(base())).not.toContain('(leader_length');
  });

  it('writes text_frame only for a leader', () => {
    expect(text(base({ kind: 'leader', style: { ...base().style, textFrame: 2 } }))).toContain(
      '(text_frame 2)',
    );
    expect(text(base())).not.toContain('(text_frame');
  });

  it('writes neither format nor text for a centre dimension', () => {
    const s = text(
      base({
        kind: 'center',
        text: {
          kind: 'user',
          text: 'ignored',
          at: { x: 0, y: 0 },
          angle: 0,
          layer: 'Dwgs.User',
          size: { x: mmToIU(1), y: mmToIU(1) },
          source: { kind: 'list', items: [] },
        },
      }),
    );

    expect(s).not.toContain('(format');
    expect(s).not.toContain('gr_text');
  });

  it('writes the format block for every other kind', () => {
    for (const kind of ['aligned', 'orthogonal', 'leader', 'radial'] as const)
      expect(text(base({ kind })), kind).toContain('(format');
  });

  it('writes an override value only when one is set', () => {
    const withOverride = base({
      format: { ...base().format!, overrideValue: '12 thou' },
    });

    expect(text(withOverride)).toContain('(override_value "12 thou")');
    expect(text(base())).not.toContain('(override_value');
  });

  it('writes an empty override value, which is not the same as none', () => {
    // The presence of the token is the enable flag upstream
    // (`GetOverrideTextEnabled`), so an override set to "" must still be written
    // or the dimension reverts to showing its measured value on reload.
    const s = text(base({ format: { ...base().format!, overrideValue: '' } }));

    expect(s).toContain('(override_value "")');
  });

  it('writes suppress_zeroes and keep_text_aligned only when true', () => {
    const on = base({
      format: { ...base().format!, suppressZeroes: true },
      style: { ...base().style, keepTextAligned: true },
    });

    expect(text(on)).toContain('(suppress_zeroes yes)');
    expect(text(on)).toContain('(keep_text_aligned yes)');
    expect(text(base())).not.toContain('(suppress_zeroes');
    expect(text(base())).not.toContain('(keep_text_aligned');
  });

  it('round-trips a built dimension back through the reader', () => {
    const b = read();
    b.dimensions.push(base({ kind: 'orthogonal', orientation: 1, uuid: 'abc' }));
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.dimensions).toHaveLength(1);
    expect(back.dimensions[0]!.kind).toBe('orthogonal');
    expect(back.dimensions[0]!.orientation).toBe(1);
    expect(back.dimensions[0]!.height).toBe(mmToIU(5));
  });
});
