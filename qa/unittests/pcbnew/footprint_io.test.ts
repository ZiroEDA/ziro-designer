// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD, BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import {
  FormatFootprintForLibrary,
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mmToIU = (n: number): number => pcbIUScale.mmToIU(n);

/**
 * `FP_CACHE::Save`'s text for one footprint: `Format( footprint )` under
 * `CTL_FOR_LIBRARY`, the path `kicad-cli fp upgrade` writes a library through.
 * Byte-identical to its output on the custom-pad fixture below, apart from the
 * generator and FP_CACHE naming the footprint after its file.
 *
 * Not `FootprintSave`: that clones first, and FOOTPRINT's copy constructor gives
 * the four mandatory fields the new footprint's own KIIDs (`*existingField =
 * *field` never assigns `const KIID m_Uuid`), so its output is no fixed point.
 */
const save = (fp: FOOTPRINT): string => FormatFootprintForLibrary(fp);

/** Read, save, read and save again: the second save must write the first's bytes. */
const fixedPoint = (text: string): [string, string] => {
  const once = save(ParseFootprintFile(text));
  return [save(ParseFootprintFile(once)), once];
};

// A minimal but real-shaped KiCad 9 `.kicad_mod`: a two-pad SMD resistor with a
// reference/value property and silkscreen + courtyard graphics. Children are in
// footprint-LOCAL coordinates (no top-level (at ...)).
const R_0603 = `(footprint "R_0603_1608Metric"
	(version 20241229)
	(generator "pcbnew")
	(generator_version "9.0")
	(layer "F.Cu")
	(descr "Resistor SMD 0603")
	(tags "resistor")
	(property "Reference" "REF**"
		(at 0 -1.43 0)
		(layer "F.SilkS")
		(uuid "11111111-1111-1111-1111-111111111111")
		(effects
			(font
				(size 1 1)
				(thickness 0.15)
			)
		)
	)
	(property "Value" "R_0603"
		(at 0 1.43 0)
		(layer "F.Fab")
		(uuid "22222222-2222-2222-2222-222222222222")
		(effects
			(font
				(size 1 1)
				(thickness 0.15)
			)
		)
	)
	(fp_line
		(start -0.8 -0.4)
		(end 0.8 -0.4)
		(stroke
			(width 0.12)
			(type solid)
		)
		(layer "F.SilkS")
		(uuid "33333333-3333-3333-3333-333333333333")
	)
	(pad "1" smd roundrect
		(at -0.7875 0)
		(size 0.875 0.95)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25)
		(uuid "44444444-4444-4444-4444-444444444444")
	)
	(pad "2" smd roundrect
		(at 0.7875 0)
		(size 0.875 0.95)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25)
		(uuid "55555555-5555-5555-5555-555555555555")
	)
)
`;

describe('ParseFootprintFile / FootprintSave (.kicad_mod)', () => {
  it('reads a footprint in its own local frame', () => {
    const fp = ParseFootprintFile(R_0603);
    expect(fp.GetFPID().GetLibItemName()).toBe('R_0603_1608Metric');
    expect(fp.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(fp.Pads()).toHaveLength(2);
    expect(fp.GraphicalItems()).toHaveLength(1);
    // Local coordinates are preserved verbatim (no board transform baked in).
    expect(fp.Pads()[0]!.GetPosition().x).toBe(mmToIU(-0.7875));
    expect(fp.Pads()[1]!.GetPosition().x).toBe(mmToIU(0.7875));
    expect(fp.Pads()[0]!.GetRoundRectRadiusRatio(PCB_LAYER_ID.F_Cu)).toBeCloseTo(0.25, 6);
    // Reference/Value are the two mandatory fields.
    expect(fp.GetReference()).toBe('REF**');
    expect(fp.GetValue()).toBe('R_0603');
  });

  it('round-trips losslessly: the second save writes the first one back', () => {
    const [twice, once] = fixedPoint(R_0603);
    expect(twice).toBe(once);
  });

  it('rejects a non-footprint file', () => {
    expect(() => ParseFootprintFile('(kicad_pcb (version 20241229))')).toThrow();
  });
});

// A real KiCad footprint with a **custom pad**, which is the primitive-
// preservation path and the one thing the bundled sweep below cannot reach:
// not one footprint in CM5IO.pretty has `(primitives …)`. Vendored, so the
// coverage cannot skip silently on a machine without the original.
const ONEPIN = fileURLToPath(new URL('../../data/custom_pads_1pin.kicad_mod', import.meta.url));
const primitives = (fp: FOOTPRINT): number =>
  fp.Pads().reduce((n, p) => n + p.GetPrimitives(PCB_LAYER_ID.F_Cu).length, 0);

describe('ParseFootprintFile (a footprint with custom pads)', () => {
  it('reads the custom pad’s primitives at all', () => {
    // Asserted separately from the round trip: a field dropped on *read* is
    // symmetric, so read→write→read would still match.
    expect(primitives(ParseFootprintFile(readFileSync(ONEPIN, 'utf8')))).toBeGreaterThan(0);
  });

  it('round-trips a real .kicad_mod', () => {
    const [twice, once] = fixedPoint(readFileSync(ONEPIN, 'utf8'));
    expect(twice).toBe(once);
  });

  it('keeps them through a save', () => {
    const fp1 = ParseFootprintFile(readFileSync(ONEPIN, 'utf8'));
    const text = save(fp1);
    expect(text).toContain('(primitives');
    expect(primitives(ParseFootprintFile(text))).toBe(primitives(fp1));
  });
});

// Sweep the library the Footprint Editor actually bundles (designer/public):
// every real KiCad 9 footprint the editor can open must parse and round-trip.
const BUNDLED = new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url)
  .pathname;
describe.skipIf(!existsSync(BUNDLED))('bundled footprint library (CM5IO.pretty)', () => {
  const files = existsSync(BUNDLED)
    ? readdirSync(BUNDLED).filter((f) => f.endsWith('.kicad_mod'))
    : [];
  it('parses every bundled footprint', { timeout: 30_000 }, () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files)
      expect(() => ParseFootprintFile(readFileSync(`${BUNDLED}/${f}`, 'utf8')), f).not.toThrow();
  });
  it('round-trips every bundled footprint to a fixed point', { timeout: 30_000 }, () => {
    for (const f of files) {
      const [twice, once] = fixedPoint(readFileSync(`${BUNDLED}/${f}`, 'utf8'));
      expect(twice, f).toBe(once);
    }
  });
});

/**
 * `${REFERENCE}` on F.Fab is on essentially every KiCad library footprint, and
 * whether it is substituted depends on the board the footprint sits on:
 *
 *     bool FOOTPRINT::ResolveTextVar( wxString* token, int aDepth ) const
 *     {
 *         if( GetBoard() && GetBoard()->GetBoardUse() == BOARD_USE::FPHOLDER )
 *             return false;
 *
 * (`pcbnew/footprint.cpp:1185-1188`). The footprint editor and the chooser's
 * preview both hold their footprint on a `BOARD_USE::FPHOLDER` board, so they
 * paint `${REFERENCE}` where pcbnew paints `R1`.
 */
describe('text variables and the footprint-holder board', () => {
  const WITH_VAR = `(footprint "T" (version 20241229) (generator "t") (layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(property "Value" "T" (at 0 1 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15))))
	(fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15)))))`;

  const fabText = (fp: FOOTPRINT): string =>
    (
      fp
        .GraphicalItems()
        .find(
          (t) => t.Type() === KICAD_T.PCB_TEXT_T && t.GetLayer() === PCB_LAYER_ID.F_Fab,
        )! as PCB_TEXT
    ).GetShownText(true);

  it('leaves the literal alone on an FPHOLDER board', () => {
    const holder = new BOARD();
    holder.SetBoardUse(BOARD_USE.FPHOLDER);
    const fp = ParseFootprintFile(WITH_VAR);
    holder.Add(fp);
    expect(fabText(fp)).toBe('\${REFERENCE}');
  });

  it('substitutes it on a board, where ResolveTextVar answers', () => {
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "t")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (35 "F.Fab" user))
  (net 0 "")
  ${WITH_VAR.replace('(property "Reference" "REF**"', '(property "Reference" "D7"')})`);

    expect(fabText(board.Footprints()[0]!)).toBe('D7');
  });
});
