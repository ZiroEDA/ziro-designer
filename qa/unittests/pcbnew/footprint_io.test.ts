// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard, readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

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

/** Drop `source` (and undefined keys) so two reads compare by value, not AST identity. */
/**
 * The typed model, without any of the retained parse trees.
 *
 * `source` has to come off the *children* too, not just the footprint: it is the
 * node the item was read from, and the writer is entitled to emit a different
 * one for the same model. It does, for a pre-v7 library footprint whose text
 * carries no angle — KiCad's `format( const PCB_TEXT* )` always prints one
 * (`(at %s %s)` with `FormatAngle( GetTextAngle() )`,
 * pcb_io_kicad_sexpr.cpp:2300), which is why every footprint KiCad 10 writes
 * has the three-argument form: `(at 4.505 -1.28 0)` in `ecc83-pp.kicad_pcb`.
 * Comparing the ASTs made this a byte-fidelity test wearing a model test's name,
 * and it failed on the one bundled footprint still written the old way.
 */
const strip = (fp: PcbFootprint): unknown =>
  JSON.parse(
    JSON.stringify({
      ...fp,
      source: undefined,
      pads: fp.pads.map((p) => ({ ...p, source: undefined })),
      texts: fp.texts.map((t) => ({ ...t, source: undefined })),
      shapes: fp.shapes.map((sh) => ({ ...sh, source: undefined })),
      fields: fp.fields?.map((f) => ({ ...f, source: undefined })),
    }),
  );

describe('readFootprintFile / serializeFootprint (.kicad_mod)', () => {
  it('reads a footprint in its own local frame', () => {
    const fp = readFootprintFile(parse(R_0603))!;
    expect(fp).not.toBeNull();
    expect(fp.lib).toBe('R_0603_1608Metric');
    expect(fp.layer).toBe('F.Cu');
    expect(fp.pads).toHaveLength(2);
    expect(fp.shapes).toHaveLength(1);
    // Local coordinates are preserved verbatim (no board transform baked in).
    expect(fp.pads[0]!.at.x).toBe(mmToIU(-0.7875));
    expect(fp.pads[1]!.at.x).toBe(mmToIU(0.7875));
    expect(fp.pads[0]!.roundrectRatio).toBeCloseTo(0.25, 6);
    // Reference/Value become text items.
    expect(fp.reference).toBe('REF**');
    expect(fp.value).toBe('R_0603');
    expect(fp.texts.some((t) => t.kind === 'reference')).toBe(true);
  });

  it('round-trips losslessly (model is identical after write + re-read)', () => {
    const fp1 = readFootprintFile(parse(R_0603))!;
    const text = serializeFootprint(fp1);
    const fp2 = readFootprintFile(parse(text))!;
    expect(strip(fp2)).toEqual(strip(fp1));
  });

  it('rejects a non-footprint node', () => {
    expect(readFootprintFile(parse('(kicad_pcb (version 20241229))'))).toBeNull();
  });
});

// A real KiCad footprint with a **custom pad**, which is the primitive-
// preservation path and the one thing the bundled sweep below cannot reach:
// not one footprint in CM5IO.pretty has `(primitives …)`.
//
// It used to point at an absolute path under a developer's home directory, so
// it ran on exactly one machine and skipped silently everywhere else — CI
// included. `describe.skipIf` makes lost coverage look like a passing suite,
// which is why the fixture is vendored here instead.
const ONEPIN = fileURLToPath(new URL('../../data/custom_pads_1pin.kicad_mod', import.meta.url));
describe('readFootprintFile (a footprint with custom pads)', () => {
  it('reads the custom pad’s primitives at all', () => {
    // Asserted before the round trip, and separately from it: a field dropped
    // on *read* is symmetric, so read→write→read still matches and the
    // comparison below sees nothing. That was true here — deleting the
    // primitives from the reader left this file's only real assertion green.
    const fp = readFootprintFile(parse(readFileSync(ONEPIN, 'utf8')))!;
    const withPrims = fp.pads.filter((p) => (p.primitives?.length ?? 0) > 0);
    expect(withPrims.length, 'the fixture no longer has a custom pad').toBeGreaterThan(0);
  });

  it('round-trips a real .kicad_mod', () => {
    const src = readFileSync(ONEPIN, 'utf8');
    const fp1 = readFootprintFile(parse(src))!;
    expect(fp1).not.toBeNull();
    const fp2 = readFootprintFile(parse(serializeFootprint(fp1)))!;
    expect(strip(fp2)).toEqual(strip(fp1));
  });

  it('keeps them through a save', () => {
    // And the other half: written out and read back, the primitives are still
    // there. Together these two say what the round trip alone cannot.
    const fp1 = readFootprintFile(parse(readFileSync(ONEPIN, 'utf8')))!;
    const text = serializeFootprint(fp1);
    expect(text).toContain('(primitives');
    const fp2 = readFootprintFile(parse(text))!;
    const prims = (f: typeof fp1): number =>
      f.pads.reduce((n, p) => n + (p.primitives?.length ?? 0), 0);
    expect(prims(fp2)).toBe(prims(fp1));
    expect(prims(fp2)).toBeGreaterThan(0);
  });
});

// Sweep the library the Footprint Editor actually bundles (designer/public):
// every real KiCad 9 footprint the editor can open must parse and round-trip.
const BUNDLED = new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url)
  .pathname;
describe.skipIf(!existsSync(BUNDLED))('bundled footprint library (CM5IO.pretty)', () => {
  const files = readdirSync(BUNDLED).filter((f) => f.endsWith('.kicad_mod'));
  it('parses every bundled footprint', { timeout: 30_000 }, () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const fp = readFootprintFile(parse(readFileSync(`${BUNDLED}/${f}`, 'utf8')));
      expect(fp, f).not.toBeNull();
    }
  });
  // 69 footprints, each parsed, serialised and parsed again, then deep-compared.
  // That is ~1.4s on its own but comfortably past vitest's 5s default once the
  // rest of the suite is competing for cores, so it gets a timeout that matches
  // the work rather than the default.
  it('round-trips every bundled footprint model-identically', { timeout: 30_000 }, () => {
    for (const f of files) {
      const fp1 = readFootprintFile(parse(readFileSync(`${BUNDLED}/${f}`, 'utf8')))!;
      const fp2 = readFootprintFile(parse(serializeFootprint(fp1)))!;
      expect(strip(fp2), f).toEqual(strip(fp1));
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
 * (`pcbnew/footprint.cpp:1185-1188`). `PCB_TEXT::GetShownText`'s resolver then
 * asks the board, which knows no such token either, so the literal survives —
 * which is why the footprint editor and the chooser's footprint preview, both
 * of which hold their footprint on a `BOARD_USE::FPHOLDER` board
 * (`footprint_preview_panel.cpp`), paint `${REFERENCE}` and pcbnew paints `R1`.
 *
 * Ours resolved it in the reader, so the preview showed `REF**` where KiCad
 * shows the variable.
 */
describe('text variables and the footprint-holder board', () => {
  const WITH_VAR = `(footprint "T" (version 20241229) (generator "t") (layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(property "Value" "T" (at 0 1 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15))))
	(fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15)))))`;

  const fabText = (fp: PcbFootprint): string =>
    fp.texts.find((t) => t.kind === 'user' && t.layer === 'F.Fab')!.text;

  it('leaves the literal alone on the library load path', () => {
    expect(fabText(readFootprintFile(parse(WITH_VAR))!)).toBe('${REFERENCE}');
  });

  it('substitutes it on a board, where ResolveTextVar answers', () => {
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "t")
  (layers (0 "F.Cu" signal) (35 "F.Fab" user))
  (net 0 "")
  ${WITH_VAR.replace('(property "Reference" "REF**"', '(property "Reference" "D7"')})`),
    );

    expect(fabText(board.footprints[0]!)).toBe('D7');
  });
});
