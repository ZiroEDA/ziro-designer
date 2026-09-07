// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PAD::GetSolderMaskExpansion()` / `PAD::GetSolderPasteMargin()`
 * (`pcbnew/pad.cpp:1679-1848`) — the Board Setup > Solder Mask/Paste page
 * reaching a pad's aperture, which is the only place those numbers ever show.
 *
 * The page was the last one in Board Stackup with no consumer at all: the
 * gerber plotter flashed every pad at its COPPER size on F.Mask and F.Paste, so
 * changing the expansion changed nothing that came out of the app.
 *
 * The load-bearing subtlety is `std::optional`: **absent means inherit, zero
 * means zero.** A pad carrying `(solder_mask_margin 0)` is pinned; a pad with
 * no token follows the board. Reading a missing value as 0 would pin every pad
 * on the board while still looking wired.
 */
import { describe, expect, it } from 'vitest';
import {
  padApertureSize,
  solderMaskExpansionFor,
  solderPasteMarginFor,
} from '@ziroeda/pcbnew/src/pad_margins.js';
import type { PcbFootprint, PcbPad } from '@ziroeda/pcbnew/src/types.js';
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { plotGerberLayer } from '@ziroeda/pcbnew/src/plot_gerber.js';

const pad = (over: Partial<PcbPad> = {}): PcbPad =>
  ({
    number: '1',
    type: 'smd',
    shape: 'rect',
    at: { x: 0, y: 0 },
    size: { x: pcbMmToIU(2), y: pcbMmToIU(1) },
    layers: ['F.Cu', 'F.Mask', 'F.Paste'],
    ...over,
  }) as PcbPad;

const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => over as PcbFootprint;

const BOARD = {
  solderMaskExpansion: pcbMmToIU(0.1),
  solderPasteMargin: pcbMmToIU(-0.05),
  solderPasteMarginRatio: -0.02,
};

describe('the three-level fallback', () => {
  it('takes the board value when neither pad nor footprint says anything', () => {
    expect(solderMaskExpansionFor(pad(), fp(), BOARD, 'F.Mask')).toBe(pcbMmToIU(0.1));
  });

  it('lets the footprint override the board', () => {
    expect(
      solderMaskExpansionFor(pad(), fp({ localSolderMaskMargin: pcbMmToIU(0.2) }), BOARD, 'F.Mask'),
    ).toBe(pcbMmToIU(0.2));
  });

  it('lets the pad override the footprint', () => {
    expect(
      solderMaskExpansionFor(
        pad({ localSolderMaskMargin: pcbMmToIU(0.3) }),
        fp({ localSolderMaskMargin: pcbMmToIU(0.2) }),
        BOARD,
        'F.Mask',
      ),
    ).toBe(pcbMmToIU(0.3));
  });

  it('treats an explicit ZERO as a value, not as "inherit"', () => {
    // The whole reason upstream uses std::optional. A pad pinned to 0 must not
    // pick the board's 0.1 back up.
    expect(solderMaskExpansionFor(pad({ localSolderMaskMargin: 0 }), fp(), BOARD, 'F.Mask')).toBe(
      0,
    );
    expect(solderMaskExpansionFor(pad(), fp({ localSolderMaskMargin: 0 }), BOARD, 'F.Mask')).toBe(
      0,
    );
  });
});

describe('which pads and layers get an expansion at all', () => {
  it('gives none to a pad with no copper layer', () => {
    // "Pads defined only on mask layers ... use the shape defined by the pad
    // settings only" (`pad.cpp:1681-1685`).
    const noCopper = pad({ layers: ['F.Mask', 'F.Paste'] });
    expect(solderMaskExpansionFor(noCopper, fp(), BOARD, 'F.Mask')).toBe(0);
    expect(solderPasteMarginFor(noCopper, fp(), BOARD, 'F.Paste')).toEqual({ x: 0, y: 0 });
  });

  it('gives none on a layer that is neither front nor back', () => {
    expect(solderMaskExpansionFor(pad(), fp(), BOARD, 'Edge.Cuts')).toBe(0);
  });

  it('resolves a back layer as well as a front one', () => {
    const back = pad({ layers: ['B.Cu', 'B.Mask', 'B.Paste'] });
    expect(solderMaskExpansionFor(back, fp(), BOARD, 'B.Mask')).toBe(pcbMmToIU(0.1));
  });
});

describe('the negative clamps', () => {
  it('floors a negative mask margin at half the SMALLER pad dimension', () => {
    // `minsize = -min( size.x, size.y ) / 2` — the smaller, so the aperture can
    // never close entirely on either axis (`:1727-1735`).
    const p = pad(); // 2 x 1 mm, so the floor is -0.5 mm
    const huge = { ...BOARD, solderMaskExpansion: pcbMmToIU(-5) };
    expect(solderMaskExpansionFor(p, fp(), huge, 'F.Mask')).toBe(-pcbMmToIU(1) / 2);
  });

  it('leaves a negative margin alone when it is within the floor', () => {
    const small = { ...BOARD, solderMaskExpansion: pcbMmToIU(-0.1) };
    expect(solderMaskExpansionFor(pad(), fp(), small, 'F.Mask')).toBe(pcbMmToIU(-0.1));
  });

  it('clamps paste PER AXIS, at half that axis’ size', () => {
    const p = pad(); // 2 x 1 mm
    const huge = { solderPasteMargin: pcbMmToIU(-5), solderPasteMarginRatio: 0 };
    expect(solderPasteMarginFor(p, fp(), huge, 'F.Paste')).toEqual({
      x: -pcbMmToIU(2) / 2,
      y: -pcbMmToIU(1) / 2,
    });
  });

  it('skips the paste clamp for a custom shape', () => {
    // `if( m_padStack.Shape( aLayer ) != PAD_SHAPE::CUSTOM )` — a custom pad's
    // size is not its aperture, so the clamp would be meaningless.
    const custom = pad({ shape: 'custom' } as Partial<PcbPad>);
    const huge = { solderPasteMargin: pcbMmToIU(-5), solderPasteMarginRatio: 0 };
    expect(solderPasteMarginFor(custom, fp(), huge, 'F.Paste').x).toBe(pcbMmToIU(-5));
  });
});

describe('the paste margin is a vector, not a scalar', () => {
  it('adds the ratio term per axis, from that axis’ size', () => {
    //   pad_margin.x = margin + KiROUND( padSize.x * mratio )
    // A 2 x 1 mm pad at ratio -0.1 gets -0.2 mm on x and -0.1 mm on y.
    const board = { solderPasteMargin: 0, solderPasteMarginRatio: -0.1 };
    expect(solderPasteMarginFor(pad(), fp(), board, 'F.Paste')).toEqual({
      x: Math.round(pcbMmToIU(2) * -0.1),
      y: Math.round(pcbMmToIU(1) * -0.1),
    });
  });

  it('falls back for the absolute and ratio terms INDEPENDENTLY', () => {
    // `:1793-1824` resolves them in two separate chains, so a pad may pin the
    // absolute margin and still inherit the board's ratio.
    const p = pad({ localSolderPasteMargin: pcbMmToIU(0.5) });
    const board = { solderPasteMargin: pcbMmToIU(9), solderPasteMarginRatio: -0.1 };
    expect(solderPasteMarginFor(p, fp(), board, 'F.Paste')).toEqual({
      x: pcbMmToIU(0.5) + Math.round(pcbMmToIU(2) * -0.1),
      y: pcbMmToIU(0.5) + Math.round(pcbMmToIU(1) * -0.1),
    });
  });
});

describe('padApertureSize — what actually gets flashed', () => {
  it('grows a mask aperture by twice the expansion', () => {
    // The margin is per side.
    expect(padApertureSize(pad(), fp(), BOARD, 'F.Mask')).toEqual({
      x: pcbMmToIU(2) + 2 * pcbMmToIU(0.1),
      y: pcbMmToIU(1) + 2 * pcbMmToIU(0.1),
    });
  });

  it('shrinks a paste aperture by twice the (negative) margin', () => {
    const m = solderPasteMarginFor(pad(), fp(), BOARD, 'F.Paste');
    expect(padApertureSize(pad(), fp(), BOARD, 'F.Paste')).toEqual({
      x: pcbMmToIU(2) + 2 * m.x,
      y: pcbMmToIU(1) + 2 * m.y,
    });
  });

  it('leaves a copper layer at the pad’s own size', () => {
    expect(padApertureSize(pad(), fp(), BOARD, 'F.Cu')).toEqual({
      x: pcbMmToIU(2),
      y: pcbMmToIU(1),
    });
  });
});

describe('end to end: the page changes the exported gerber', () => {
  // A 2 x 1 mm SMD pad on F.Cu / F.Mask / F.Paste, plotted per layer.
  const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (13 "F.Paste" user))
  (setup)
  (net 0 "")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu" "F.Mask" "F.Paste"))
  )
)`;

  const plot = (layer: string, maskPaste?: object): string =>
    plotGerberLayer(readBoard(parse(BOARD_TEXT)), layer, { creationDate: 'x', maskPaste });

  /** The R aperture the pad flashes with, e.g. "R,2.100000X1.100000". */
  const rectAperture = (gerber: string): string =>
    /%ADD\d+R,([\d.]+X[\d.]+)\*%/.exec(gerber)?.[1] ?? 'none';

  it('flashes the bare copper size with no board settings', () => {
    expect(rectAperture(plot('F.Mask'))).toBe(rectAperture(plot('F.Cu')));
  });

  it('grows the F.Mask aperture by the page’s expansion', () => {
    // 0.1 mm per side on a 2 x 1 mm pad -> 2.2 x 1.2 mm.
    const g = plot('F.Mask', { solderMaskExpansion: pcbMmToIU(0.1) });
    expect(rectAperture(g)).toBe('2.200000X1.200000');
    // and the copper layer is untouched by it.
    expect(rectAperture(plot('F.Cu', { solderMaskExpansion: pcbMmToIU(0.1) }))).toBe(
      '2.000000X1.000000',
    );
  });

  it('shrinks the F.Paste aperture by the page’s clearance and ratio', () => {
    // -0.05 mm absolute plus -10% of each axis: x = 2 - 2*(0.05 + 0.2) = 1.5,
    // y = 1 - 2*(0.05 + 0.1) = 0.7.
    const g = plot('F.Paste', {
      solderPasteMargin: pcbMmToIU(-0.05),
      solderPasteMarginRatio: -0.1,
    });
    expect(rectAperture(g)).toBe('1.500000X0.700000');
  });

  it('does not touch the paste layer with a mask-only setting', () => {
    expect(rectAperture(plot('F.Paste', { solderMaskExpansion: pcbMmToIU(0.1) }))).toBe(
      '2.000000X1.000000',
    );
  });
});
