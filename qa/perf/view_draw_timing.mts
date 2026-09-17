// What the KiCad view path costs on a board, phase by phase, on a mock GL:
// DisplayBoard (CacheTriangulation + VIEW::Add), the first UpdateItems (the
// painter caching every item into the vertex containers), a full-board
// Redraw, then a pan and a zoom (what a frame costs while the board is on
// screen). CPU side only; the GL calls are recorded, not executed.
//
//   NODE_OPTIONS=--max-old-space-size=12000 npx tsx qa/perf/view_draw_timing.mts <board.kicad_pcb> [--profile]
import { readFileSync, writeSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/src/gal/gal_display_options.js';
import { GAL_DRAWING_CONTEXT } from '@ziroeda/common/src/gal/graphics_abstraction_layer.js';
import { RENDER_TARGET } from '@ziroeda/common/src/gal/definitions.js';
import { OPENGL_GAL, type OPENGL_GAL_CANVAS } from '@ziroeda/common/src/gal/opengl/opengl_gal.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/src/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/src/settings/color_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { GAL_LAYER_ORDER } from '@ziroeda/pcbnew/src/pcb_draw_panel_gal.js';
import { PCB_DISPLAY_OPTIONS, PCB_PAINTER } from '@ziroeda/pcbnew/src/pcb_painter.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/src/pcb_view.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { RATSNEST_VIEW_ITEM } from '@ziroeda/pcbnew/src/ratsnest/ratsnest_view_item.js';
import { VIEW } from '@ziroeda/common/src/view/view.js';
import {
  BITMAP_LAYER_FOR,
  CLEARANCE_LAYER_FOR,
  GetNetnameLayer,
  IsCopperLayer,
  IsNetnameLayer,
  IsNonCopperLayer,
  LAYER_ANCHOR,
  LAYER_CONFLICTS_SHADOW,
  LAYER_DRAWINGSHEET,
  LAYER_GP_OVERLAY,
  LAYER_RATSNEST,
  LAYER_SELECT_OVERLAY,
  PAD_COPPER_LAYER_FOR,
  POINT_LAYER_FOR,
  VIA_COPPER_LAYER_FOR,
  ZONE_LAYER_FOR,
} from '@ziroeda/common/src/layer_ids.js';

const out = (s: string) => writeSync(1, `${s}\n`);
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;

/** The GL calls, counted. */
const GL = {
  DEPTH_BUFFER_BIT: 0x100,
  STENCIL_BUFFER_BIT: 0x400,
  COLOR_BUFFER_BIT: 0x4000,
  TRIANGLES: 4,
  LINES: 1,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  UNSIGNED_BYTE: 0x1401,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  STREAM_DRAW: 0x88e0,
  FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  COLOR_ATTACHMENT0: 0x8ce0,
  TEXTURE_2D: 0x0de1,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  VERSION: 0x1f02,
  VIEWPORT: 0x0ba2,
  DEPTH_WRITEMASK: 0x0b72,
  CURRENT_PROGRAM: 0x8b8d,
  NO_ERROR: 0,
  TEXTURE0: 0x84c0,
  RGB8: 0x8051,
  RGBA8: 0x8058,
  RGB: 0x1907,
  RGBA: 0x1908,
  LINEAR: 0x2601,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  STENCIL_TEST: 0x0b90,
};
const counts = { bufferData: 0, bufferBytes: 0, drawElements: 0, drawArrays: 0, drawnIndices: 0 };
const mockGl = new Proxy(
  {
    ...GL,
    getError: () => 0,
    getParameter: (p: number) => {
      switch (p) {
        case GL.MAX_RENDERBUFFER_SIZE:
        case GL.MAX_TEXTURE_SIZE:
          return 16384;
        case GL.MAX_COLOR_ATTACHMENTS:
          return 8;
        case GL.VERSION:
          return 'WebGL 2.0 (mock)';
        case GL.VIEWPORT:
          return new Int32Array([0, 0, 1600, 1000]);
        case GL.DEPTH_WRITEMASK:
          return true;
        default:
          return 0;
      }
    },
    bufferData: (_t: number, data: ArrayBufferView | number) => {
      counts.bufferData++;
      counts.bufferBytes += typeof data === 'number' ? data : data.byteLength;
    },
    drawElements: (_m: number, count: number) => {
      counts.drawElements++;
      counts.drawnIndices += count;
    },
    drawArrays: () => {
      counts.drawArrays++;
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    isShader: () => true,
    isTexture: () => true,
    isEnabled: () => true,
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    getUniformLocation: (_p: object, name: string) => ({ name }),
    getAttribLocation: (_p: object, name: string) =>
      ['a_position', 'a_color', 'a_shaderParams', 'a_texCoord'].indexOf(name),
  } as Record<string, unknown>,
  { get: (t, k: string) => (k in t ? t[k] : k.startsWith('create') ? () => ({}) : () => {}) },
);
const canvas: OPENGL_GAL_CANVAS = {
  gl: mockGl as unknown as WebGL2RenderingContext,
  GetScaleFactor: () => 1,
  GetNativePixelSize: () => ({ x: 1600, y: 1000 }),
  GetClientSize: () => ({ x: 1600, y: 1000 }),
  IsShownOnScreen: () => true,
  Refresh: () => {},
  SetCursor: () => {},
  PostPaint: () => {},
  GetBitmapFontImage: () => ({}) as unknown as TexImageSource,
};

await EMBEDDED_FILES.InitCodec();
const pgm = new PGM_BASE({
  m_Appearance: {
    show_scrollbars: true,
    zoom_correction_factor: 1,
    hicontrast_dimming_factor: 0.8,
  },
  m_Input: {
    focus_follow_sch_pcb: false,
    auto_pan: false,
    auto_pan_acceleration: 5,
    center_on_zoom: true,
    immediate_actions: true,
    warp_mouse_on_move: true,
    horizontal_pan: false,
    hotkey_feedback: true,
    zoom_acceleration: false,
    zoom_speed: 1,
    zoom_speed_auto: true,
    scroll_modifier_zoom: 0,
    scroll_modifier_pan_h: 308,
    scroll_modifier_pan_v: 306,
    motion_pan_modifier: 0,
    drag_left: -1,
    drag_middle: 2,
    drag_right: 2,
    reverse_scroll_zoom: false,
    reverse_scroll_pan_h: false,
  },
});
pgm.GetSettingsManager().RegisterSettings('pcbnew', new PCBNEW_SETTINGS());
SetPgm(pgm);

const f = process.argv[2]!;
const text = readFileSync(f, 'utf8');

let t = performance.now();
const board = new PCB_IO_KICAD_SEXPR_PARSER(text, f).Parse() as BOARD;
out(`parse ${ms(t)}`);

t = performance.now();
board.BuildConnectivity();
out(`BuildConnectivity ${ms(t)}`);

// PCB_DRAW_PANEL_GAL's construction, without the panel
const gal = new OPENGL_GAL(new GAL_DISPLAY_OPTIONS(), canvas);
gal.ResizeScreen(1600, 1000);
const view = new PCB_VIEW();
view.SetGAL(gal);
const painter = new PCB_PAINTER(gal, FRAME_T.FRAME_PCB_EDITOR);
view.SetPainter(painter);
painter.GetSettings().LoadColors(new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT));
painter.GetSettings().LoadDisplayOptions(new PCB_DISPLAY_OPTIONS());
view.ReverseDrawOrder(true);
// setDefaultLayerOrder / setDefaultLayerDeps
for (let i = 0; i < GAL_LAYER_ORDER.length; ++i) view.SetLayerOrder(GAL_LAYER_ORDER[i]!, i, false);
view.SortOrderedLayers();
for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++) view.SetLayerTarget(i, RENDER_TARGET.TARGET_CACHED);
for (const layer of GAL_LAYER_ORDER) {
  if (IsCopperLayer(layer)) {
    view.SetRequired(ZONE_LAYER_FOR(layer), layer);
    view.SetRequired(PAD_COPPER_LAYER_FOR(layer), layer);
    view.SetRequired(VIA_COPPER_LAYER_FOR(layer), layer);
    view.SetRequired(CLEARANCE_LAYER_FOR(layer), layer);
    view.SetRequired(POINT_LAYER_FOR(layer), layer);
    view.SetRequired(BITMAP_LAYER_FOR(layer), layer);
    view.SetLayerTarget(BITMAP_LAYER_FOR(layer), RENDER_TARGET.TARGET_NONCACHED);
    view.SetRequired(GetNetnameLayer(layer), layer);
  } else if (IsNonCopperLayer(layer)) {
    view.SetRequired(POINT_LAYER_FOR(layer), layer);
    view.SetRequired(ZONE_LAYER_FOR(layer), layer);
    view.SetLayerTarget(BITMAP_LAYER_FOR(layer), RENDER_TARGET.TARGET_NONCACHED);
    view.SetRequired(BITMAP_LAYER_FOR(layer), layer);
  } else if (IsNetnameLayer(layer)) view.SetLayerDisplayOnly(layer);
}
view.SetLayerTarget(LAYER_ANCHOR, RENDER_TARGET.TARGET_NONCACHED);
view.SetLayerTarget(LAYER_CONFLICTS_SHADOW, RENDER_TARGET.TARGET_OVERLAY);
view.SetLayerTarget(LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
view.SetLayerTarget(LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
view.SetLayerTarget(LAYER_RATSNEST, RENDER_TARGET.TARGET_OVERLAY);
view.SetLayerTarget(LAYER_DRAWINGSHEET, RENDER_TARGET.TARGET_NONCACHED);
for (let i = 0; i < 128; ++i) view.SetLayerVisible(i, board.IsLayerVisible(i));

t = performance.now();
board.CacheTriangulation(null);
out(`CacheTriangulation ${ms(t)}`);

t = performance.now();
for (const item of board.GetItemSet()) view.Add(item);
board.UpdateBoardOutline();
view.Add(board.BoardOutline());
view.Add(new RATSNEST_VIEW_ITEM(board.GetConnectivity()));
out(`VIEW::Add x ${board.GetItemSet().length} ${ms(t)}`);

const bbox = board.GetBoardEdgesBoundingBox();
const fitScale = Math.min(1600 / bbox.GetWidth(), 1000 / bbox.GetHeight()) / gal.GetWorldScale();
view.SetScale(fitScale);
view.SetCenter(bbox.Centre());

// Count the R-tree visits a frame makes
import { VIEW_RTREE } from '@ziroeda/common/src/view/view_rtree.js';
const visits = { queries: 0, visits: 0 };
const origQuery = VIEW_RTREE.prototype.Query;
VIEW_RTREE.prototype.Query = function (this: VIEW_RTREE, aBounds, aVisitor) {
  visits.queries++;
  return origQuery.call(this, aBounds, (item) => {
    visits.visits++;
    return aVisitor(item);
  });
};

const frame = (name: string, allowSkip = false): void => {
  const t0 = performance.now();
  const c0 = { ...counts };
  const v0 = { ...visits };
  const dirty = view.IsDirty();
  const pending = view.HasPendingItemUpdates();
  if (pending) view.UpdateItems();
  const t1 = performance.now();
  GAL_DRAWING_CONTEXT(gal, () => {
    gal.ClearScreen();
    if (view.IsDirty()) {
      view.ClearTargets();
      if (view.IsTargetDirty(RENDER_TARGET.TARGET_NONCACHED)) gal.DrawGrid();
      view.Redraw();
    }
    gal.DrawCursor({ x: 0, y: 0 });
  });
  const t2 = performance.now();
  out(
    `${name.padEnd(34)} update ${(t1 - t0).toFixed(0).padStart(6)} ms  draw ${(t2 - t1).toFixed(0).padStart(6)} ms  ` +
      `(dirty ${dirty}, pending ${pending}; bufferData ${counts.bufferData - c0.bufferData} / ${((counts.bufferBytes - c0.bufferBytes) / 1048576).toFixed(1)} MB, ` +
      `drawElements ${counts.drawElements - c0.drawElements} / ${counts.drawnIndices - c0.drawnIndices} idx, drawArrays ${counts.drawArrays - c0.drawArrays}; ` +
      `rtree queries ${visits.queries - v0.queries}, visits ${visits.visits - v0.visits})`,
  );
  void allowSkip;
};

const profiling = process.argv.includes('--profile');
const { Session } = await import('node:inspector');
const { writeFileSync } = await import('node:fs');
const profile = async (name: string, fn: () => void): Promise<void> => {
  if (!profiling) {
    fn();
    return;
  }
  const s = new Session();
  s.connect();
  await new Promise<void>((r) => s.post('Profiler.enable', () => r()));
  await new Promise<void>((r) => s.post('Profiler.start', () => r()));
  fn();
  await new Promise<void>((r) =>
    s.post('Profiler.stop', (_e, res) => {
      writeFileSync(`${name}.cpuprofile`, JSON.stringify(res.profile));
      out(`profile: ${name}.cpuprofile`);
      r();
    }),
  );
  s.disconnect();
};
await profile('view_first_frame', () => frame('first frame (cache everything)'));
frame('second frame (nothing changed)');
const c = view.GetCenter();
view.SetCenter({ x: c.x + bbox.GetWidth() / 20, y: c.y });
for (let i = 0; i < 4; i++) {
  view.SetCenter({ x: view.GetCenter().x + bbox.GetWidth() / 50, y: c.y });
  frame('pan 2% (warm-up)');
}
await profile('view_pan_frame', () => {
  for (let i = 0; i < 10; i++) {
    view.SetCenter({ x: view.GetCenter().x + bbox.GetWidth() / 50, y: c.y });
    frame('pan 2% of the board');
  }
});
view.SetScale(view.GetScale() * 2, view.GetCenter());
frame('zoom x2');
view.SetScale(view.GetScale() * 8, view.GetCenter());
frame('zoom x16 (a corner)');
const item = board.Tracks()[0];
if (item) {
  view.Update(item);
  frame('one track updated');
}
view.RecacheAllItems();
frame('RecacheAllItems (SetDisplayOptions)');
out(`heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`);
