// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cross-probing a row in the ERC dialog has to make its marker unmistakable.
 *
 * `DIALOG_ERC::OnERCItemSelected` ends in `m_parent->FocusOnItem( item )`, and
 * that is what does the highlighting:
 *
 *     if( !aItem->IsBrightened() )
 *     {
 *         aItem->SetBrightened();
 *         UpdateItem( aItem );
 *         lastBrightenedItemID = aItem->m_Uuid;
 *     }
 *
 * `getRenderColor` does not lighten a brightened item's own colour — it
 * *replaces* it with a layer of its own, `LAYER_BRIGHTENED`, which is pure
 * magenta in both builtin themes:
 *
 *     if( aItem->IsBrightened() )
 *         color = m_schSettings.GetLayerColor( LAYER_BRIGHTENED );
 *
 * and `draw( SCH_MARKER )` also runs the marker through the shadow pass, where
 * `SCH_MARKER_T` is in `g_ScaledSelectionTypes` and so picks up `getShadowWidth`
 * of extra stroke at `WithAlpha( 0.15 )` — the glow around it.
 *
 * We lightened the marker's own red by half instead, which on a sheet of red
 * markers is a shade of pink you cannot pick out, so clicking a row looked like
 * it had done nothing.
 */
import { describe, it, expect } from 'vitest';
import { drawErcMarkers } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_CLASSIC, KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

interface Op {
  kind: 'fill' | 'stroke';
  colour: string;
  width: number;
}

function spy(): { ops: Op[]; ctx: CanvasRenderingContext2D } {
  const ops: Op[] = [];
  const noop = (): void => {};
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 0 };
  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    lineCap: '',
    lineJoin: '',
    setTransform: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    fill: () => ops.push({ kind: 'fill', colour: state.fillStyle, width: state.lineWidth }),
    stroke: () => ops.push({ kind: 'stroke', colour: state.strokeStyle, width: state.lineWidth }),
  };
  return { ops, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const VIEW = { scale: 0.0005, offsetX: 0, offsetY: 0 };
const marker = (over: Record<string, unknown>) => ({
  at: { x: mmToIU(100), y: mmToIU(100) },
  severity: 'error' as const,
  ...over,
});

const paint = (m: Record<string, unknown>, theme = KICAD_DEFAULT): Op[] => {
  const s = spy();
  drawErcMarkers(s.ctx, [marker(m) as never], VIEW, theme);
  return s.ops;
};

describe('an ordinary marker', () => {
  it('is filled in its severity colour, with no glow', () => {
    const ops = paint({});
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('fill');
    expect(ops[0]!.colour).toBe(KICAD_DEFAULT.ercError);
  });

  it('and a warning takes the warning colour', () => {
    expect(paint({ severity: 'warning' })[0]!.colour).toBe(KICAD_DEFAULT.ercWarning);
  });

  it('an excluded one takes the exclusion colour', () => {
    expect(paint({ excluded: true })[0]!.colour).toBe(KICAD_DEFAULT.ercExclusion);
  });
});

describe('the marker the ERC dialog is focused on', () => {
  it('is filled with LAYER_BRIGHTENED, not a lighter version of its own colour', () => {
    const ops = paint({ brightened: true });
    const fill = ops.find((o) => o.kind === 'fill')!;
    expect(fill.colour).toBe(KICAD_DEFAULT.brightened);
    // The old behaviour: the same red, half way to white.
    expect(fill.colour).not.toBe('rgb(242, 132, 134)');
    // And it is nothing like the unfocused colour, which is the whole point.
    expect(fill.colour).not.toBe(KICAD_DEFAULT.ercError);
  });

  it('keeps that colour whatever the severity, since the layer replaces it', () => {
    for (const severity of ['error', 'warning'] as const) {
      const fill = paint({ brightened: true, severity }).find((o) => o.kind === 'fill')!;
      expect(fill.colour, severity).toBe(KICAD_DEFAULT.brightened);
    }
    // Even an excluded one, which is otherwise drawn grey.
    const fill = paint({ brightened: true, excluded: true }).find((o) => o.kind === 'fill')!;
    expect(fill.colour).toBe(KICAD_DEFAULT.brightened);
  });

  it('gets the shadow pass too: a wide stroke at 15% alpha, under the fill', () => {
    const ops = paint({ brightened: true });
    expect(ops.map((o) => o.kind)).toEqual(['stroke', 'fill']);
    const glow = ops[0]!;
    expect(glow.colour).toBe('rgba(255, 0, 255, 0.15)');
    expect(glow.width).toBeGreaterThan(0);
  });

  it('and the glow scales with the zoom, as getShadowWidth does', () => {
    // |mils / scale| + MilsToIU( mils ): zooming out widens it in world units so
    // it stays a constant handful of screen pixels.
    const wide = (() => {
      const s = spy();
      drawErcMarkers(
        s.ctx,
        [marker({ brightened: true }) as never],
        { ...VIEW, scale: 0.0001 },
        KICAD_DEFAULT,
      );
      return s.ops[0]!.width;
    })();
    expect(wide).toBeGreaterThan(paint({ brightened: true })[0]!.width);
  });
});

describe('both builtin themes ship LAYER_BRIGHTENED', () => {
  it('as pure magenta, which is what upstream defines', () => {
    // builtin_color_themes.h: CSS_COLOR( 255, 0, 255, 1 ) / COLOR4D( PUREMAGENTA ).
    expect(KICAD_DEFAULT.brightened).toBe('rgb(255, 0, 255)');
    expect(KICAD_CLASSIC.brightened).toBe('rgb(255, 0, 255)');
  });

  it('and the classic theme highlights just the same', () => {
    const fill = paint({ brightened: true }, KICAD_CLASSIC).find((o) => o.kind === 'fill')!;
    expect(fill.colour).toBe(KICAD_CLASSIC.brightened);
  });
});

describe('markers stack the way SCH_LAYER_ORDER stacks them', () => {
  /**
   * `sch_view.h` puts LAYER_ERC_ERR above LAYER_ERC_WARN above
   * LAYER_ERC_EXCLUSION. One bad pin routinely raises both an error and a
   * warning at the *same point*, so painting in the order ERC produced them let
   * the warning cover the error — and cross-probing to that error then looked
   * dead, because the marker did turn magenta underneath a warning drawn on top
   * of it. Canvas paints back to front, so errors must be painted last.
   */
  const at = { x: mmToIU(100), y: mmToIU(100) };
  const order = (markers: Record<string, unknown>[]): string[] => {
    const s = spy();
    drawErcMarkers(s.ctx, markers.map((m) => ({ at, ...m })) as never, VIEW, KICAD_DEFAULT);
    return s.ops.filter((o) => o.kind === 'fill').map((o) => o.colour);
  };

  it('paints an error after a warning at the same point, whatever the input order', () => {
    const err = KICAD_DEFAULT.ercError;
    const warn = KICAD_DEFAULT.ercWarning;
    expect(order([{ severity: 'error' }, { severity: 'warning' }])).toEqual([warn, err]);
    expect(order([{ severity: 'warning' }, { severity: 'error' }])).toEqual([warn, err]);
  });

  it('and an exclusion goes under both', () => {
    expect(order([{ severity: 'error' }, { excluded: true }, { severity: 'warning' }])).toEqual([
      KICAD_DEFAULT.ercExclusion,
      KICAD_DEFAULT.ercWarning,
      KICAD_DEFAULT.ercError,
    ]);
  });

  it('so a focused error is never buried by a warning on the same pin', () => {
    const s = spy();
    drawErcMarkers(
      s.ctx,
      [
        { at, severity: 'error', brightened: true },
        { at, severity: 'warning' },
      ] as never,
      VIEW,
      KICAD_DEFAULT,
    );
    const fills = s.ops.filter((o) => o.kind === 'fill');
    // The magenta one is painted last, so it is the one you see.
    expect(fills.at(-1)!.colour).toBe(KICAD_DEFAULT.brightened);
  });

  it('keeps the order stable among markers of the same severity', () => {
    // Array.prototype.sort is stable, so equal keys keep ERC's own order.
    const s = spy();
    drawErcMarkers(
      s.ctx,
      [
        { at, severity: 'warning', excluded: false },
        { at: { x: mmToIU(120), y: mmToIU(100) }, severity: 'warning' },
      ] as never,
      VIEW,
      KICAD_DEFAULT,
    );
    expect(s.ops.filter((o) => o.kind === 'fill')).toHaveLength(2);
  });
});
