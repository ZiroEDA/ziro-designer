// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BitmapText`: the glyph atlas that draws pad numbers and net names.
 *
 * KiCad draws board text two ways. Silkscreen, fab and dimension text is
 * stroked from the Newstroke font and thickens with the pen the painter sets.
 * Pad numbers, pad net names, via descriptions and track net names go through
 * `m_gal->BitmapText()`, which on the OpenGL GAL samples a signed distance
 * field and ignores `SetLineWidth` and `SetFontBold` completely. Stroking that
 * second group — which is what we did before the atlas existed — draws it at
 * roughly twice pcbnew's weight, and a ground pad reads as a white blob.
 *
 * These pin the layout against `opengl_gal.cpp` and check that the board's
 * net-name pass actually reaches it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  bitmapTextSize,
  glyphIndex,
  layoutBitmapText,
} from '@ziroeda/designer/src/render/gl/bitmap_text.js';
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  FIRST_CODEPOINT,
  GLYPHS,
  GLYPH_STRIDE,
  LAST_CODEPOINT,
} from '@ziroeda/designer/src/render/gl/bitmap_font.js';
import { buildScene, drawNetNames } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { GlRecorder } from '@ziroeda/designer/src/render/gl/recorder.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';

const MM = 1e6;

/** Every quad `layoutBitmapText` emits, as loose numbers. */
const quads = (text: string, glyphSize: number, angle = 0): number[][] => {
  const out: number[][] = [];
  layoutBitmapText(text, { x: 0, y: 0, angle, glyphSize }, (...a) => out.push([...a]));
  return out;
};

describe('the generated atlas covers what a net name can be spelled with', () => {
  it('holds every printable ASCII glyph and no gaps', () => {
    expect(FIRST_CODEPOINT).toBe(33);
    expect(LAST_CODEPOINT).toBe(126);
    expect(GLYPHS.length / GLYPH_STRIDE).toBe(LAST_CODEPOINT - FIRST_CODEPOINT + 1);
    // Every glyph has to sit inside the sheet, or the repack lost one.
    for (let cp = FIRST_CODEPOINT; cp <= LAST_CODEPOINT; cp++) {
      const i = glyphIndex(cp);
      expect(
        GLYPHS[i]! + GLYPHS[i + 2]!,
        `U+${cp.toString(16)} runs off the right`,
      ).toBeLessThanOrEqual(ATLAS_WIDTH);
      expect(
        GLYPHS[i + 1]! + GLYPHS[i + 3]!,
        `U+${cp.toString(16)} runs off the bottom`,
      ).toBeLessThanOrEqual(ATLAS_HEIGHT);
      expect(GLYPHS[i + 7], `U+${cp.toString(16)} has no advance`).toBeGreaterThan(0);
    }
  });

  it('substitutes ? for anything it does not have, as drawBitmapChar does', () => {
    // "If the glyph is not found (happens for many esoteric unicode chars)
    // shows a '?' instead."
    expect(glyphIndex('中'.codePointAt(0)!)).toBe(glyphIndex('?'.codePointAt(0)!));
    expect(glyphIndex(0x00e9)).toBe(glyphIndex('?'.codePointAt(0)!));
    expect(glyphIndex('A'.codePointAt(0)!)).not.toBe(glyphIndex('?'.codePointAt(0)!));
  });
});

describe('computeBitmapTextSize', () => {
  it('gives every string the same height, so a row of labels shares a baseline', () => {
    // The C++ takes the height from the *default* glyph, never from the string:
    // charHeight = font_information.max_y - defaultGlyph->miny.
    const one = bitmapTextSize('1').height;
    expect(bitmapTextSize('Ag').height).toBe(one);
    expect(bitmapTextSize('VCC').height).toBe(one);
    expect(bitmapTextSize('.').height).toBe(one);
    expect(one).toBeCloseTo(41.664, 3);
  });

  it('measures - and _ as the default glyph, which is what via layer pairs need', () => {
    // "Strange size of these 2 chars" — the C++ swaps in defaultGlyph for both,
    // and "1-4" is a via description.
    expect(bitmapTextSize('-')).toEqual(bitmapTextSize('('));
    expect(bitmapTextSize('_')).toEqual(bitmapTextSize('('));
    expect(bitmapTextSize('1-4').width).toBe(3 * bitmapTextSize('(').width);
  });
});

describe('drawBitmapChar', () => {
  it('makes the text exactly 1.4 glyph sizes tall, centred on the anchor', () => {
    // SCALE = 1.4 * GetGlyphSize().y / textSize.y is chosen to make this so,
    // and it is what lets the atlas be repacked without changing anything on
    // screen: the size comes from the metrics, not from the texel count.
    const [q] = quads('(', 1000);
    expect(q![7]).toBeCloseTo(700, 6); // bottom of the block
    expect(q![5]! - q![1]!).toBeCloseTo(q![7]! - q![3]!, 6); // both sides equal height
    // Twice the glyph size is twice the box.
    const [big] = quads('(', 2000);
    expect(big![7]).toBeCloseTo(1400, 6);
  });

  it('centres the advance box on the anchor, not the ink', () => {
    // `Translate( -textSize.x / 2, 0 )` where textSize.x is the sum of the
    // advances. The ink is *not* symmetric about that — a glyph starts at its
    // own `minx` and is narrower than its advance — so measuring the drawn
    // extent and expecting zero finds a difference that is in the C++ too.
    const size = bitmapTextSize('AB');
    const scale = (1.4 * 1000) / size.height;
    const q = quads('AB', 1000);
    const firstMinX = GLYPHS[glyphIndex('A'.codePointAt(0)!) + 4]!;
    expect(q[0]![0]).toBeCloseTo((firstMinX - size.width / 2) * scale, 6);
    // And the pen ends where the advances say, half a width past the anchor.
    const lastAdvance = GLYPHS[glyphIndex('B'.codePointAt(0)!) + 7]!;
    const lastMinX = GLYPHS[glyphIndex('B'.codePointAt(0)!) + 4]!;
    const penEnd = size.width - lastAdvance + lastMinX - size.width / 2;
    expect(q[1]![0]).toBeCloseTo(penEnd * scale, 6);
  });

  it('advances a space by 0.74 of an x, not by a glyph', () => {
    // "Match stroke font as well as possible": a space is not in the atlas, so
    // drawBitmapChar walks the pen by 0.74 * LookupGlyph('x')->advance.
    const withSpace = quads('A B', 1000);
    const without = quads('AB', 1000);
    expect(withSpace).toHaveLength(2); // the space emits nothing
    const gap = (q: number[][]): number => q[1]![0]! - q[0]![0]!;
    const xAdvance = GLYPHS[glyphIndex('x'.codePointAt(0)!) + 7]!;
    const scale = (1.4 * 1000) / bitmapTextSize('A B').height;
    expect(gap(withSpace) - gap(without)).toBeCloseTo(xAdvance * 0.74 * scale, 3);
  });

  it('rotates about -Z, as the GAL does', () => {
    // Rotate( aAngle.AsRadians(), 0.0f, 0.0f, -1.0f ) — a positive EDA_ANGLE
    // turns the opposite way from the usual 2D convention, which is what keeps
    // a track name reading along its trace rather than mirrored across it.
    const flat = quads('A', 1000)[0]!;
    const turned = quads('A', 1000, 90)[0]!;
    expect(turned[0]).toBeCloseTo(flat[1]!, 3);
    expect(turned[1]).toBeCloseTo(-flat[0]!, 3);
  });

  it('keeps every texture coordinate inside the sheet', () => {
    for (const [, , , , , , , , u0, v0, u1, v1] of quads('The quick brown fox 0123456789', 1000)) {
      for (const t of [u0, v0, u1, v1]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });
});

const padBoard = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (footprint "R"
    (layer "F.Cu")
    (at 100 100)
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "VCC")))
)`),
  );

describe('the net-name pass draws from the atlas when the target has one', () => {
  const scene = buildScene(padBoard(), {}, GL_PATH_FACTORY);
  // 40 px/mm: the 2 mm pad is 80 px, well past PAD::ViewGetLOD's 0.5 mm.
  const view = { scale: 40 / MM, tx: 400 - 100 * MM * (40 / MM), ty: 300 - 100 * MM * (40 / MM) };
  const record = (): Scene => {
    const s = new Scene(true);
    // Exactly how `PcbGl.perFrame` sets one up: the buffer holds world units
    // and the device applies the view.
    const rec = new GlRecorder(s, {
      referenceScale: view.scale,
      worldScale: view.scale,
      devicePixelRatio: 1,
      hairlines: 'solid',
    });
    drawNetNames(
      rec as unknown as CanvasRenderingContext2D,
      scene,
      view,
      new Set(['F.Cu']),
      800,
      600,
    );
    return s;
  };

  it('emits glyph quads rather than stroke-font segments', () => {
    const s = record();
    // "1" and "VCC": four characters, six vertices each.
    expect(s.glyphVertexCount).toBe(4 * 6);
    // And nothing stroked. A stroked pad label is the old behaviour and the
    // reason these read at twice pcbnew's weight — the painter sets a pen of a
    // sixth of the glyph height, in bold, which the atlas simply ignores.
    expect(s.segmentCount).toBe(0);
  });

  it('records the glyphs as one run, so one depth covers the whole pass', () => {
    // Every glyph of a pass shares a layer depth, which is what makes the
    // depth test reject the second label to reach a pixel instead of adding it
    // to the first. Split across runs it would still work, but a single run is
    // also one draw call for the whole pass.
    const s = record();
    expect(s.runs.filter((r) => r.kind === 'glyph')).toHaveLength(1);
    expect(s.runs.every((r) => r.kind === 'glyph')).toBe(true);
  });

  it('records world coordinates, on the pad', () => {
    // The pass is recorded through the view scale but must come out in world
    // units, because the device applies the view again at draw time. Getting
    // this wrong does not misplace the text a little: the first version
    // un-shifted by the origin `recordBoardScene` uses, which put every glyph
    // about two billion units away and drew a blank board.
    const s = record();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < s.glyphVertexCount; i++) {
      xs.push(s.glyphs.view()[i * 8]!);
      ys.push(s.glyphs.view()[i * 8 + 1]!);
    }
    // The pad is 2 mm square at (100, 100) mm; both labels live inside it.
    expect(Math.min(...xs)).toBeGreaterThan(99 * MM);
    expect(Math.max(...xs)).toBeLessThan(101 * MM);
    expect(Math.min(...ys)).toBeGreaterThan(99 * MM);
    expect(Math.max(...ys)).toBeLessThan(101 * MM);
  });

  it('falls back to stroking on a target with no atlas', () => {
    // A plain 2D context — printing, exports, and the Canvas2D board — has no
    // shader to decode a distance field with, so it keeps the stroke font and
    // the compensation `GAL::BitmapText` applies when it does the same.
    let strokes = 0;
    const ctx = {
      setTransform: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {
        strokes++;
      },
      fill: () => {},
      lineCap: '',
      lineJoin: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const realPath2D = globalThis.Path2D;
    (globalThis as { Path2D?: unknown }).Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    };
    try {
      drawNetNames(ctx, scene, view, new Set(['F.Cu']), 800, 600);
    } finally {
      (globalThis as { Path2D?: unknown }).Path2D = realPath2D;
    }
    expect(strokes).toBeGreaterThan(0);
  });
});
