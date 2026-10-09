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
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  PCB_DIM_RADIAL,
  PCB_DIMENSION_BASE,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import {
  DIM_ARROW_DIRECTION,
  DIM_PRECISION,
  DIM_TEXT_BORDER,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNode } from './support/written_node.js';

const mmToIU = (n: number): number => pcbIUScale.mmToIU(n);

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
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${dims.join('\n  ')}
)`;

const read = (...dims: string[]): BOARD => ParseBoard(boardWith(...dims));
const dims = (b: BOARD): PCB_DIMENSION_BASE[] =>
  b.Drawings().filter((d) => d instanceof PCB_DIMENSION_BASE) as PCB_DIMENSION_BASE[];
const only = <T extends PCB_DIMENSION_BASE = PCB_DIMENSION_BASE>(...src: string[]): T =>
  dims(read(...src))[0]! as T;

describe('reading dimensions (parseDIMENSION)', () => {
  it('reads all five kinds off one board', () => {
    expect(dims(read(ALIGNED, ORTHOGONAL, RADIAL, LEADER, CENTER)).map((d) => d.Type())).toEqual([
      KICAD_T.PCB_DIM_ALIGNED_T,
      KICAD_T.PCB_DIM_ORTHOGONAL_T,
      KICAD_T.PCB_DIM_RADIAL_T,
      KICAD_T.PCB_DIM_LEADER_T,
      KICAD_T.PCB_DIM_CENTER_T,
    ]);
  });

  it('reads the feature points, layer and uuid', () => {
    const d = only(ALIGNED);

    expect(d.GetLayer()).toBe(PCB_LAYER_ID.User_2);
    expect(d.m_Uuid).toBe('12e7f53c-3ecc-4d32-b518-0ba4f0397502');
    expect(d.GetStart()).toEqual({ x: mmToIU(161), y: mmToIU(56.5) });
    expect(d.GetEnd()).toEqual({ x: mmToIU(56.5), y: mmToIU(56.5) });
  });

  it('refuses a third xy child among the feature points', () => {
    // `parseDIMENSION`'s `T_pts` reads exactly two points and then `NeedRIGHT()`
    // (pcb_io_kicad_sexpr_parser.cpp:4623-4628): a third is a parse error.
    expect(() => read(ALIGNED.replace('(xy 56.5 56.5))', '(xy 56.5 56.5) (xy 99 99))'))).toThrow();
  });

  it('reads the format block', () => {
    const d = only(RADIAL);

    expect(d.GetPrefix()).toBe('R ');
    expect(d.GetSuffix()).toBe('');
    expect(d.GetUnitsMode()).toBe(DIM_UNITS_MODE.AUTOMATIC);
    expect(d.GetUnitsFormat()).toBe(DIM_UNITS_FORMAT.NO_SUFFIX);
    expect(d.GetPrecision()).toBe(DIM_PRECISION.X_XXXX);
    expect(d.GetOverrideTextEnabled()).toBe(false);
    expect(d.GetSuppressZeroes()).toBe(true);
  });

  it('reads an override value where one is set', () => {
    const d = only(LEADER);

    expect(d.GetOverrideTextEnabled()).toBe(true);
    expect(d.GetOverrideText()).toBe('0.3mm Thickness');
  });

  it('reads the style block', () => {
    const d = only<PCB_DIM_ALIGNED>(ALIGNED);

    expect(d.GetLineThickness()).toBe(mmToIU(0.15));
    expect(d.GetArrowLength()).toBe(mmToIU(1.27));
    expect(d.GetTextPositionMode()).toBe(DIM_TEXT_POSITION.OUTSIDE);
    expect(d.GetArrowDirection()).toBe(DIM_ARROW_DIRECTION.OUTWARD);
    expect(d.GetExtensionHeight()).toBe(mmToIU(0.58642));
    expect(d.GetExtensionOffset()).toBe(mmToIU(0.5));
    expect(d.GetKeepTextAligned()).toBe(true);
  });

  it('reads the kind-specific members', () => {
    expect(only<PCB_DIM_ALIGNED>(ALIGNED).GetHeight()).toBe(mmToIU(10.65));
    expect(only<PCB_DIM_RADIAL>(RADIAL).GetLeaderLength()).toBe(mmToIU(3.81));
    expect(only<PCB_DIM_LEADER>(LEADER).GetTextBorder()).toBe(DIM_TEXT_BORDER.NONE);
  });

  it('reads the dimension text into the dimension itself (it IS-A PCB_TEXT)', () => {
    const d = only(ORTHOGONAL);

    expect(d.GetText()).toBe('30');
    expect(d.GetTextAngle().AsDegrees()).toBe(90);
    expect(d.GetLayer()).toBe(PCB_LAYER_ID.Dwgs_User);
  });

  it('reads an orthogonal dimension as carrying the aligned members too', () => {
    // The whole point: orthogonal IS-A aligned upstream.
    const d = only<PCB_DIM_ORTHOGONAL>(ORTHOGONAL);

    expect(d.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    expect(d.GetHeight()).toBe(mmToIU(12.85));
    expect(d.GetExtensionHeight()).toBe(mmToIU(0.58642));
    expect(d.GetArrowDirection()).toBe(DIM_ARROW_DIRECTION.OUTWARD);
  });

  it('rejects a dimension whose type it does not know', () => {
    // `Expecting( "aligned, orthogonal, radial, leader, or center" )`.
    expect(() => read(ALIGNED.replace('(type aligned)', '(type ordinate)'))).toThrow();
  });
});

describe('round-tripping through the writer', () => {
  it('gives back every dimension', () => {
    const out = FormatBoard(read(ALIGNED, ORTHOGONAL, RADIAL, LEADER, CENTER));

    expect(dims(ParseBoard(out))).toHaveLength(5);
    for (const k of ['aligned', 'orthogonal', 'radial', 'leader', 'center'])
      expect(out).toContain(`(type ${k})`);
  });

  it('drops a deleted dimension and keeps the rest', () => {
    const b = read(ALIGNED, ORTHOGONAL, CENTER);
    b.Remove(dims(b)[1]!);

    expect(
      dims(ParseBoard(FormatBoard(b)))
        .map((d) => d.Type())
        .sort(),
    ).toEqual([KICAD_T.PCB_DIM_ALIGNED_T, KICAD_T.PCB_DIM_CENTER_T].sort());
  });
});

describe('writing a dimension built from scratch (format( PCB_DIMENSION_BASE* ))', () => {
  type Kind = 'aligned' | 'orthogonal' | 'radial' | 'leader' | 'center';
  const make = (kind: Kind, b: BOARD): PCB_DIMENSION_BASE => {
    switch (kind) {
      case 'aligned':
        return new PCB_DIM_ALIGNED(b);
      case 'orthogonal':
        return new PCB_DIM_ORTHOGONAL(b);
      case 'radial':
        return new PCB_DIM_RADIAL(b);
      case 'leader':
        return new PCB_DIM_LEADER(b);
      case 'center':
        return new PCB_DIM_CENTER(b);
    }
  };
  /** (0,0) -> (10,0) on Dwgs.User; aligned kinds 5 mm high with a 0.5 mm extension height. */
  const build = (
    kind: Kind,
    edit: (d: PCB_DIMENSION_BASE) => void = () => {},
  ): PCB_DIMENSION_BASE => {
    const b = read();
    const d = make(kind, b);
    d.SetLayer(PCB_LAYER_ID.Dwgs_User);
    d.SetStart({ x: 0, y: 0 });
    d.SetEnd({ x: mmToIU(10), y: 0 });
    if (d instanceof PCB_DIM_ALIGNED) {
      d.SetHeight(mmToIU(5));
      d.SetExtensionHeight(mmToIU(0.5));
    }
    edit(d);
    d.Update();
    b.Add(d);
    return d;
  };
  const text = (kind: Kind, edit?: (d: PCB_DIMENSION_BASE) => void): string =>
    flatText(writtenNode(build(kind, edit).GetBoard()!, 'dimension'));

  it('writes the aligned members for an aligned dimension', () => {
    const s = text('aligned');

    expect(s).toContain('(type aligned)');
    expect(s).toContain('(height 5)');
    expect(s).toContain('(extension_height 0.5)');
    expect(s).toContain('(arrow_direction outward)');
  });

  it('writes the aligned members for an orthogonal one as well', () => {
    // The dynamic_cast rule: an orthogonal dimension is a PCB_DIM_ALIGNED.
    const s = text('orthogonal', (d) =>
      (d as PCB_DIM_ORTHOGONAL).SetOrientation(PCB_DIM_ORTHOGONAL.DIR.VERTICAL),
    );

    expect(s).toContain('(height 5)');
    expect(s).toContain('(extension_height 0.5)');
    expect(s).toContain('(arrow_direction outward)');
    expect(s).toContain('(orientation 1)');
  });

  it('writes orientation only for an orthogonal one', () => {
    expect(text('aligned')).not.toContain('(orientation');
  });

  it('withholds the aligned members from the other three kinds', () => {
    for (const kind of ['radial', 'leader', 'center'] as const) {
      const s = text(kind);
      expect(s, kind).not.toContain('(height ');
      expect(s, kind).not.toContain('(extension_height');
      expect(s, kind).not.toContain('(arrow_direction');
    }
  });

  it('writes leader_length only for a radial one', () => {
    expect(text('radial', (d) => (d as PCB_DIM_RADIAL).SetLeaderLength(mmToIU(3.81)))).toContain(
      '(leader_length 3.81)',
    );
    expect(text('aligned')).not.toContain('(leader_length');
  });

  it('writes text_frame only for a leader', () => {
    expect(
      text('leader', (d) => (d as PCB_DIM_LEADER).SetTextBorder(DIM_TEXT_BORDER.CIRCLE)),
    ).toContain('(text_frame 2)');
    expect(text('aligned')).not.toContain('(text_frame');
  });

  it('writes neither format nor text for a centre dimension', () => {
    const s = text('center');

    expect(s).not.toContain('(format');
    expect(s).not.toContain('gr_text');
  });

  it('writes the format block for every other kind', () => {
    for (const kind of ['aligned', 'orthogonal', 'leader', 'radial'] as const)
      expect(text(kind), kind).toContain('(format');
  });

  it('writes an override value only when one is set', () => {
    expect(
      text('aligned', (d) => {
        d.SetOverrideTextEnabled(true);
        d.SetOverrideText('12 thou');
      }),
    ).toContain('(override_value "12 thou")');
    expect(text('aligned')).not.toContain('(override_value');
  });

  it('writes an empty override value, which is not the same as none', () => {
    // The presence of the token is the enable flag (`GetOverrideTextEnabled`),
    // so an override set to "" must still be written.
    expect(
      text('aligned', (d) => {
        d.SetOverrideTextEnabled(true);
        d.SetOverrideText('');
      }),
    ).toContain('(override_value "")');
  });

  it('writes suppress_zeroes and keep_text_aligned only when true', () => {
    const on = text('aligned', (d) => {
      d.SetSuppressZeroes(true);
      d.SetKeepTextAligned(true);
    });

    expect(on).toContain('(suppress_zeroes yes)');
    expect(on).toContain('(keep_text_aligned yes)');
    expect(text('aligned', (d) => d.SetSuppressZeroes(false))).not.toContain('(suppress_zeroes');
    // `PCB_DIMENSION_BASE` is born with `m_keepTextAligned( true )`.
    expect(text('aligned')).toContain('(keep_text_aligned yes)');
    expect(text('aligned', (d) => d.SetKeepTextAligned(false))).not.toContain('(keep_text_aligned');
  });

  it('round-trips a built dimension back through the reader', () => {
    const d = build('orthogonal', (x) =>
      (x as PCB_DIM_ORTHOGONAL).SetOrientation(PCB_DIM_ORTHOGONAL.DIR.VERTICAL),
    );
    const back = dims(ParseBoard(FormatBoard(d.GetBoard()!)));

    expect(back).toHaveLength(1);
    expect(back[0]!.Type()).toBe(KICAD_T.PCB_DIM_ORTHOGONAL_T);
    expect((back[0]! as PCB_DIM_ORTHOGONAL).GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    expect((back[0]! as PCB_DIM_ORTHOGONAL).GetHeight()).toBe(mmToIU(5));
  });
});
