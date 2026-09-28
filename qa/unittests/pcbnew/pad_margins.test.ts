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
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';

/** The board's Solder Mask/Paste page (BOARD_DESIGN_SETTINGS). */
interface Page {
  mask?: number;
  paste?: number;
  ratio?: number;
}

const BOARD: Page = { mask: pcbMmToIU(0.1), paste: pcbMmToIU(-0.05), ratio: -0.02 };

/**
 * A 2 x 1 mm rect SMD pad in a footprint on a parsed BOARD. `padTokens` /
 * `fpTokens` carry the local `(solder_mask_margin …)` and friends; the board
 * values are set on BOARD_DESIGN_SETTINGS the way Board Setup writes them.
 */
function pad(
  opts: {
    padTokens?: string;
    fpTokens?: string;
    layers?: string;
    shape?: string;
    page?: Page;
  } = {},
): PAD {
  const shape = opts.shape ?? 'rect';
  const custom =
    shape === 'custom' ? '(options (clearance outline) (anchor rect)) (primitives)' : '';
  const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user)
    (13 "F.Paste" user) (15 "B.Paste" user))
  (setup)
  (net 0 "")
  (footprint "R" (layer "F.Cu") (at 10 10) ${opts.fpTokens ?? ''}
    (pad "1" smd ${shape} (at 0 0) (size 2 1) (layers ${opts.layers ?? '"F.Cu" "F.Mask" "F.Paste"'})
      ${opts.padTokens ?? ''} ${custom})
  )
)`);
  const page = opts.page ?? BOARD;
  const bds = board.GetDesignSettings();
  bds.m_SolderMaskExpansion = page.mask ?? 0;
  bds.m_SolderPasteMargin = page.paste ?? 0;
  bds.m_SolderPasteMarginRatio = page.ratio ?? 0;
  return board.Footprints()[0]!.Pads()[0]!;
}

const mask = (p: PAD, l = PCB_LAYER_ID.F_Mask): number => p.GetSolderMaskExpansion(l);
const paste = (p: PAD, l = PCB_LAYER_ID.F_Paste) => p.GetSolderPasteMargin(l);

describe('the three-level fallback', () => {
  it('takes the board value when neither pad nor footprint says anything', () => {
    expect(mask(pad())).toBe(pcbMmToIU(0.1));
  });

  it('lets the footprint override the board', () => {
    expect(mask(pad({ fpTokens: '(solder_mask_margin 0.2)' }))).toBe(pcbMmToIU(0.2));
  });

  it('lets the pad override the footprint', () => {
    expect(
      mask(pad({ padTokens: '(solder_mask_margin 0.3)', fpTokens: '(solder_mask_margin 0.2)' })),
    ).toBe(pcbMmToIU(0.3));
  });

  it('treats an explicit ZERO as a value, not as "inherit"', () => {
    // The whole reason upstream uses std::optional. A pad pinned to 0 must not
    // pick the board's 0.1 back up.
    expect(mask(pad({ padTokens: '(solder_mask_margin 0)' }))).toBe(0);
    expect(mask(pad({ fpTokens: '(solder_mask_margin 0)' }))).toBe(0);
  });
});

describe('which pads and layers get an expansion at all', () => {
  it('gives none to a pad with no copper layer', () => {
    // "Pads defined only on mask layers ... use the shape defined by the pad
    // settings only" (`pad.cpp:1681-1685`).
    const noCopper = pad({ layers: '"F.Mask" "F.Paste"' });
    expect(mask(noCopper)).toBe(0);
    expect(paste(noCopper)).toEqual({ x: 0, y: 0 });
  });

  it('gives none on a layer that is neither front nor back', () => {
    expect(mask(pad(), PCB_LAYER_ID.Edge_Cuts)).toBe(0);
  });

  it('resolves a back layer as well as a front one', () => {
    const back = pad({ layers: '"B.Cu" "B.Mask" "B.Paste"' });
    expect(mask(back, PCB_LAYER_ID.B_Mask)).toBe(pcbMmToIU(0.1));
  });
});

describe('the negative clamps', () => {
  it('floors a negative mask margin at half the SMALLER pad dimension', () => {
    // `minsize = -min( size.x, size.y ) / 2` — the smaller, so the aperture can
    // never close entirely on either axis (`:1727-1735`). 2 x 1 mm: -0.5 mm.
    expect(mask(pad({ page: { ...BOARD, mask: pcbMmToIU(-5) } }))).toBe(-pcbMmToIU(1) / 2);
  });

  it('leaves a negative margin alone when it is within the floor', () => {
    expect(mask(pad({ page: { ...BOARD, mask: pcbMmToIU(-0.1) } }))).toBe(pcbMmToIU(-0.1));
  });

  it('clamps paste PER AXIS, at half that axis’ size', () => {
    expect(paste(pad({ page: { paste: pcbMmToIU(-5), ratio: 0 } }))).toEqual({
      x: -pcbMmToIU(2) / 2,
      y: -pcbMmToIU(1) / 2,
    });
  });

  it('skips the paste clamp for a custom shape', () => {
    // `if( m_padStack.Shape( aLayer ) != PAD_SHAPE::CUSTOM )` — a custom pad's
    // size is not its aperture, so the clamp would be meaningless.
    const custom = pad({ shape: 'custom', page: { paste: pcbMmToIU(-5), ratio: 0 } });
    expect(paste(custom).x).toBe(pcbMmToIU(-5));
  });
});

describe('the paste margin is a vector, not a scalar', () => {
  it('adds the ratio term per axis, from that axis’ size', () => {
    //   pad_margin.x = margin + KiROUND( padSize.x * mratio )
    // A 2 x 1 mm pad at ratio -0.1 gets -0.2 mm on x and -0.1 mm on y.
    expect(paste(pad({ page: { paste: 0, ratio: -0.1 } }))).toEqual({
      x: Math.round(pcbMmToIU(2) * -0.1),
      y: Math.round(pcbMmToIU(1) * -0.1),
    });
  });

  it('falls back for the absolute and ratio terms INDEPENDENTLY', () => {
    // `:1793-1824` resolves them in two separate chains, so a pad may pin the
    // absolute margin and still inherit the board's ratio.
    const p = pad({
      padTokens: '(solder_paste_margin 0.5)',
      page: { paste: pcbMmToIU(9), ratio: -0.1 },
    });
    expect(paste(p)).toEqual({
      x: pcbMmToIU(0.5) + Math.round(pcbMmToIU(2) * -0.1),
      y: pcbMmToIU(0.5) + Math.round(pcbMmToIU(1) * -0.1),
    });
  });
});

describe('end to end: the page changes the exported gerber', () => {
  // A 2 x 1 mm SMD pad on F.Cu / F.Mask / F.Paste, plotted per layer through
  // PCB_PLOTTER -> PlotStandardLayer -> GERBER_PLOTTER. Board Setup writes the
  // page into the board's BOARD_DESIGN_SETTINGS, which is where the pads read it.
  const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (13 "F.Paste" user))
  (setup)
  (net 0 "")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu" "F.Mask" "F.Paste"))
  )
)`;

  interface Page {
    solderMaskExpansion?: number;
    solderPasteMargin?: number;
    solderPasteMarginRatio?: number;
  }

  const plot = (layer: PCB_LAYER_ID, page: Page = {}): string => {
    const board = ParseBoard(BOARD_TEXT);
    const bds = board.GetDesignSettings();
    bds.m_SolderMaskExpansion = page.solderMaskExpansion ?? 0;
    bds.m_SolderPasteMargin = page.solderPasteMargin ?? 0;
    bds.m_SolderPasteMarginRatio = page.solderPasteMarginRatio ?? 0;

    const params = new PCB_PLOT_PARAMS();
    params.SetFormat(PLOT_FORMAT.GERBER);
    params.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);

    let text = '';
    new PCB_PLOTTER(board, null, params).Plot('', [layer], [], false, (path, bytes) => {
      // PCB_PLOTTER::Plot writes the Gerber job file after the layer.
      if (!path.endsWith('.gbrjob')) text = new TextDecoder().decode(bytes);
    });
    return text;
  };

  /** The aperture the pad flashes with, e.g. "R,2.100000X1.100000". */
  const aperture = (gerber: string): string => /%ADD10(.*)\*%/.exec(gerber)?.[1] ?? 'none';

  it('flashes the bare copper size with no board settings', () => {
    expect(aperture(plot(PCB_LAYER_ID.F_Mask))).toBe(aperture(plot(PCB_LAYER_ID.F_Cu)));
    expect(aperture(plot(PCB_LAYER_ID.F_Cu))).toBe('R,2.000000X1.000000');
  });

  it('grows the F.Mask aperture by the page’s expansion, as a rounded rect', () => {
    // kicad-cli, `(pad_to_mask_clearance 0.1)`: PlotStandardLayer turns a rect
    // with a positive margin into a ROUNDRECT of radius = margin, so 0.1 mm per
    // side on a 2 x 1 mm pad is a 2.2 x 1.2 mm body with 0.1 mm corners -- the
    // RoundRect macro's corner centres at +-1.0, +-0.5.
    const g = plot(PCB_LAYER_ID.F_Mask, { solderMaskExpansion: pcbMmToIU(0.1) });
    expect(aperture(g)).toBe(
      'RoundRect,0.100000X-1.000000X-0.500000X1.000000X-0.500000X1.000000X0.500000X-1.000000X0.500000X0',
    );
    // and the copper layer is untouched by it.
    expect(aperture(plot(PCB_LAYER_ID.F_Cu, { solderMaskExpansion: pcbMmToIU(0.1) }))).toBe(
      'R,2.000000X1.000000',
    );
  });

  it('shrinks the F.Paste aperture by the page’s clearance and ratio', () => {
    // -0.05 mm absolute plus -10% of each axis: x = 2 - 2*(0.05 + 0.2) = 1.5,
    // y = 1 - 2*(0.05 + 0.1) = 0.7 (kicad-cli writes R,1.500000X0.700000).
    const g = plot(PCB_LAYER_ID.F_Paste, {
      solderPasteMargin: pcbMmToIU(-0.05),
      solderPasteMarginRatio: -0.1,
    });
    expect(aperture(g)).toBe('R,1.500000X0.700000');
  });

  it('does not touch the paste layer with a mask-only setting', () => {
    expect(aperture(plot(PCB_LAYER_ID.F_Paste, { solderMaskExpansion: pcbMmToIU(0.1) }))).toBe(
      'R,2.000000X1.000000',
    );
  });
});
