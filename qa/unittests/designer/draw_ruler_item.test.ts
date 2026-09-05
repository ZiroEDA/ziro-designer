// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RULER_ITEM::ViewDraw`, once, for all three canvases that put the tool up.
 *
 * `ACTIONS::measureTool` is registered by `PCB_VIEWER_TOOLS` (pcbnew, the
 * footprint editor and viewer, CVPCB's DISPLAY_FOOTPRINTS_FRAME), by `EE_TOOLS`
 * in eeschema and by gerbview, and every one of them puts up the same
 * `KIGFX::PREVIEW::RULER_ITEM`. We had three drawings of it and only one was
 * the item: the footprint editor's. pcbnew stroked a `rgba(120,230,255)` line
 * with a 6px end tick and one invented `dist (dx dy)` string; GerbView a
 * dashed line with a dot at each end and no readout at all. Neither had a
 * graduation, and neither had Shift's 45 degree snap.
 *
 * The arithmetic already lived in `ui/ruler_item.ts`; the painting now does
 * too, which is what makes "three canvases, one ruler" checkable.
 */
import { readFileSync } from 'node:fs';
import { toolCursorCss } from '@ziroeda/designer/src/ui/tool_cursors.js';
import { boardToolCursor } from '@ziroeda/designer/src/editors/pcb/cursors.js';
import { footprintToolCursor } from '@ziroeda/designer/src/editors/footprint/cursors.js';
import { gerberToolCursor } from '@ziroeda/designer/src/editors/gerbview/cursors.js';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  drawRulerItem,
  rulerDimensionStrings,
  rulerLineWidthPx,
  type RulerDrawOptions,
} from '@ziroeda/designer/src/ui/ruler_item.js';

interface Call {
  op: string;
  args?: unknown[];
  value?: unknown;
}

/** A 2D context stand-in recording every method call and property set. */
function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => {
          calls.push({ op: String(prop), args });
          // `cssSizeForGlyphHeight` measures the face's cap height; with no
          // real text engine it falls back to its stated 0.72 ratio.
          return {};
        };
      },
      set(_t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, value });
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

const PCB_IU_PER_MM = 1e6;

/** A ruler 10mm to the right, on a plain 1:1 Y-down canvas. */
function opts(over: Partial<RulerDrawOptions> = {}): RulerDrawOptions {
  const scale = 0.00002; // device px per IU
  return {
    origin: { x: 0, y: 0 },
    end: { x: 10 * PCB_IU_PER_MM, y: 0 },
    toPx: (p) => ({ x: p.x * scale + 100, y: p.y * scale + 100 }),
    worldScale: scale,
    iuPerMm: PCB_IU_PER_MM,
    units: 'mm',
    color: 'rgb(255, 255, 255)',
    devicePixelRatio: 1,
    canvasWidth: 800,
    canvasHeight: 600,
    ...over,
  };
}

const setsOf = (c: Call[], prop: string): unknown[] =>
  c.filter((x) => x.op === `set:${prop}`).map((x) => x.value);
const argsOf = (c: Call[], op: string): unknown[][] =>
  c.filter((x) => x.op === op).map((x) => x.args ?? []);

describe('drawRulerItem', () => {
  it('strokes in LAYER_AUX_ITEMS, at the ruler line width', () => {
    // The item carries no colour of its own (ruler_item.cpp:320-323), so the
    // caller's theme answers it — and `getTickLineWidth` is StrokeWidth * 0.8,
    // not a hairline. pcbnew wrote `rgba(120,230,255,0.95)` and
    // `Math.max(1, dpr)`.
    const ctx = recorder();
    drawRulerItem(ctx, opts());
    expect(setsOf(ctx.__calls, 'strokeStyle')).toContain('rgb(255, 255, 255)');
    expect(setsOf(ctx.__calls, 'fillStyle')).toContain('rgb(255, 255, 255)');
    expect(setsOf(ctx.__calls, 'lineWidth')[0]).toBeCloseTo(rulerLineWidthPx(1));
  });

  it('draws the four dimension strings, in GetDimensionStrings order', () => {
    // x, y, r, θ — ruler_item.cpp:456. pcbnew drew one line of its own wording.
    const ctx = recorder();
    const o = opts();
    drawRulerItem(ctx, o);
    const want = rulerDimensionStrings(o.origin, o.end, o.iuPerMm, o.units);
    expect(want).toHaveLength(4);
    const filled = argsOf(ctx.__calls, 'fillText').map((a) => a[0]);
    // The graduation labels are filled too, so this is containment in order.
    const idx = want.map((line) => filled.indexOf(line));
    expect(
      idx.every((i) => i >= 0),
      `missing: ${want.join(' | ')}`,
    ).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('graduates the line, and stops when there is nothing to graduate', () => {
    // `drawTicksAlongLine`. A zero-length ruler has no direction, so no ticks
    // and no end ticks — but the readout still stands beside the cursor.
    const many = recorder();
    drawRulerItem(many, opts());
    const none = recorder();
    drawRulerItem(none, opts({ end: { x: 0, y: 0 } }));
    expect(argsOf(many.__calls, 'lineTo').length).toBeGreaterThan(
      argsOf(none.__calls, 'lineTo').length + 5,
    );
    expect(argsOf(none.__calls, 'fillText')).toHaveLength(4);
  });

  it('puts the ticks perpendicular ON SCREEN, not in world space', () => {
    // The world normal and the device normal agree on a Y-down canvas at a
    // positive scale, which is every caller this was first written against.
    // They do not on pcbnew's mirrored board view or on GerbView's Y-up
    // canvas, and a tick perpendicular to the world line but not to the drawn
    // one is just wrong.
    //
    // A DIAGONAL ruler is what separates them: through a Y-flipped transform a
    // world (+x, +y) line is drawn (+x, -y), so the two normals point in
    // different directions. Along an axis they coincide, which is why an
    // axis-aligned case cannot tell the two apart and this one has to be
    // diagonal.
    const ctx = recorder();
    const scale = 0.00002;
    const flipY = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: p.x * scale + 100,
      y: -p.y * scale + 400,
    });
    const origin = { x: 0, y: 0 };
    const end = { x: 10 * PCB_IU_PER_MM, y: 10 * PCB_IU_PER_MM };
    drawRulerItem(ctx, opts({ origin, end, toPx: flipY }));

    // The line as DRAWN, which is what a tick has to be square to.
    const a = flipY(origin);
    const b = flipY(end);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;

    // Every graduation is a moveTo(foot) then lineTo(foot + normal * length).
    const calls = ctx.__calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo');
    let checked = 0;
    for (let i = 0; i + 1 < calls.length; i++) {
      if (calls[i]!.op !== 'moveTo' || calls[i + 1]!.op !== 'lineTo') continue;
      const [mx, my] = calls[i]!.args as [number, number];
      const [lx, ly] = calls[i + 1]!.args as [number, number];
      const vx = lx - mx;
      const vy = ly - my;
      const vlen = Math.hypot(vx, vy);
      // The ruler's own line is the one segment that runs ALONG the direction.
      if (vlen < 1e-9 || Math.abs((vx * ux + vy * uy) / vlen) > 0.99) continue;
      expect(
        Math.abs((vx * ux + vy * uy) / vlen),
        `a tick ${vx.toFixed(2)},${vy.toFixed(2)} is not square to the drawn line`,
      ).toBeLessThan(1e-9);
      checked++;
    }
    expect(checked, 'no ticks were drawn to check').toBeGreaterThan(3);
  });
});

describe('one ruler, three canvases', () => {
  const CANVASES = [
    'editors/pcb/PcbEditor.tsx',
    'editors/footprint/FootprintCanvas.tsx',
    'editors/gerbview/GerberCanvas.tsx',
  ];

  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

  it.each(CANVASES)('%s paints the ruler through the shared item', (rel) => {
    expect(read(rel)).toContain('drawRulerItem');
  });

  it('and none of them re-derives the readout or the graduations', () => {
    // Per occurrence, across the whole tree: the moment a canvas writes its own
    // label block or its own tick loop it has to call one of these, and the
    // only file allowed to is the item itself.
    for (const rel of CANVASES) {
      const src = read(rel);
      expect(src, `${rel} builds its own dimension strings`).not.toContain('rulerDimensionStrings');
      expect(src, `${rel} builds its own graduations`).not.toContain('rulerTicks');
    }
  });

  it('every frame KiCad gives the tool to has a button that arms it', () => {
    // `measureTool` appears in pcbnew's, the footprint editor's and the
    // footprint viewer's toolbars and in gerbview's — and nowhere in eeschema
    // or pl_editor, which is why those two are absent here.
    //
    // The id is the ACTION's name, because that is what each canvas arms its
    // ruler on. The footprint editor called it `measure`: the button lit, the
    // canvas heard nothing, and the only ruler in that frame was the viewer's.
    const bars: [string, string][] = [
      ['editors/pcb/pcbToolbars.ts', 'PCB_RIGHT'],
      ['editors/footprint/footprintToolbars.ts', 'FP_RIGHT'],
      ['editors/schematic/display_footprints_toolbars.ts', 'viewer'],
      ['editors/gerbview/gerberToolbars.ts', 'GBR_LEFT'],
    ];
    for (const [rel, what] of bars) {
      expect(read(rel), `${what} has no measure button`).toMatch(/measureTool|'measure'/);
    }
    // …and the three PCB-side ones spell it the action's way.
    for (const rel of bars.slice(0, 3).map(([r]) => r)) {
      expect(read(rel), `${rel} still uses a name of its own`).toContain("id: 'measureTool'");
    }
  });

  it('one action, one bitmap key — not three', () => {
    // `ACTIONS::measureTool` is one action with one `BITMAPS::measurement`.
    // We had `measure`, `measureTool` and `gerbMeasure` in front of it, and
    // the alias is what let the footprint editor's button drift off the name
    // its own canvas listens for.
    const bitmaps = read('ui/toolbar_bitmaps.ts');
    const keys = [...bitmaps.matchAll(/^ {2}(\w+): 'measurement',/gm)].map((m) => m[1]);
    expect(keys).toEqual(['measureTool']);
  });

  it('the ruler is graduated in the frame’s units, in every frame', () => {
    // `RULER_ITEM` is built with `frame()->GetUserUnits()`. The footprint
    // viewer passed this and the editor did not, so the same canvas measured
    // in mm there whatever its Units radio said.
    for (const rel of [
      'editors/footprint/FootprintEditor.tsx',
      'editors/schematic/dialogs/display_footprints_frame.tsx',
      'editors/gerbview/GerberViewer.tsx',
    ]) {
      expect(read(rel), `${rel} does not hand the canvas its units`).toContain('measureUnits=');
    }
  });

  it('the measure tool wears KiCad’s own cursor in each of them', () => {
    // `PCB_VIEWER_TOOLS::MeasureTool` sets KICURSOR::MEASURE
    // (pcb_viewer_tools.cpp:292), through the one CURSOR_STORE. pcbnew showed
    // the plain arrow and GerbView the browser's `crosshair`.
    //
    // Called, not grepped. This read each canvas's SOURCE for
    // `kiCursor('MEASURE')`, and went red the moment the three ternaries were
    // replaced by the shared table in `ui/tool_cursors.ts` — the answer was
    // still right and the check could not see it. That is CLAUDE.md's
    // "file-level check where the rule is per-occurrence", from the other
    // side: it pinned the implementation rather than the behaviour.
    const MEASURE = toolCursorCss('measureTool', 'never');

    expect(MEASURE).not.toBe('never');

    for (const [name, cursorFor, tool] of [
      ['the board editor', boardToolCursor, 'measureTool'],
      ['the footprint editor', footprintToolCursor, 'measureTool'],
      ['GerbView', gerberToolCursor, 'measure'],
    ] as const) {
      expect(cursorFor(tool), `${name} does not set the measure cursor`).toBe(MEASURE);
    }
  });
});
