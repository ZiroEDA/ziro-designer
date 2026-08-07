// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board renderer: PCB_PAINTER (pcbnew/pcb_painter.cpp) ported to Canvas 2D.
 *
 * The whole board is compiled once into retained per-layer Path2D buckets,
 * split by object class exactly like pcbnew's Appearance>Objects rows
 * (appearance_controls.cpp s_objectSettings): tracks, vias, pads, zones,
 * graphics and the three footprint-text classes. Every frame just sets the
 * view transform and replays the buckets in GAL_LAYER_ORDER
 * (pcb_draw_panel_gal.cpp), honoring per-object visibility and opacity
 * (project_local_settings.cpp defaults: zones 0.6, images 0.6, rest 1.0).
 *
 * Faithfulness notes (pcb_painter.cpp / pad.cpp):
 *  - vias and through-pads flash on every copper layer they span, in that
 *    layer's color (v9 padstack rendering);
 *  - holes draw above all copper: walls rgb(236,236,236), via holes
 *    rgb(227,183,46), plated pad holes rgb(194,194,0), NPTH rgb(26,196,210);
 *  - text renders on its own board layer (LAYER_FP_TEXT is only a visibility
 *    switch); roundrect radius = ratio·min(w,h); trapezoid corners per
 *    pad.cpp; zone fills sit directly under their layer's tracks.
 */

import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath';
import {
  dimensionBBox,
  dimensionSegments,
  imageBBox,
  tableBBox,
  tableBorderSegments,
  textBoxBBox,
  textBoxCorners,
  tessellateArc,
  type Board,
  type PcbDimension,
  type PcbImage,
  type PcbTable,
  type PcbTextBox,
  type PcbPad,
  type PcbShape,
  type PcbTextItem,
} from '@ziroeda/pcbnew';
import {
  PCB_PAINT_ORDER,
  PCB_SPECIAL,
  layerColor,
  PCB_GRID,
  type PcbColorTheme,
} from './pcbTheme.js';
import { layoutText, measureText } from '@ziroeda/common/src/font/stroke_font.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)

// Default net-class clearance (netclass.cpp DEFAULT_CLEARANCE = 0.2 mm). This
// board carries no explicit net class (those live in the .kicad_pro), so KiCad
// falls back to it for the pad-clearance outlines shown by default.
const DEFAULT_PAD_CLEARANCE = 0.2 * MM;

// ---------------------------------------------------------------------------
// Emphasis colors (COLOR4D + RENDER_SETTINGS::update + PCB_PAINTER::GetColor).
//
// RENDER_SETTINGS's two factors are both 0.5 (render_settings.cpp), and every
// emphasis below is derived from the base layer color with them, none of it is
// a fixed "make it lighter" nudge, which is why a flat brighten never matches.

/** RENDER_SETTINGS::m_selectFactor / m_highlightFactor (render_settings.cpp). */
const SELECT_FACTOR = 0.5;
const HIGHLIGHT_FACTOR = 0.5;

/** An `rgb()/rgba()` string split into 0..1 channels + alpha. */
function parseRgba(color: string): { r: number; g: number; b: number; a: string | null } | null {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return null;
  const parts = m[1]!.split(',').map((s) => s.trim());
  return {
    r: Number(parts[0]) / 255,
    g: Number(parts[1]) / 255,
    b: Number(parts[2]) / 255,
    a: parts.length > 3 ? parts[3]! : null,
  };
}

const formatRgba = (r: number, g: number, b: number, a: string | null): string => {
  const ch = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return a === null ? `rgb(${ch(r)},${ch(g)},${ch(b)})` : `rgba(${ch(r)},${ch(g)},${ch(b)},${a})`;
};

/**
 * COLOR4D::Brightened(f): push each channel toward white by factor f
 * (c·(1−f)+f), alpha untouched. Parses the `rgb()/rgba()` strings the theme
 * emits and re-emits the same form.
 */
export function brightenColor(color: string, f: number): string {
  if (f <= 0) return color;
  const c = parseRgba(color);
  if (!c) return color;
  return formatRgba(c.r * (1 - f) + f, c.g * (1 - f) + f, c.b * (1 - f) + f, c.a);
}

/** COLOR4D::Darkened(f): scale each channel by (1−f), alpha untouched. */
export function darkenColor(color: string, f: number): string {
  if (f <= 0) return color;
  const c = parseRgba(color);
  if (!c) return color;
  return formatRgba(c.r * (1 - f), c.g * (1 - f), c.b * (1 - f), c.a);
}

/** COLOR4D::GetBrightness, KiCad's weighted W3C formula (blue weight .117). */
export function colorBrightness(color: string): number {
  const c = parseRgba(color);
  if (!c) return 0;
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.117;
}

/**
 * RENDER_SETTINGS::update()'s m_layerColorsSel, the color a *selected* item
 * takes. Not a fixed brighten: the factor grows with the layer's own brightness
 * (`selectFactor/2 + brightness³`) so dark layers lift a little and bright ones
 * lift a lot, and two cases opt out entirely ,
 *
 *  - a near-black color (brightness < 0.05) and net-name text are left alone;
 *  - a color already so bright that brightening moves it less than 0.05 is
 *    *darkened* instead, with the blue channel pushed up, which is the faint
 *    blue glow KiCad puts on selected white silkscreen.
 */
export function selectedColor(color: string, isNetname = false): string {
  const c = parseRgba(color);
  if (!c) return color;

  const brightness = colorBrightness(color);
  if (isNetname || brightness < 0.05) return color;

  const factor = Math.min(1, SELECT_FACTOR * 0.5 + brightness ** 3);
  const brightened = brightenColor(color, factor);

  if (Math.abs(colorBrightness(brightened) - brightness) >= 0.05) return brightened;

  const darkened = parseRgba(darkenColor(color, SELECT_FACTOR * 0.4))!;
  return formatRgba(darkened.r, darkened.g, c.b * (1 - factor) + factor, c.a);
}

/** The color a highlighted net takes (pcb_painter.cpp: Brightened(0.5)). */
export const highlightedColor = (color: string): string => brightenColor(color, HIGHLIGHT_FACTOR);

/** …and what everything else takes for contrast: Darkened(1 − 0.5). */
export const dimmedColor = (color: string): string => darkenColor(color, 1 - HIGHLIGHT_FACTOR);

/** Which emphasis a paint pass applies to every color it draws. */
export type Emphasis = 'none' | 'selected' | 'highlighted' | 'dimmed';

/** Apply an emphasis to one color. `isNetname` only matters for 'selected'. */
export function emphasize(color: string, emphasis: Emphasis, isNetname = false): string {
  switch (emphasis) {
    case 'selected':
      return selectedColor(color, isNetname);
    case 'highlighted':
      return highlightedColor(color);
    case 'dimmed':
      return dimmedColor(color);
    default:
      return color;
  }
}

/** Object visibility + opacity, mirroring pcbnew's Appearance>Objects tab. */
export interface PcbDrawOptions {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
  fpValues: boolean;
  fpReferences: boolean;
  fpText: boolean;
  drawingSheet: boolean;
  trackOpacity: number;
  viaOpacity: number;
  padOpacity: number;
  /** PCB_DISPLAY_OPTIONS::m_NetNames >= 2, net names on tracks. Default on
   *  (pcbnew_settings.cpp ships m_NetNames = 3, pads *and* tracks). */
  netNames: boolean;
  zoneOpacity: number;
  /** Zone display mode: false = filled (default), true = outline sketch. */
  zoneOutline: boolean;
  /** Show pad clearance outlines (m_Display.m_PadClearance, default on). */
  padClearance: boolean;
  /** Fill vs sketch (outline) for tracks / vias / pads (m_Display*Fill; default
   *  filled). Sketch strokes each item's outline at min-pen, like pcb_painter. */
  trackFill: boolean;
  viaFill: boolean;
  padFill: boolean;
  /** Opacity of filled graphic shapes (s_objectSettings "Filled Shapes"). */
  filledShapeOpacity: number;
  /** High-contrast mode for inactive layers (HIGH_CONTRAST_MODE): 'dim' fades
   *  them by m_hiContrastFactor (0.2), 'hide' drops them entirely; Edge.Cuts is
   *  clamped at 0.3 and stays visible even in hide mode (pcb_painter.cpp). */
  contrastMode: 'normal' | 'dim' | 'hide';
  /** The active layer, exempt from contrast dimming. */
  activeLayer?: string;
  /** Paint every layer in this color, the net-color overlay pass
   *  (net colors mode "All": copper items tinted with their net's color). */
  colorOverride?: string;
  /** Print's drill-marks mode: 'none' hides holes ('small' renders as real,
   *  hole geometry is pre-baked in the scene). Default: real. */
  drillMarks?: 'none' | 'small' | 'real';
  /** Color theme override (COLOR_SETTINGS): the print dialog's "Use a
   *  different color theme" passes one of PCB_THEMES (or the synthetic B&W
   *  palette). Absent = the built-in KiCad Default palette. */
  theme?: PcbColorTheme;
  /** Decoded reference-image bitmaps, keyed by payload (`ReferenceImageCache`).
   *  A payload that is absent has not been decoded yet and a `null` one never
   *  will be; either way the pass outlines the extent instead. Callers that do
   *  not paint images — print, plot — simply omit this. */
  imageBitmaps?: ReadonlyMap<string, CanvasImageSource | null>;
}

/** KiCad defaults (project_local_settings.cpp + s_objectSettings). */
export const DEFAULT_DRAW_OPTIONS: PcbDrawOptions = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  drawingSheet: true,
  trackOpacity: 1.0,
  viaOpacity: 1.0,
  padOpacity: 1.0,
  netNames: true,
  zoneOpacity: 0.6,
  zoneOutline: false,
  padClearance: true,
  trackFill: true,
  viaFill: true,
  padFill: true,
  filledShapeOpacity: 1.0,
  contrastMode: 'normal',
};

interface LayerBuckets {
  zones: Path2D;
  hasZones: boolean;
  zoneOutlines: Path2D; // zone boundary borders (drawn full-opacity over the fill)
  hasZoneOutlines: boolean;
  clearance: Path2D; // pad clearance outlines (stroked in the copper color)
  hasClearance: boolean;
  trackOutlines: Path2D; // track/arc stadium outlines for sketch (unfilled) mode
  hasTrackOutlines: boolean;
  tracks: Map<number, Path2D>; // width -> segments/arcs (object: Tracks)
  pads: Path2D; // pad flashes (object: Pads)
  hasPads: boolean;
  vias: Path2D; // via annuli (object: Vias)
  hasVias: boolean;
  gfxFill: Path2D;
  hasGfxFill: boolean;
  gfxStrokes: Map<number, Path2D>;
  textRef: Map<number, Path2D>; // thickness -> glyph strokes
  textVal: Map<number, Path2D>;
  textFp: Map<number, Path2D>;
  textBoard: Map<number, Path2D>;
}

/** A reference image's payload and where it goes; the bitmap is cached apart. */
export interface SceneImage {
  data: string;
  layer: string;
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** One track's net label, ready for the zoom-dependent pass to place. */
export interface TrackNetLabel {
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  layer: string;
  /** GetDisplayNetname(), the short name, after the last '/'. */
  text: string;
}

export interface BoardScene {
  layers: Map<string, LayerBuckets>;
  viaHoles: Path2D;
  viaHoleWalls: Path2D;
  padHolesPlated: Path2D;
  padHoleWalls: Path2D;
  padHolesNP: Path2D;
  /** Pad number/name glyphs (thickness → strokes), drawn over the pads in a
   *  contrasting color (KiCad's LAYER_PAD numbers). */
  padText: Map<number, Path2D>;
  /** Every hole redrawn at the SMALL_DRILL cap (0.35 mm), print's
   *  "Drill marks: Small mark" (pcbplot.h SMALL_DRILL). */
  holesSmall: Path2D;
  /** Track net labels, kept as data rather than baked glyphs: where they go and
   *  whether they appear at all depends on the zoom (PCB_TRACK::ViewGetLOD). */
  netLabels: TrackNetLabel[];
  /** Reference images, as payload + destination. The pixels live in the cache. */
  images: SceneImage[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/**
 * The browser geometry `buildScene` records into.
 *
 * A `Path2D` keeps its definition but will not hand the segments back, which is
 * precisely what a GPU renderer needs from it. Recording through a factory lets
 * a WebGL build substitute paths that retain their vertices, without
 * `buildScene`'s logic or the `BoardScene` shape knowing that happened.
 *
 * The default is the real thing, so existing callers are untouched: `pcb3d.ts`,
 * `FootprintCanvas.tsx` and `footprint_preview_widget.tsx` keep receiving
 * concrete `Path2D` objects and keep drawing them onto a real canvas.
 *
 * `DOMMatrix` is here for the same reason — pad geometry is placed with one,
 * and it is as browser-only as `Path2D` is.
 */
export interface ScenePathFactory {
  path(): Path2D;
  matrix(): DOMMatrix;
}

/** The browser's own implementations; the default for every caller. */
export const DOM_PATH_FACTORY: ScenePathFactory = {
  path: () => new Path2D(),
  matrix: () => new DOMMatrix(),
};

/**
 * The factory in force for the current `buildScene` call.
 *
 * Scoped rather than threaded as a parameter. Threading it would add an
 * argument to thirteen internal helpers and their thirty-odd call sites, and
 * bury a purely mechanical change inside the KiCad-derived drawing code it
 * passes through — the one part of this file worth keeping readable against its
 * C++ original. `buildScene` is synchronous, so the save/restore in the wrapper
 * below is all the isolation this needs.
 *
 * Note `drawGrid` builds its own `Path2D` directly and deliberately: it paints
 * to a real canvas at draw time and is not part of a scene.
 */
let pathFactory: ScenePathFactory = DOM_PATH_FACTORY;

const newBuckets = (): LayerBuckets => ({
  zones: pathFactory.path(),
  hasZones: false,
  zoneOutlines: pathFactory.path(),
  hasZoneOutlines: false,
  clearance: pathFactory.path(),
  hasClearance: false,
  trackOutlines: pathFactory.path(),
  hasTrackOutlines: false,
  tracks: new Map(),
  pads: pathFactory.path(),
  hasPads: false,
  vias: pathFactory.path(),
  hasVias: false,
  gfxFill: pathFactory.path(),
  hasGfxFill: false,
  gfxStrokes: new Map(),
  textRef: new Map(),
  textVal: new Map(),
  textFp: new Map(),
  textBoard: new Map(),
});

const buckets = (scene: BoardScene, layer: string): LayerBuckets => {
  let b = scene.layers.get(layer);
  if (!b) {
    b = newBuckets();
    scene.layers.set(layer, b);
  }
  return b;
};

const pathIn = (map: Map<number, Path2D>, width: number): Path2D => {
  let p = map.get(width);
  if (!p) {
    p = pathFactory.path();
    map.set(width, p);
  }
  return p;
};

/** Expand a pad/via layer list ('*.Cu' wildcards) to real board layer names. */
function expandLayers(list: string[], copperNames: string[]): string[] {
  const out: string[] = [];
  for (const l of list) {
    if (l === '*.Cu') out.push(...copperNames);
    else if (l === 'F&B.Cu') out.push('F.Cu', 'B.Cu');
    else if (l.startsWith('*.')) out.push(`F${l.slice(1)}`, `B${l.slice(1)}`);
    else out.push(l);
  }
  return out;
}

/** Copper layers spanned by a via, in board stackup order. */
function viaSpan(from: string, to: string, copperNames: string[]): string[] {
  const i0 = copperNames.indexOf(from);
  const i1 = copperNames.indexOf(to);
  if (i0 < 0 || i1 < 0) return copperNames;
  const [a, b] = i0 <= i1 ? [i0, i1] : [i1, i0];
  return copperNames.slice(a, b + 1);
}

/**
 * Stadium outline of a track centreline A→B of width `w` (radius r = w/2): the
 * two parallel edges plus the semicircular end caps, as a closed subpath. This
 * is what a track drawn in sketch mode outlines (pcb_painter.cpp DrawSegment in
 * stroke mode). Caps are sampled to stay independent of arc-direction quirks.
 */
function addStadiumOutline(path: Path2D, a: Vec2, b: Vec2, r: number): void {
  if (r <= 0) return;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const N = 8;
  const pt: [number, number][] = [];
  // Forward cap around B: from B-perp through B+dir to B+perp.
  for (let i = 0; i <= N; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / N;
    pt.push([b.x + r * Math.cos(t), b.y + r * Math.sin(t)]);
  }
  // Backward cap around A: from A+perp through A-dir to A-perp.
  for (let i = 0; i <= N; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / N;
    pt.push([a.x + r * Math.cos(t), a.y + r * Math.sin(t)]);
  }
  path.moveTo(pt[0]![0], pt[0]![1]);
  for (let i = 1; i < pt.length; i++) path.lineTo(pt[i]![0], pt[i]![1]);
  path.closePath();
}

/** Outline of a poly-line track (tessellated arc) of width `w`: offset each side. */
function addPolylineOutline(path: Path2D, pts: Vec2[], r: number): void {
  if (r <= 0 || pts.length < 2) return;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const px = -Math.sin(ang) * r;
    const py = Math.cos(ang) * r;
    left.push([p.x + px, p.y + py]);
    right.push([p.x - px, p.y - py]);
  }
  path.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < left.length; i++) path.lineTo(left[i]![0], left[i]![1]);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i]![0], right[i]![1]);
  path.closePath();
}

/** Pad outline as a Path2D subpath in board coordinates. */
function addPadShape(path: Path2D, pad: PcbPad): void {
  const m = pathFactory.matrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const w = pad.size.x;
  const h = pad.size.y;
  const sub = pathFactory.path();
  switch (pad.shape) {
    case 'circle':
      sub.arc(0, 0, w / 2, 0, Math.PI * 2);
      break;
    case 'oval': {
      const r = Math.min(w, h) / 2;
      sub.roundRect(-w / 2, -h / 2, w, h, r);
      break;
    }
    case 'rect':
      sub.rect(-w / 2, -h / 2, w, h);
      break;
    case 'roundrect': {
      // GetRoundRectCornerRadius: ratio · min(w, h), ratio ≤ 0.5.
      const r = Math.min(0.5, pad.roundrectRatio ?? 0.25) * Math.min(w, h);
      if (pad.chamferRatio && pad.chamfer && pad.chamfer.length > 0) {
        addChamferedRect(sub, w, h, r, pad.chamferRatio, pad.chamfer);
      } else {
        sub.roundRect(-w / 2, -h / 2, w, h, r);
      }
      break;
    }
    case 'trapezoid': {
      // pad.cpp TransformShapeToPolygon corner order.
      const hx = w / 2;
      const hy = h / 2;
      const dx = (pad.delta?.x ?? 0) / 2;
      const dy = (pad.delta?.y ?? 0) / 2;
      sub.moveTo(-hx - dy, hy + dx);
      sub.lineTo(hx + dy, hy - dx);
      sub.lineTo(hx - dy, -hy + dx);
      sub.lineTo(-hx + dy, -hy - dx);
      sub.closePath();
      break;
    }
    case 'custom': {
      // Anchor shape first (circle or rect of `size`), then primitives.
      if (w > 0) sub.arc(0, 0, w / 2, 0, Math.PI * 2);
      for (const prim of pad.primitives ?? []) {
        if (prim.kind === 'gr_poly' && prim.pts && prim.pts.length >= 3) {
          sub.moveTo(prim.pts[0]!.x, prim.pts[0]!.y);
          for (let i = 1; i < prim.pts.length; i++) sub.lineTo(prim.pts[i]!.x, prim.pts[i]!.y);
          sub.closePath();
        } else if (prim.kind === 'gr_circle' && prim.center) {
          const r = prim.end
            ? Math.hypot(prim.end.x - prim.center.x, prim.end.y - prim.center.y)
            : 0;
          if (r > 0) {
            sub.moveTo(prim.center.x + r, prim.center.y);
            sub.arc(prim.center.x, prim.center.y, r, 0, Math.PI * 2);
          }
        } else if (prim.kind === 'gr_rect' && prim.start && prim.end) {
          sub.rect(
            Math.min(prim.start.x, prim.end.x),
            Math.min(prim.start.y, prim.end.y),
            Math.abs(prim.end.x - prim.start.x),
            Math.abs(prim.end.y - prim.start.y),
          );
        }
      }
      break;
    }
  }
  path.addPath(sub, m);
}

/**
 * The pad outline inflated by `clr`, the pad-clearance outline KiCad strokes
 * in the copper color (pcb_painter.cpp draw(PAD) clearance layer): a circle of
 * radius+clr for round pads, otherwise the shape offset outward by clr (which
 * rounds the corners with radius clr).
 */
function addPadClearanceShape(path: Path2D, pad: PcbPad, clr: number): void {
  const m = pathFactory.matrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const w = pad.size.x;
  const h = pad.size.y;
  const sub = pathFactory.path();
  const x = -w / 2 - clr;
  const y = -h / 2 - clr;
  const rw = w + 2 * clr;
  const rh = h + 2 * clr;
  switch (pad.shape) {
    case 'circle':
      sub.arc(0, 0, w / 2 + clr, 0, Math.PI * 2);
      break;
    case 'oval':
      sub.roundRect(x, y, rw, rh, Math.min(w, h) / 2 + clr);
      break;
    case 'roundrect': {
      const r = Math.min(0.5, pad.roundrectRatio ?? 0.25) * Math.min(w, h);
      sub.roundRect(x, y, rw, rh, r + clr);
      break;
    }
    default:
      // rect / trapezoid / custom: offset outward with clr-radius corners.
      sub.roundRect(x, y, rw, rh, clr);
      break;
  }
  path.addPath(sub, m);
}

/** Chamfered roundrect: straight cuts on `corners`, radius `r` elsewhere. */
function addChamferedRect(
  sub: Path2D,
  w: number,
  h: number,
  r: number,
  chamferRatio: number,
  corners: string[],
): void {
  const cut = chamferRatio * Math.min(w, h);
  const hx = w / 2;
  const hy = h / 2;
  const has = (c: string): boolean => corners.includes(c);
  const tl = has('top_left');
  const tr = has('top_right');
  const br = has('bottom_right');
  const bl = has('bottom_left');
  sub.moveTo(-hx + (tl ? cut : r), -hy);
  if (tr) {
    sub.lineTo(hx - cut, -hy);
    sub.lineTo(hx, -hy + cut);
  } else {
    sub.lineTo(hx - r, -hy);
    sub.arcTo(hx, -hy, hx, -hy + r, r);
  }
  if (br) {
    sub.lineTo(hx, hy - cut);
    sub.lineTo(hx - cut, hy);
  } else {
    sub.lineTo(hx, hy - r);
    sub.arcTo(hx, hy, hx - r, hy, r);
  }
  if (bl) {
    sub.lineTo(-hx + cut, hy);
    sub.lineTo(-hx, hy - cut);
  } else {
    sub.lineTo(-hx + r, hy);
    sub.arcTo(-hx, hy, -hx, hy - r, r);
  }
  if (tl) {
    sub.lineTo(-hx, -hy + cut);
    sub.lineTo(-hx + cut, -hy);
  } else {
    sub.lineTo(-hx, -hy + r);
    sub.arcTo(-hx, -hy, -hx + r, -hy, r);
  }
  sub.closePath();
}

function addShape(scene: BoardScene, s: PcbShape): void {
  const b = buckets(scene, s.layer);
  const width = Math.max(s.width, 1);
  if (s.kind === 'line' && s.start && s.end) {
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.start.x, s.start.y);
    p.lineTo(s.end.x, s.end.y);
  } else if (s.kind === 'rect' && s.start && s.end) {
    const x = Math.min(s.start.x, s.end.x);
    const y = Math.min(s.start.y, s.end.y);
    const rw = Math.abs(s.end.x - s.start.x);
    const rh = Math.abs(s.end.y - s.start.y);
    if (s.fill) {
      b.gfxFill.rect(x, y, rw, rh);
      b.hasGfxFill = true;
    }
    pathIn(b.gfxStrokes, width).rect(x, y, rw, rh);
  } else if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    if (r <= 0) return;
    if (s.fill) {
      b.gfxFill.moveTo(s.center.x + r, s.center.y);
      b.gfxFill.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
      b.hasGfxFill = true;
    }
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.center.x + r, s.center.y);
    p.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
  } else if (s.kind === 'arc' && s.start && s.mid && s.end) {
    const pts = tessellateArc(s.start, s.mid, s.end);
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
  } else if ((s.kind === 'poly' || s.kind === 'curve') && s.pts && s.pts.length >= 2) {
    if (s.fill && s.pts.length >= 3) {
      b.gfxFill.moveTo(s.pts[0]!.x, s.pts[0]!.y);
      for (let i = 1; i < s.pts.length; i++) b.gfxFill.lineTo(s.pts[i]!.x, s.pts[i]!.y);
      b.gfxFill.closePath();
      b.hasGfxFill = true;
    }
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.pts[0]!.x, s.pts[0]!.y);
    for (let i = 1; i < s.pts.length; i++) p.lineTo(s.pts[i]!.x, s.pts[i]!.y);
    if (s.fill) p.closePath();
  }
}

/** Bake a text item's glyph strokes into the given thickness->path map. */
/**
 * A text box's border and its text.
 * Counterpart: `PCB_PAINTER::draw( const PCB_TEXTBOX* )`, which strokes the
 * corners at the box's line width and then draws the text inside.
 *
 * The border is drawn **only when it is enabled** — a box with `border no` is
 * text with invisible margins, not a rectangle. The text still goes in either
 * way, which is why the two are separate decisions here.
 */
function addTextBox(scene: BoardScene, t: PcbTextBox): void {
  const b = buckets(scene, t.layer);
  if (t.border) {
    const pts = textBoxCorners(t);
    if (pts.length > 1) {
      const p = pathIn(b.gfxStrokes, Math.max(t.strokeWidth ?? 0, 1));
      p.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
      p.closePath();
    }
  }
  if (t.text !== '') {
    addText(b.textBoard, {
      kind: 'user',
      text: t.text,
      at: textBoxTextAnchor(t),
      angle: t.angle ?? 0,
      layer: t.layer,
      size: t.size,
      thickness: t.thickness,
      bold: t.bold,
      italic: t.italic,
      justify: t.justify,
      source: { kind: 'list', items: [] },
    });
  }
}

/**
 * Where the wrapped text starts.
 *
 * Upstream lays the text out inside the box's margins with the font metrics,
 * wrapping it to the width. We have no wrapping, so the string is drawn from
 * the top-left corner plus the left/top margins — the right place for the first
 * line, and honest about being no more than that.
 */
function textBoxTextAnchor(t: PcbTextBox): Vec2 {
  const pts = textBoxCorners(t);
  if (pts.length === 0) return { x: 0, y: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  return { x: minX + t.margins.left, y: minY + t.margins.top + t.size.y };
}

/**
 * A reference image's extent, as an outline.
 * Counterpart: `PCB_PAINTER::draw( const PCB_REFERENCE_IMAGE* )`, which blits
 * the decoded bitmap.
 *
 * **The picture is recorded, not drawn.** The scene is Path2D geometry built
 * synchronously; a raster is neither a path nor synchronous — decoding the
 * base64 hands back a promise and a `CanvasImageSource`. So what goes in the
 * scene is the payload, the layer and the box it fills, and the paint pass
 * blits it once `ReferenceImageCache` has decoded it. Same arrangement as
 * `netLabels`, which are data for the same kind of reason.
 *
 * Nothing is added to the stroke buckets: an outline is what the paint pass
 * falls back to when the payload will not decode, so drawing one here would put
 * a permanent box around every picture that *does*.
 */
function addImage(scene: BoardScene, img: PcbImage): void {
  scene.images.push({ data: img.data, layer: img.layer, box: imageBBox(img) });
}

/**
 * A table: every cell drawn as a text box, then the borders and separators.
 * Counterpart: `PCB_PAINTER::draw( const PCB_TABLE* )`.
 *
 * A cell is drawn *without* its own border — upstream calls the shared text box
 * painter, and a cell's `border` is never set from a file — so all the lines
 * come from `tableBorderSegments`. They are bucketed by stroke width, since a
 * header separator uses the heavier border weight while the rest use the
 * separators weight.
 */
function addTable(scene: BoardScene, t: PcbTable): void {
  if (t.cells.length === 0) return;
  const b = buckets(scene, t.layer);

  for (const cell of t.cells) {
    // A zero span means the cell was merged away; upstream skips those.
    if (cell.colSpan === 0 || cell.rowSpan === 0) continue;
    if (cell.text !== '') {
      addText(b.textBoard, {
        kind: 'user',
        text: cell.text,
        at: textBoxTextAnchor(cell),
        angle: cell.angle ?? 0,
        layer: t.layer,
        size: cell.size,
        thickness: cell.thickness,
        bold: cell.bold,
        italic: cell.italic,
        justify: cell.justify,
        source: { kind: 'list', items: [] },
      });
    }
  }

  for (const seg of tableBorderSegments(t)) {
    const p = pathIn(b.gfxStrokes, Math.max(seg.width, 1));
    p.moveTo(seg.a.x, seg.a.y);
    p.lineTo(seg.b.x, seg.b.y);
  }
}

/**
 * A dimension's lines, into the graphics-stroke bucket of its layer.
 * Counterpart: `PCB_PAINTER::draw( const PCB_DIMENSION_BASE* )`, which walks
 * the shapes `updateGeometry` produced and strokes them at the line width.
 *
 * The extension lines, crossbar, arrowheads and leader all share one width, so
 * they collapse into a single Path2D — the same bucket a graphic line uses, and
 * therefore the same stroke pass. The label goes to the board-text bucket, so it
 * picks up the stroke font like any other board text.
 */
function addDimension(scene: BoardScene, d: PcbDimension): void {
  const b = buckets(scene, d.layer);
  const p = pathIn(b.gfxStrokes, Math.max(d.style.thickness, 1));
  for (const seg of dimensionSegments(d)) {
    p.moveTo(seg.a.x, seg.a.y);
    p.lineTo(seg.b.x, seg.b.y);
  }
  if (d.text && !d.text.hide) addText(b.textBoard, d.text);
}

function addText(map: Map<number, Path2D>, t: PcbTextItem): void {
  const size = t.size.y;
  if (size <= 0 || t.text === '') return;
  const { strokes, width } = layoutText(t.text, size);
  // EDA_TEXT::GetEffectiveTextPenWidth (eda_text.cpp): file thickness, else
  // bold→size/5 / normal→size/8, then clamped to ≤ size·0.25. A too-thin pen
  // is exactly what made board text read like a plain font instead of the
  // stroke font, so this clamp restores the proper Newstroke weight.
  const raw = t.thickness && t.thickness > 1 ? t.thickness : penForText(size, !!t.bold);
  const thickness = Math.max(Math.min(raw, size * 0.25), 1);
  // PCB text anchors CENTER/CENTER by default (EDA_TEXT on boards).
  const justify = t.justify ?? [];
  const hAlign = justify.includes('left') ? 'left' : justify.includes('right') ? 'right' : 'center';
  const vAlign = justify.includes('top') ? 'top' : justify.includes('bottom') ? 'bottom' : 'center';
  const offX = hAlign === 'left' ? 0 : hAlign === 'right' ? -width : -width / 2;
  const offY = vAlign === 'top' ? size : vAlign === 'bottom' ? 0 : size / 2;
  // PCB_TEXT::GetDrawRotation: footprint text keeps its angle in ]-90°, 90°] so
  // it stays readable, e.g. a 270° "POWER" field draws at 90°, not upside-down.
  let drawAngle = t.angle;
  if (t.keepUpright) {
    while (drawAngle > 90) drawAngle -= 180;
    while (drawAngle <= -90) drawAngle += 180;
  }
  const rad = (-drawAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mir = t.mirror ? -1 : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;
  // KiCad scales glyphs by width and height separately (eda_text.cpp writes
  // "(size height width)"); layoutText uses height for both, so condense x by
  // width/height for non-square text (e.g. a condensed board name).
  const sx = size > 0 ? t.size.x / size : 1;
  const path = pathIn(map, thickness);
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = ((stroke[i]!.x + offX) * sx - stroke[i]!.y * tilt) * mir;
      const gy = stroke[i]!.y + offY;
      const x = t.at.x + gx * cos - gy * sin;
      const y = t.at.y + gx * sin + gy * cos;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (stroke.length === 1) path.lineTo(x + 1, y);
    }
  }
}

// KiCad caps pad-label font size (PCB_RENDER_SETTINGS::MAX_FONT_SIZE = 10mm).
const MAX_PAD_FONT = 10 * MM;

/**
 * Pad number (top) + net name (bottom) drawn on a pad, a faithful port of the
 * netname-layer branch of PCB_PAINTER::draw(PAD): the text runs along the pad's
 * longer axis, both are bold and centred, and the sizes come from KiCad's
 * "magic numbers" (1.5·along / max(chars, 3|5), halved and offset when both are
 * shown). Rendered into the scene's padText stroke map.
 */
function addPadLabels(scene: BoardScene, pad: PcbPad, netName: string): void {
  const padNumber = pad.number ?? '';
  // Net label per PCB_PAINTER::draw(PAD): the display netname is the SHORT net
  // name (NETINFO's part after the last '/'); a no-connect pad overrides it
  // with a big "x" and a "free" pad on an unconnected net with "*"
  // (IsNoConnectPad / IsFreePad).
  let netLabel = (pad.net ?? 0) > 0 ? netName.slice(netName.lastIndexOf('/') + 1) : '';
  if (pad.pinType?.includes('no_connect')) netLabel = 'x';
  else if (pad.pinType === 'free' && netLabel.startsWith('unconnected-(')) netLabel = '*';
  const showNet = netLabel !== '';
  if (padNumber === '' && !showNet) return;

  const round = pad.shape === 'circle' || pad.shape === 'oval';
  // KiCad works from the pad's AXIS-ALIGNED bounding box (GetBoundingBox), not
  // the rotated pad frame, and draws with ANGLE_HORIZONTAL, so labels are
  // always upright regardless of pad rotation; only a portrait bbox turns the
  // text -90° to run down the long axis.
  const rot = ((pad.angle ?? 0) * Math.PI) / 180;
  const cosR = Math.abs(Math.cos(rot));
  const sinR = Math.abs(Math.sin(rot));
  let px = pad.size.x * cosR + pad.size.y * sinR; // bbox width
  let py = pad.size.x * sinR + pad.size.y * cosR; // bbox height
  // "Don't allow a 45° rotation to bloat a pad's bounding box unnecessarily."
  if (pad.shape !== 'custom') {
    const limit = Math.min(pad.size.x, pad.size.y) * 1.1;
    if (px > limit && py > limit) {
      px = limit;
      py = limit;
    }
  }
  let angle = 0;
  let size = py;
  // Portrait bbox: rotate the text 90° and run it down the taller axis.
  if (px < py * 0.95) {
    angle = 90;
    size = px;
    [px, py] = [py, px];
  }
  if (size > MAX_PAD_FONT) size = MAX_PAD_FONT;
  const along = px;
  const both = showNet && padNumber !== '';
  let yOffNet = 0;
  let yOffNum = 0;
  if (both) {
    size = size / 2.5;
    yOffNet = size / 1.4; // net name sits below centre
    yOffNum = size / 1.7; // pad number above centre
  }
  const Xscale = 0.9; // condense x for the stroke font
  // A local +Y (down) offset in the text frame (upright or the -90° portrait
  // case) maps to world coords about the pad centre.
  const anchor = (dy: number): Vec2 =>
    angle === 90 ? { x: pad.at.x + dy, y: pad.at.y } : { x: pad.at.x, y: pad.at.y + dy };
  const label = (text: string, at: Vec2, glyph: number): void => {
    addText(scene.padText, {
      kind: 'user',
      text,
      at,
      angle,
      layer: '',
      size: { x: glyph * Xscale, y: glyph },
      thickness: (glyph * Xscale) / 6,
      bold: true,
    } as PcbTextItem);
  };

  if (showNet) {
    let tsize = Math.min((1.5 * along) / Math.max(netLabel.length + 1, 5), size);
    tsize *= 0.85;
    if (round) tsize *= 0.9;
    const ty = Math.min(tsize * 1.4, yOffNet);
    label(netLabel, anchor(ty), tsize);
  }
  if (padNumber !== '') {
    let tsize = Math.min((1.5 * along) / Math.max(padNumber.length, 3), size);
    tsize = Math.min(tsize * 0.85, size);
    label(padNumber, anchor(-yOffNum), tsize);
  }
}

export interface SceneFilter {
  /** Appearance>Objects "Footprints Front/Back": hide whole footprints per side. */
  hideFrontFootprints?: boolean;
  hideBackFootprints?: boolean;
}

/** Even-odd ray cast: is point `p` inside the closed polygon `poly`? */
function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * Zone border hatch ticks (SHAPE_POLY_SET::GenerateHatchLines / ZONE::HatchBorder):
 * a family of parallel lines y = slope·x + a spaced by `spacing` is intersected
 * with the outline; each in-polygon crossing yields a tick of length `lineLen`
 * running inward from the border (`lineLen = -1` keeps the full crossing, for the
 * DIAGONAL_FULL style). Copper zones use slope −1 (all copper layer ids are even).
 */
function zoneHatchSegments(
  outline: Vec2[],
  slope: number,
  spacing: number,
  lineLen: number,
): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  if (outline.length < 3 || spacing <= 0) return out;
  let minX = outline[0]!.x;
  let maxX = minX;
  let minY = outline[0]!.y;
  let maxY = minY;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let maxA: number;
  let minA: number;
  if (slope > 0) {
    maxA = Math.round(maxY - slope * minX);
    minA = Math.round(minY - slope * maxX);
  } else {
    maxA = Math.round(maxY - slope * maxX);
    minA = Math.round(minY - slope * minX);
  }
  minA = Math.floor(minA / spacing) * spacing;
  const n = outline.length;
  for (let a = minA; a < maxA; a += spacing) {
    const pts: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const A = outline[i]!;
      const B = outline[(i + 1) % n]!;
      // Segment A→B ∩ line y = slope·x + a. f(t) = f0 + t·d, t ∈ [0,1).
      const f0 = A.y - slope * A.x - a;
      const d = B.y - A.y - slope * (B.x - A.x);
      if (d === 0) continue;
      const t = -f0 / d;
      if (t < 0 || t >= 1) continue;
      const x = A.x + t * (B.x - A.x);
      const y = A.y + t * (B.y - A.y);
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      pts.push({ x, y });
    }
    if (pts.length > 2) pts.sort((p, q) => q.x - p.x); // descending x
    for (let ip = 0; ip + 1 < pts.length; ip++) {
      const p1 = pts[ip]!;
      const p2 = pts[ip + 1]!;
      if (p1.x === p2.x && p1.y === p2.y) continue;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (!pointInPoly(mid, outline)) continue;
      const dx = p2.x - p1.x;
      if (lineLen === -1 || Math.abs(dx) < 2 * lineLen) {
        out.push([p1, p2]);
      } else {
        const s = (p2.y - p1.y) / dx;
        const ddx = dx > 0 ? lineLen : -lineLen;
        out.push([p1, { x: p1.x + ddx, y: p1.y + ddx * s }]);
        out.push([p2, { x: p2.x - ddx, y: p2.y - ddx * s }]);
      }
    }
  }
  return out;
}

/**
 * Compile the board into retained per-layer, per-object paths.
 *
 * `factory` decides what those paths *are*. It defaults to the browser's
 * `Path2D`/`DOMMatrix`, so every existing caller behaves exactly as before; a
 * GPU renderer passes one whose paths keep their vertices. See
 * {@link ScenePathFactory}.
 */
export function buildScene(
  board: Board,
  filter: SceneFilter = {},
  factory: ScenePathFactory = DOM_PATH_FACTORY,
): BoardScene {
  const prev = pathFactory;
  pathFactory = factory;
  try {
    return compileScene(board, filter);
  } finally {
    // Belt and braces rather than load-bearing: every entry above reassigns
    // `pathFactory`, so a build that throws cannot actually strand the wrong
    // backend on the next caller. Restoring anyway keeps that an invariant of
    // this function instead of a coincidence of its callers, which is what a
    // future nested or early-returning build would need.
    pathFactory = prev;
  }
}

function compileScene(board: Board, filter: SceneFilter): BoardScene {
  const scene: BoardScene = {
    layers: new Map(),
    viaHoles: pathFactory.path(),
    viaHoleWalls: pathFactory.path(),
    padHolesPlated: pathFactory.path(),
    padHoleWalls: pathFactory.path(),
    padHolesNP: pathFactory.path(),
    padText: new Map(),
    holesSmall: pathFactory.path(),
    netLabels: [],
    images: [],
    bbox: null,
  };
  const copperNames = board.layers
    .filter((l) => /\.Cu$/.test(l.name))
    .sort((a, b) => cuOrder(a.name) - cuOrder(b.name))
    .map((l) => l.name);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x: number, y: number, pad = 0): void => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const t of board.tracks) {
    const b = buckets(scene, t.layer);
    const p = pathIn(b.tracks, Math.max(t.width, 1));
    p.moveTo(t.start.x, t.start.y);
    p.lineTo(t.end.x, t.end.y);
    addStadiumOutline(b.trackOutlines, t.start, t.end, t.width / 2);
    b.hasTrackOutlines = true;
    grow(t.start.x, t.start.y, t.width);
    grow(t.end.x, t.end.y, t.width);
    // PCB_TRACK::ViewGetLOD skips the unconnected net; the name itself is the
    // short one (GetDisplayNetname).
    if (t.net > 0) {
      const name = board.nets.get(t.net) ?? '';
      const shown = name.slice(name.lastIndexOf('/') + 1);
      if (shown !== '')
        scene.netLabels.push({
          start: t.start,
          end: t.end,
          width: t.width,
          layer: t.layer,
          text: shown,
        });
    }
  }
  for (const a of board.arcs) {
    const pts = tessellateArc(a.start, a.mid, a.end);
    const b = buckets(scene, a.layer);
    const p = pathIn(b.tracks, Math.max(a.width, 1));
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
    addPolylineOutline(b.trackOutlines, pts, a.width / 2);
    b.hasTrackOutlines = true;
    grow(a.start.x, a.start.y, a.width);
    grow(a.end.x, a.end.y, a.width);
  }
  for (const v of board.vias) {
    const r = v.size / 2;
    for (const layer of viaSpan(v.layers[0], v.layers[1], copperNames)) {
      const b = buckets(scene, layer);
      b.vias.moveTo(v.at.x + r, v.at.y);
      b.vias.arc(v.at.x, v.at.y, r, 0, Math.PI * 2);
      b.hasVias = true;
    }
    const hr = v.drill / 2;
    scene.viaHoleWalls.moveTo(v.at.x + hr + 0.05 * MM, v.at.y);
    scene.viaHoleWalls.arc(v.at.x, v.at.y, hr + 0.05 * MM, 0, Math.PI * 2);
    {
      const sr = Math.min(hr, 0.175 * MM);
      scene.holesSmall.moveTo(v.at.x + sr, v.at.y);
      scene.holesSmall.arc(v.at.x, v.at.y, sr, 0, Math.PI * 2);
    }
    scene.viaHoles.moveTo(v.at.x + hr, v.at.y);
    scene.viaHoles.arc(v.at.x, v.at.y, hr, 0, Math.PI * 2);
    grow(v.at.x, v.at.y, r);
  }
  for (const z of board.zones) {
    for (const fill of z.fills) {
      const b = buckets(scene, fill.layer);
      for (const poly of fill.polys) {
        b.zones.moveTo(poly[0]!.x, poly[0]!.y);
        for (let i = 1; i < poly.length; i++) b.zones.lineTo(poly[i]!.x, poly[i]!.y);
        b.zones.closePath();
        b.hasZones = true;
        for (const pt of poly) grow(pt.x, pt.y);
      }
    }
    // The zone boundary is drawn as a border on each of the zone's layers
    // (pcb_painter.cpp draw(ZONE): outline of GetBoardOutline in the layer
    // color). INVISIBLE_BORDER suppresses it entirely — that is what teardrops
    // use, and without it every flare gets a full-opacity outline traced over a
    // 0.6-opacity fill, which reads as a bright wire around the copper.
    if (z.hatchStyle !== 'invisible' && z.outline && z.outline.length >= 3) {
      // DIAGONAL_EDGE = short ticks (length = pitch, spacing = pitch);
      // DIAGONAL_FULL = full diagonals (spacing = pitch·2). Copper slope = −1.
      const style = z.hatchStyle ?? 'edge';
      const pitch = z.hatchPitch ?? 0;
      const hatch =
        style !== 'none' && pitch > 0
          ? zoneHatchSegments(
              z.outline,
              -1,
              style === 'full' ? pitch * 2 : pitch,
              style === 'full' ? -1 : pitch,
            )
          : [];
      for (const layer of z.layers) {
        const b = buckets(scene, layer);
        b.zoneOutlines.moveTo(z.outline[0]!.x, z.outline[0]!.y);
        for (let i = 1; i < z.outline.length; i++)
          b.zoneOutlines.lineTo(z.outline[i]!.x, z.outline[i]!.y);
        b.zoneOutlines.closePath();
        for (const [p, q] of hatch) {
          b.zoneOutlines.moveTo(p.x, p.y);
          b.zoneOutlines.lineTo(q.x, q.y);
        }
        b.hasZoneOutlines = true;
      }
      for (const pt of z.outline) grow(pt.x, pt.y);
    }
  }
  for (const s of board.shapes) {
    addShape(scene, s);
    if (s.start) grow(s.start.x, s.start.y, s.width);
    if (s.end) grow(s.end.x, s.end.y, s.width);
    if (s.center) grow(s.center.x, s.center.y);
    for (const pt of s.pts ?? []) grow(pt.x, pt.y);
  }
  for (const fp of board.footprints) {
    if (filter.hideFrontFootprints && fp.layer === 'F.Cu') continue;
    if (filter.hideBackFootprints && fp.layer === 'B.Cu') continue;
    for (const s of fp.shapes) addShape(scene, s);
    for (const t of fp.texts) {
      if (t.hide) continue;
      const b = buckets(scene, t.layer);
      addText(t.kind === 'reference' ? b.textRef : t.kind === 'value' ? b.textVal : b.textFp, t);
    }
    for (const pad of fp.pads) {
      if (pad.type === 'np_thru_hole') {
        // Painter draws NPTH as its hole in LAYER_NON_PLATEDHOLES.
        if (pad.drill) {
          addHole(scene.padHolesNP, pad, pad.drill);
          addSmallHole(scene, pad);
        }
        continue;
      }
      for (const layer of expandLayers(pad.layers, copperNames)) {
        const b = buckets(scene, layer);
        addPadShape(b.pads, pad);
        b.hasPads = true;
        // Pad clearance outline is drawn per copper layer the pad flashes on
        // (not the mask layers), in that layer's color.
        if (copperNames.includes(layer)) {
          addPadClearanceShape(b.clearance, pad, DEFAULT_PAD_CLEARANCE);
          b.hasClearance = true;
        }
      }
      if (pad.drill && pad.type === 'thru_hole') {
        addHole(scene.padHoleWalls, pad, {
          ...pad.drill,
          w: pad.drill.w + 0.1 * MM,
          h: pad.drill.h + 0.1 * MM,
        });
        addHole(scene.padHolesPlated, pad, pad.drill);
        addSmallHole(scene, pad);
      }
      // Pad number + net name text (PCB_PAINTER::draw(PAD) netname layer).
      addPadLabels(scene, pad, board.nets.get(pad.net ?? 0) ?? '');
      grow(pad.at.x, pad.at.y, Math.max(pad.size.x, pad.size.y) / 2);
    }
    grow(fp.at.x, fp.at.y);
  }
  for (const t of board.texts) {
    if (!t.hide) addText(buckets(scene, t.layer).textBoard, t);
  }
  for (const t of board.textBoxes) {
    addTextBox(scene, t);
    const tb = textBoxBBox(t);
    grow(tb.minX, tb.minY);
    grow(tb.maxX, tb.maxY);
  }
  for (const img of board.images) {
    addImage(scene, img);
    const ib = imageBBox(img);
    grow(ib.minX, ib.minY);
    grow(ib.maxX, ib.maxY);
  }
  for (const t of board.tables) {
    addTable(scene, t);
    const tb = tableBBox(t);
    grow(tb.minX, tb.minY);
    grow(tb.maxX, tb.maxY);
  }
  for (const d of board.dimensions) {
    addDimension(scene, d);
    // From the drawn lines, not the feature points: the crossbar and the
    // arrowheads reach past both of them.
    const db = dimensionBBox(d);
    grow(db.minX, db.minY);
    grow(db.maxX, db.maxY);
  }

  scene.bbox = minX < maxX ? { minX, minY, maxX, maxY } : null;
  return scene;
}

const addHole = (
  path: Path2D,
  pad: PcbPad,
  drill: { oblong: boolean; w: number; h: number; offset?: Vec2 },
): void => {
  const m = pathFactory.matrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const sub = pathFactory.path();
  const ox = drill.offset?.x ?? 0;
  const oy = drill.offset?.y ?? 0;
  if (drill.oblong) {
    const r = Math.min(drill.w, drill.h) / 2;
    sub.roundRect(ox - drill.w / 2, oy - drill.h / 2, drill.w, drill.h, r);
  } else {
    sub.arc(ox, oy, drill.w / 2, 0, Math.PI * 2);
  }
  path.addPath(sub, m);
};

/** Small-mark hole for a pad: same centre, diameter capped at 0.35 mm. */
const addSmallHole = (scene: BoardScene, pad: PcbPad): void => {
  if (!pad.drill) return;
  const r = Math.min(Math.min(pad.drill.w, pad.drill.h) / 2, 0.175 * MM);
  const off = pad.drill.offset;
  const m = pathFactory.matrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const sub = pathFactory.path();
  sub.arc(off?.x ?? 0, off?.y ?? 0, r, 0, Math.PI * 2);
  scene.holesSmall.addPath(sub, m);
};

/** F.Cu first, inners in numeric order, B.Cu last (board stackup). */
const cuOrder = (name: string): number => {
  if (name === 'F.Cu') return 0;
  if (name === 'B.Cu') return 1000;
  const m = /^In(\d+)\.Cu$/.exec(name);
  return m ? Number(m[1]) : 500;
};

export interface PcbViewTransform {
  scale: number; // canvas px per IU
  tx: number;
  ty: number;
  /** Horizontal mirror of the view (APPEARANCE_CONTROLS "Flip board view",
   *  KIGFX::VIEW::SetMirror on X): screenX = worldX·(−scale) + tx. */
  flipX?: boolean;
}

// KiCad renders every stroke at a minimum on-screen width so thin tracks stay
// crisp and visible when zoomed out (GAL's minimum pen), instead of fading to a
// sub-pixel blur. `minPen` is 1 device pixel expressed in world (IU) units.
const strokeAll = (ctx: CanvasRenderingContext2D, map: Map<number, Path2D>, minPen = 0): void => {
  for (const [width, path] of map) {
    ctx.lineWidth = Math.max(width, minPen);
    ctx.stroke(path);
  }
};

// ----- drawing sheet (page frame + title block) ------------------------------
// KiCad's default worksheet (common/drawing_sheet/drawing_sheet_default_
// description.cpp): 10 mm margins, a double border 2 mm apart, a 50 mm
// coordinate band, and the 110×34 mm title block in the bottom-right corner.
// pcbnew draws it in LAYER_DRAWINGSHEET colour rgb(200,114,171)
// (builtin_color_themes.h). The board origin (0,0) is the page's top-left.

const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

const paperSizeIU = (paper: string | undefined): { w: number; h: number } | null => {
  if (!paper) return null;
  const parts = paper.split(/\s+/);
  const dims = PAPER_MM[parts[0]!];
  if (!dims) return null;
  const [w, h] = parts.includes('portrait') ? [dims[1], dims[0]] : dims;
  return { w: w! * MM, h: h! * MM };
};

export interface SheetInfo {
  paper?: string;
  titleBlock?: { title?: string; date?: string; rev?: string; company?: string };
  fileName?: string;
}

// eda_text.cpp / gr_text.cpp EDA_TEXT pen: bold = size/5, normal = size/8,
// clamped to ≤ size·0.25 (ClampTextPenSize). glyph.cpp ITALIC_TILT = 1/8.
const penForText = (size: number, bold: boolean): number =>
  Math.min(bold ? size / 5 : size / 8, size * 0.25);
const ITALIC_TILT = 1 / 8;

/** Stroke a Newstroke string at (x, y) baseline, with optional bold/italic. */
function sheetText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  justify: 'left' | 'center' = 'left',
  bold = false,
  italic = false,
): void {
  if (!text) return;
  const { strokes, width } = layoutText(text, size);
  const offX = justify === 'center' ? -width / 2 : 0;
  ctx.lineWidth = penForText(size, bold);
  const tilt = italic ? ITALIC_TILT : 0;
  ctx.beginPath();
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      // Italic shear: y is negative above the baseline, so tops lean right.
      const px = x + stroke[i]!.x - stroke[i]!.y * tilt + offX;
      const py = y + stroke[i]!.y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      if (stroke.length === 1) ctx.lineTo(px + 1, py);
    }
  }
  ctx.stroke();
}

const DRAWINGSHEET_COLOR = 'rgb(200,114,171)';

export function drawDrawingSheet(
  ctx: CanvasRenderingContext2D,
  info: SheetInfo,
  // LAYER_DRAWINGSHEET from the active theme (print passes the print theme's).
  color: string = DRAWINGSHEET_COLOR,
): void {
  const page = paperSizeIU(info.paper);
  if (!page) return;
  const M = 10 * MM;
  const L = M,
    T = M,
    R = page.w - M,
    B = page.h - M;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.15 * MM;
  ctx.setLineDash([]);
  ctx.strokeRect(L, T, R - L, B - T);
  const i2 = 2 * MM;
  ctx.strokeRect(L + i2, T + i2, R - L - 2 * i2, B - T - 2 * i2);

  // Coordinate band (numbers across, letters down), 50 mm divisions.
  const refH = 1.3 * MM;
  const step = 50 * MM;
  ctx.beginPath();
  for (let x = L + step; x < R - i2; x += step) {
    ctx.moveTo(x, T);
    ctx.lineTo(x, T + i2);
    ctx.moveTo(x, B);
    ctx.lineTo(x, B - i2);
  }
  for (let y = T + step; y < B - i2; y += step) {
    ctx.moveTo(L, y);
    ctx.lineTo(L + i2, y);
    ctx.moveTo(R, y);
    ctx.lineTo(R - i2, y);
  }
  ctx.stroke();
  let n = 1;
  for (let x = L; x < R - i2; x += step, n++) {
    const cx = Math.min(x + step / 2, (x + R) / 2);
    sheetText(ctx, String(n), cx, T + i2 / 2 + refH / 2, refH, 'center');
    sheetText(ctx, String(n), cx, B - i2 / 2 + refH / 2, refH, 'center');
  }
  let li = 0;
  for (let y = T; y < B - i2; y += step, li++) {
    const cy = Math.min(y + step / 2, (y + B) / 2);
    const ch = String.fromCharCode(65 + (li % 26));
    sheetText(ctx, ch, L + i2 / 2, cy + refH / 2, refH, 'center');
    sheetText(ctx, ch, R - i2 / 2, cy + refH / 2, refH, 'center');
  }

  // Title block, default description (110×34 off the bottom-right corner).
  const rx = (d: number): number => R - d * MM;
  const ry = (d: number): number => B - d * MM;
  ctx.strokeRect(rx(110), ry(34), 108 * MM, 32 * MM);
  ctx.beginPath();
  for (const yy of [5.5, 8.5, 12.5, 18.5]) {
    ctx.moveTo(rx(110), ry(yy));
    ctx.lineTo(rx(2), ry(yy));
  }
  ctx.moveTo(rx(90), ry(8.5));
  ctx.lineTo(rx(90), ry(5.5));
  ctx.moveTo(rx(26), ry(8.5));
  ctx.lineTo(rx(26), ry(2));
  ctx.stroke();

  // Field layout + weights are the KiCad default worksheet
  // (drawing_sheet_default_description.cpp): Title is bold italic, Rev and
  // Company are bold, the rest normal.
  const tb = info.titleBlock;
  const t15 = 1.5 * MM;
  sheetText(ctx, `Date: ${tb?.date ?? ''}`, rx(87), ry(6.9), t15);
  sheetText(ctx, 'ZiroEDA', rx(109), ry(4.1), t15);
  sheetText(ctx, `Rev: ${tb?.rev ?? ''}`, rx(24), ry(6.9), t15, 'left', true);
  sheetText(ctx, `Size: ${info.paper ?? ''}`, rx(109), ry(6.9), t15);
  sheetText(ctx, 'Id: 1/1', rx(24), ry(4.1), t15);
  sheetText(ctx, `Title: ${tb?.title ?? ''}`, rx(109), ry(10.7), 2 * MM, 'left', true, true);
  sheetText(ctx, `File: ${info.fileName ?? ''}`, rx(109), ry(14.3), t15);
  sheetText(ctx, 'Sheet: /', rx(109), ry(17), t15);
  sheetText(ctx, tb?.company ?? '', rx(109), ry(20), t15, 'left', true);
}

// ----- grid (GAL DrawGrid) ---------------------------------------------------

/** Grid render options, the GAL DOTS grid with KiCad's pcbnew defaults. */
export interface PcbGridOptions {
  /** Grid spacing in IU (world units). pcbnew default grid = 0.5 mm. */
  size: number;
  /** Grid origin in IU (GAL m_gridOrigin; board grid origin). */
  origin: Vec2;
  /** Coarse-grid multiple: every `tick`th dot is doubled (SetCoarseGrid(10)). */
  tick: number;
  /** Minimum on-screen dot spacing in device px (m_gridMinSpacing = 10). */
  minSpacing: number;
  /** LAYER_GRID color. */
  color: string;
}

export const DEFAULT_GRID_OPTIONS: PcbGridOptions = {
  size: 0.5 * MM,
  origin: { x: 0, y: 0 },
  tick: 10,
  minSpacing: 10,
  color: PCB_GRID,
};

/**
 * Paint the dotted grid the way GAL does (CAIRO_GAL_BASE::DrawGrid, DOTS
 * branch): a dot at every grid node in device space, every `tick`th row/column
 * doubled in size, with the spacing scaled up by whole `tick`s until it clears
 * the minimum on-screen spacing so a zoomed-out board isn't a solid wall of
 * dots. Drawn on the live canvas (identity transform) so it stays crisp every
 * frame like GAL's NONCACHED grid target, behind the board raster. `dpr` is the
 * device-pixel ratio (GAL's scaleFactor).
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: PcbViewTransform,
  widthPx: number,
  heightPx: number,
  dpr: number,
  opts: PcbGridOptions = DEFAULT_GRID_OPTIONS,
): void {
  if (opts.size <= 0 || view.scale <= 0) return;
  const worldScale = view.scale; // device px per IU
  // Signed X scale so grid nodes line up with the (mirrored) board and crosshair.
  const sx = view.flipX ? -worldScale : worldScale;
  // GAL: m_gridLineWidth = scaleFactor * 0.5 + 0.25; a normal dot is this wide,
  // a coarse dot twice that, each clamped to a minimum of 1 device px.
  const lineW = dpr * 0.5 + 0.25;

  // Visible world rectangle (screen corners → world).
  const wsx = (0 - view.tx) / sx;
  const wsy = (0 - view.ty) / worldScale;
  const wex = (widthPx - view.tx) / sx;
  const wey = (heightPx - view.ty) / worldScale;

  // Scale spacing up by whole ticks until it clears the min screen spacing.
  const threshold = Math.round(opts.minSpacing / worldScale); // IU
  let step = opts.size;
  while (step <= threshold) step *= opts.tick;

  const ox = opts.origin.x;
  const oy = opts.origin.y;
  let startX = Math.round((wsx - ox) / step);
  let endX = Math.round((wex - ox) / step);
  let startY = Math.round((wsy - oy) / step);
  let endY = Math.round((wey - oy) / step);
  if (startX > endX) [startX, endX] = [endX, startX];
  if (startY > endY) [startY, endY] = [endY, startY];
  startX--;
  endX++;
  startY--;
  endY++;

  // Guard against pathological counts (e.g. a not-yet-sized view).
  if (endX - startX > 4000 || endY - startY > 4000) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.color;
  // Group dots by device size so the whole grid paints in a few fills.
  const paths = new Map<string, Path2D>();
  const rectAt = (dx: number, dy: number, sw: number, sh: number): void => {
    // Pixel-align to whole device pixels so each dot is full-coverage (the OpenGL
    // GAL's dots are crisp); a sub-pixel rect anti-aliases to a dim grey smear.
    const w = Math.max(1, Math.round(sw));
    const h = Math.max(1, Math.round(sh));
    const key = `${w}:${h}`;
    let p = paths.get(key);
    if (!p) {
      p = new Path2D();
      paths.set(key, p);
    }
    p.rect(Math.round(dx) - (w >> 1), Math.round(dy) - (h >> 1), w, h);
  };
  for (let j = startY; j <= endY; j++) {
    const tickY = j % opts.tick === 0;
    const dy = (j * step + oy) * worldScale + view.ty;
    const sh = Math.max(1, tickY ? lineW * 2 : lineW);
    for (let i = startX; i <= endX; i++) {
      const tickX = i % opts.tick === 0;
      const dx = (i * step + ox) * sx + view.tx;
      const sw = Math.max(1, tickX ? lineW * 2 : lineW);
      rectAt(dx, dy, sw, sh);
    }
  }
  for (const p of paths.values()) ctx.fill(p);
}

/**
 * The paint sequence as resumable steps, one per stacking pass. The editor
 * runs these across animation frames with a time budget so a 20k-track board
 * never blocks the UI while the crisp raster streams in.
 */
export function buildDrawSteps(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: PcbViewTransform,
  visible: ReadonlySet<string>,
  widthPx: number,
  heightPx: number,
  opts: PcbDrawOptions = DEFAULT_DRAW_OPTIONS,
  sheet?: SheetInfo,
  // Overlay pass (live move preview): paint the items on top of an existing
  // frame, so skip the background clear and the drawing sheet.
  overlay = false,
  // How this pass emphasises what it paints (PCB_PAINTER::GetColor): selected
  // items take m_layerColorsSel, a highlighted net brightens and the rest of the
  // board darkens. 'none' paints the layer colors as-is.
  emphasis: Emphasis = 'none',
): (() => void)[] {
  const steps: (() => void)[] = [];
  // Per-layer color from the active theme, under this pass's emphasis.
  const themeColors = opts.theme?.layerColors;
  const special = opts.theme?.special ?? PCB_SPECIAL;
  const col = (layer: string): string =>
    opts.colorOverride ?? emphasize(themeColors?.[layer] ?? layerColor(layer), emphasis);
  const sp = (c: string): string => emphasize(c, emphasis);
  steps.push(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The raster is kept transparent so the grid (painted on the live canvas
    // behind the raster, like GAL's GRID_DEPTH) shows through the empty board
    // areas. The visible canvas fills PCB_BACKGROUND before blitting.
    // A flipped view negates the X scale (SetMirror on X).
    ctx.setTransform(view.flipX ? -view.scale : view.scale, 0, 0, view.scale, view.tx, view.ty);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Drawing sheet (page frame + title block) behind the board, like pcbnew,
    // in the theme's LAYER_DRAWINGSHEET color (classic: dark red; B&W: black).
    if (!overlay && sheet && opts.drawingSheet) drawDrawingSheet(ctx, sheet, special.drawingSheet);
  });

  const minPen = view.scale > 0 ? 1 / view.scale : 0; // 1 device px in IU

  // High-contrast alpha for a whole layer (pcb_painter.cpp getColor): inactive
  // layers fade by m_hiContrastFactor (0.2) in dim mode and disappear in hide
  // mode; Edge.Cuts is clamped at 0.3 and survives even hide mode.
  const layerAlpha = (layer: string): number => {
    if (opts.contrastMode === 'normal' || layer === opts.activeLayer) return 1;
    if (layer === 'Edge.Cuts') return 0.3;
    return opts.contrastMode === 'dim' ? 0.2 : 0;
  };

  const paintZones = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b || !opts.zones || (!b.hasZones && !b.hasZoneOutlines)) return;
    const color = col(layer);
    if (b.hasZones) {
      ctx.globalAlpha = opts.zoneOpacity * la;
      if (opts.zoneOutline) {
        // PCB_ACTIONS::zoneDisplayOutline, sketch the fill outlines.
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.05 * MM;
        ctx.stroke(b.zones);
      } else {
        ctx.fillStyle = color;
        ctx.fill(b.zones, 'nonzero');
      }
    }
    // Zone boundary border: full opacity (color.WithAlpha(1.0)), min-pen width
    // (m_outlineWidth = 1 IU), drawn over the fill, the outline KiCad always
    // shows around a filled zone.
    if (b.hasZoneOutlines) {
      ctx.globalAlpha = la;
      ctx.strokeStyle = color;
      ctx.lineWidth = minPen;
      ctx.stroke(b.zoneOutlines);
    }
    ctx.globalAlpha = 1;
  };
  const paintCopper = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    const color = col(layer);
    if (b.hasGfxFill) {
      ctx.globalAlpha = opts.filledShapeOpacity * la;
      ctx.fillStyle = color;
      ctx.fill(b.gfxFill, 'nonzero');
    }
    ctx.globalAlpha = la;
    ctx.strokeStyle = color;
    strokeAll(ctx, b.gfxStrokes, minPen);
    if (opts.tracks && b.tracks.size > 0) {
      ctx.globalAlpha = opts.trackOpacity * la;
      if (opts.trackFill) {
        strokeAll(ctx, b.tracks, minPen);
      } else if (b.hasTrackOutlines) {
        // Sketch: outline each track at min-pen instead of filling it.
        ctx.lineWidth = minPen;
        ctx.stroke(b.trackOutlines);
      }
    }
    if (opts.pads && b.hasPads) {
      ctx.globalAlpha = opts.padOpacity * la;
      if (opts.padFill) {
        ctx.fillStyle = color;
        ctx.fill(b.pads, 'nonzero');
      } else {
        ctx.lineWidth = minPen;
        ctx.stroke(b.pads);
      }
    }
    if (opts.vias && b.hasVias) {
      ctx.globalAlpha = opts.viaOpacity * la;
      if (opts.viaFill) {
        ctx.fillStyle = color;
        ctx.fill(b.vias, 'nonzero');
      } else {
        ctx.lineWidth = minPen;
        ctx.stroke(b.vias);
      }
    }
    // Pad clearance outlines: thin (min-pen) stroke in the copper color, the
    // ring KiCad shows around every pad by default (m_Display.m_PadClearance).
    // Drawn translucent so it reads as the light "glass" ring GAL's anti-aliased
    // sub-pixel line gives, rather than a hard solid circle.
    if (opts.padClearance && b.hasClearance) {
      ctx.globalAlpha = 0.55 * la;
      ctx.strokeStyle = color;
      ctx.lineWidth = minPen;
      ctx.stroke(b.clearance);
    }
    ctx.globalAlpha = 1;
  };
  const paintText = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    ctx.globalAlpha = la;
    ctx.strokeStyle = col(layer);
    if (opts.fpReferences) strokeAll(ctx, b.textRef);
    if (opts.fpValues) strokeAll(ctx, b.textVal);
    if (opts.fpText) strokeAll(ctx, b.textFp);
    strokeAll(ctx, b.textBoard);
    ctx.globalAlpha = 1;
  };
  const pushLayer = (layer: string): void => {
    if (!visible.has(layer) || !scene.layers.has(layer)) return;
    const la = layerAlpha(layer);
    if (la <= 0) return;
    steps.push(paintZones(layer, la), paintCopper(layer, la), paintText(layer, la));
  };

  const fCuIndex = PCB_PAINT_ORDER.indexOf('F.Cu');
  for (let i = 0; i <= fCuIndex; i++) pushLayer(PCB_PAINT_ORDER[i]!);

  steps.push(() => {
    // Print's drill-marks modes: 'none' suppresses every hole; 'small' draws
    // each hole capped at SMALL_DRILL (0.35 mm) instead of true size.
    if (opts.drillMarks === 'none') return;
    if (opts.drillMarks === 'small') {
      ctx.fillStyle = sp(special.padPlatedHole);
      ctx.fill(scene.holesSmall);
      return;
    }
    if (opts.pads) {
      ctx.fillStyle = sp(special.padHoleWall);
      ctx.fill(scene.padHoleWalls);
      ctx.fillStyle = sp(special.padPlatedHole);
      ctx.fill(scene.padHolesPlated);
    }
    if (opts.vias) {
      ctx.fillStyle = sp(special.viaHoleWall);
      ctx.fill(scene.viaHoleWalls);
      ctx.fillStyle = sp(special.viaHole);
      ctx.fill(scene.viaHoles);
    }
    if (opts.pads) {
      ctx.fillStyle = sp(special.nonPlatedHole);
      ctx.fill(scene.padHolesNP);
    }
  });

  for (let i = fCuIndex + 1; i < PCB_PAINT_ORDER.length; i++) pushLayer(PCB_PAINT_ORDER[i]!);

  // Pad numbers and net names on top, in a bright contrasting color (KiCad
  // draws them over the pad copper). Only *selection* leaves them alone: the
  // net-name skip lives in RENDER_SETTINGS::update()'s m_layerColorsSel, so a
  // net highlight still brightens and dims this text with everything else.
  if (opts.pads && scene.padText.size > 0) {
    steps.push(() => {
      ctx.globalAlpha = opts.padOpacity;
      ctx.strokeStyle = emphasize(special.padName, emphasis, true);
      strokeAll(ctx, scene.padText, minPen);
      ctx.globalAlpha = 1;
    });
  }

  // Reference images. Painted before the net names but after the copper, which
  // is where PCB_PAINTER puts them: a reference image is something to trace
  // over, so it must not cover the board.
  //
  // A picture that has not decoded yet, or never will, is outlined instead —
  // the item stays visible and selectable, which is what it did before any of
  // this could paint at all.
  if (scene.images.length > 0) {
    steps.push(() => {
      for (const img of scene.images) {
        if (!visible.has(img.layer)) continue;
        const la = layerAlpha(img.layer);
        if (la === 0) continue;

        const w = img.box.maxX - img.box.minX;
        const h = img.box.maxY - img.box.minY;
        const bitmap = opts.imageBitmaps?.get(img.data);

        ctx.globalAlpha = la;
        if (bitmap) {
          // A flipped view already negates the X scale on the context, so the
          // picture mirrors with the board rather than needing its own flip.
          ctx.drawImage(bitmap, img.box.minX, img.box.minY, w, h);
        } else {
          ctx.strokeStyle = col(img.layer);
          ctx.lineWidth = minPen;
          ctx.strokeRect(img.box.minX, img.box.minY, w, h);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  // Track net names, last: the label only exists at a high enough zoom, so its
  // glyphs are laid out per frame rather than baked into the scene.
  if (opts.netNames && scene.netLabels.length > 0) {
    steps.push(() => {
      const viewport = viewportInWorld(view, widthPx, heightPx);
      const byColor = new Map<string, Map<number, Path2D>>();

      // draw(PCB_TRACK) takes its color from GetColor(track, aLayer) with aLayer
      // the *netname* layer, so the text is the theme's netnames color (white at
      // 0.7), not the copper color, exactly as the pad net names are.
      const color = emphasize(special.padName, emphasis, true);
      for (const label of scene.netLabels) {
        if (!visible.has(label.layer)) continue;
        if (!showsNetName(label, view)) continue;
        let map = byColor.get(color);
        if (!map) {
          map = new Map();
          byColor.set(color, map);
        }
        addTrackNetName(map, label, viewport);
      }
      for (const [color, map] of byColor) {
        ctx.strokeStyle = color;
        strokeAll(ctx, map, minPen);
      }
    });
  }
  return steps;
}

/** The visible world rectangle, for the netname repeat/clip rules. */
function viewportInWorld(
  view: PcbViewTransform,
  widthPx: number,
  heightPx: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const sx = view.flipX ? -view.scale : view.scale;
  const x0 = (0 - view.tx) / sx;
  const x1 = (widthPx - view.tx) / sx;
  const y0 = (0 - view.ty) / view.scale;
  const y1 = (heightPx - view.ty) / view.scale;
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
  };
}

/**
 * PCB_TRACK::ViewGetLOD for a netname layer: the label shows once the track is
 * drawn at least as wide on screen as 4 mm is at scale 1, `lodScaleForThreshold
 * (view, m_width, mmToIU(4.0))`, compared against the view scale, and only when
 * the track is long enough to hold the text (`length² >= (width · chars)²`).
 */
export function showsNetName(label: TrackNetLabel, view: PcbViewTransform): boolean {
  if (label.width <= 0) return false;

  const dx = label.end.x - label.start.x;
  const dy = label.end.y - label.start.y;
  const nameSize = label.text.length * label.width;
  if (dx * dx + dy * dy < nameSize * nameSize) return false;

  return label.width * view.scale >= NETNAME_MIN_PX;
}

/**
 * KiCad's 4 mm threshold in screen pixels. Its VIEW scale is normalised so that
 * scale 1 draws 1 mm at the screen's nominal DPI, which puts the gate at
 * 4 mm · (96 dpi / 25.4) ≈ 15 px of track width.
 */
const NETNAME_MIN_PX = (4 * 96) / 25.4;

/**
 * PCB_PAINTER::renderNetNameForSegment: the text is the track's width tall
 * (glyphs at 0.55 of it), runs along the segment turned into ]-90°, 90°], and
 * repeats once per viewport-length of track so a long trace stays labelled
 * wherever you are looking. Positions outside the viewport are skipped.
 */
function addTrackNetName(
  map: Map<number, Path2D>,
  label: TrackNetLabel,
  viewport: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const dx = label.end.x - label.start.x;
  const dy = label.end.y - label.start.y;
  const length = Math.hypot(dx, dy);
  const textSize = label.width;

  let angle: number;
  let numNames = 1;
  const vw = viewport.maxX - viewport.minX;
  const vh = viewport.maxY - viewport.minY;

  if (dy === 0) {
    angle = 0;
    numNames = Math.max(numNames, Math.round(length / vw));
  } else if (dx === 0) {
    angle = 90;
    numNames = Math.max(numNames, Math.round(length / vh));
  } else {
    // -EDA_ANGLE(segV), normalised into ]-90°, 90°] so the text stays readable.
    angle = -(Math.atan2(dy, dx) * 180) / Math.PI;
    while (angle > 90) angle -= 180;
    while (angle <= -90) angle += 180;
    numNames = Math.max(numNames, Math.round(length / (Math.SQRT2 * Math.min(vw, vh))));
  }

  const divisions = numNames + 1;
  for (let i = 1; i < divisions; i++) {
    const x = label.start.x + (dx * i) / divisions;
    const y = label.start.y + (dy * i) / divisions;
    if (x < viewport.minX || x > viewport.maxX || y < viewport.minY || y > viewport.maxY) continue;
    addText(map, {
      kind: 'user',
      text: label.text,
      at: { x, y },
      angle,
      layer: label.layer,
      // GAL glyph size is 0.55 · textSize; the pen is textSize/12.
      size: { x: textSize * 0.55, y: textSize * 0.55 },
      thickness: textSize / 12,
      source: { kind: 'list', items: [] },
    });
  }
}

/** Paint the compiled scene in one blocking pass (small boards / exports). */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: PcbViewTransform,
  visible: ReadonlySet<string>,
  widthPx: number,
  heightPx: number,
  opts: PcbDrawOptions = DEFAULT_DRAW_OPTIONS,
  sheet?: SheetInfo,
  overlay = false,
  emphasis: Emphasis = 'none',
): void {
  for (const step of buildDrawSteps(
    ctx,
    scene,
    view,
    visible,
    widthPx,
    heightPx,
    opts,
    sheet,
    overlay,
    emphasis,
  ))
    step();
}

// ---------------------------------------------------------------------------
// DRC markers (PCB_MARKER / MARKER_BASE).

/**
 * MARKER_BASE MarkerShapeCorners (marker_base.cpp): the marker polygon in
 * arbitrary units, scaled by MarkerScale() at paint time (the last corner
 * repeats the first so the polyline reads as closed).
 */
const MARKER_SHAPE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [8, 1],
  [4, 3],
  [13, 8],
  [9, 9],
  [8, 13],
  [3, 4],
  [1, 8],
  [0, 0],
];

/** PCB_MARKER SCALING_FACTOR = pcbIUScale.mmToIU( 0.1625 ). */
const MARKER_SCALING_FACTOR = 0.1625 * MM;

/** A marker to paint (severity resolved like PCB_MARKER::GetSeverity). */
export interface DrcMarkerDraw {
  pos: { x: number; y: number };
  severity: 'error' | 'warning' | 'exclusion';
  /** Brightened/selected, repaints in LAYER_DRC_HIGHLIGHTED on top with the
   *  collision 'X' (LAYER_DRC_SHAPES), like the dialog's active violation. */
  active?: boolean;
}

/**
 * MarkerScale() in IU. pcb_painter.cpp draw(PCB_MARKER) calls
 * SetZoom( 1.0 / sqrt( gal->GetZoomFactor() ) ), so the scale is
 * SCALING_FACTOR / sqrt(zoom). The GAL zoom factor satisfies
 * worldScale = screenDPI · worldUnitLength · zoomFactor
 * (graphics_abstraction_layer.h) with worldUnitLength = 1 nm in inches
 * (1e-9 / 0.0254) and worldScale our view.scale in device px per IU
 * (1 IU = 100 nm); screenDPI is the monitor's, 96 CSS px/inch · dpr here.
 */
const markerScaleIU = (view: PcbViewTransform, dpr: number): number => {
  const zoom = (view.scale * MM * 25.4) / (96 * dpr);
  return MARKER_SCALING_FACTOR / Math.sqrt(Math.max(zoom, 1e-9));
};

const withAlpha = (color: string, a: number): string => {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : color;
};

/**
 * Paint DRC markers, mirroring pcb_painter.cpp draw(PCB_MARKER*) and the
 * GAL layer order (pcb_draw_panel_gal.cpp, top-first: DRC_HIGHLIGHTED,
 * DRC_ERROR, DRC_WARNING, DRC_EXCLUSION, MARKER_SHADOWS): every marker's
 * shadow first, then exclusion fills, warning fills, error fills, and the
 * active marker last, repainted in the highlighted color with its
 * LAYER_DRC_SHAPES collision 'X' (PCB_MARKER::GetShapes when the path is
 * degenerate). The shadow is a stroked outline in the background color at
 * alpha 0.6 (PCB_RENDER_SETTINGS::GetColor LAYER_MARKER_SHADOWS) with line
 * width MarkerScale().
 */
export function drawDrcMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly DrcMarkerDraw[],
  view: PcbViewTransform,
  dpr: number,
  colors: {
    background: string;
    drcError: string;
    drcWarning: string;
    drcExclusion: string;
    drcHighlighted: string;
  },
): void {
  if (markers.length === 0) return;
  const scale = markerScaleIU(view, dpr);
  const sx = view.flipX ? -view.scale : view.scale;

  const tracePolygon = (m: DrcMarkerDraw): void => {
    ctx.beginPath();
    MARKER_SHAPE_CORNERS.forEach(([cx, cy], i) => {
      const px = (m.pos.x + cx * scale) * sx + view.tx;
      const py = (m.pos.y + cy * scale) * view.scale + view.ty;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // LAYER_MARKER_SHADOWS pass (isShadow: stroke, width MarkerScale()).
  ctx.strokeStyle = withAlpha(colors.background, 0.6);
  ctx.lineWidth = scale * view.scale;
  ctx.lineJoin = 'round';
  for (const m of markers) {
    tracePolygon(m);
    ctx.stroke();
  }

  // Severity fills, bottom-up: exclusions, warnings, errors.
  const fillPass = (severity: DrcMarkerDraw['severity'], color: string): void => {
    ctx.fillStyle = color;
    for (const m of markers) {
      if (m.severity !== severity || m.active) continue;
      tracePolygon(m);
      ctx.fill();
    }
  };
  fillPass('exclusion', colors.drcExclusion);
  fillPass('warning', colors.drcWarning);
  fillPass('error', colors.drcError);

  // LAYER_DRC_HIGHLIGHTED + LAYER_DRC_SHAPES: the active marker lands on top
  // of any neighbouring inactive markers, in the highlighted color.
  for (const m of markers) {
    if (!m.active) continue;
    tracePolygon(m);
    ctx.fillStyle = colors.drcHighlighted;
    ctx.fill();
    // Collision 'X' at the degenerate path: diagonals of half-length
    // 2.5·MarkerScale(), hairline stroke width MarkerScale()/2.
    const len = 2.5 * scale;
    ctx.strokeStyle = colors.drcHighlighted;
    ctx.lineWidth = (scale / 2) * view.scale;
    ctx.beginPath();
    const seg = (ax: number, ay: number, bx: number, by: number): void => {
      ctx.moveTo((m.pos.x + ax) * sx + view.tx, (m.pos.y + ay) * view.scale + view.ty);
      ctx.lineTo((m.pos.x + bx) * sx + view.tx, (m.pos.y + by) * view.scale + view.ty);
    };
    seg(-len, -len, len, len);
    seg(-len, len, len, -len);
    ctx.stroke();
  }
}

export { measureText };
