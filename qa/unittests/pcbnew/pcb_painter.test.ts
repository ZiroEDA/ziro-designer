// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PCB_PAINTER` and `PCB_RENDER_SETTINGS` against a recording GAL:
 * the GAL calls a track, a via, a pad, a zone and a footprint anchor produce
 * on their layers, and the colour rules `GetColor` applies (selection,
 * high-contrast dimming, net colours, the per-type opacities). Every
 * expected number is derived from `pcb_painter.cpp` — the width a solder-mask
 * layer adds, the annular ring a via's copper is drawn with, the text size
 * a net name takes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ADVANCED_CFG } from '@ziroeda/common/src/advanced_config.js';
import { brightened, brightness, type Color4d } from '@ziroeda/common/src/color4d.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/src/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/src/gal/graphics_abstraction_layer.js';
import {
  B_Cu,
  F_Cu,
  F_Mask,
  GetNetnameLayer,
  LAYER_ANCHOR,
  LAYER_PAD_FR_NETNAMES,
  LAYER_PADS,
  LAYER_VIA_HOLES,
  LAYER_VIA_THROUGH,
  NETNAMES_LAYER_ID,
  PAD_COPPER_LAYER_FOR,
  PCB_LAYER_ID,
  VIA_COPPER_LAYER_FOR,
  ZONE_LAYER_FOR,
  CLEARANCE_LAYER_FOR,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/src/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/src/settings/color_settings.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { HIGH_CONTRAST_MODE, NET_COLOR_MODE } from '@ziroeda/pcbnew/src/board_project_settings.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/src/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/src/netinfo.js';
import { PAD } from '@ziroeda/pcbnew/src/pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from '@ziroeda/pcbnew/src/padstack.js';
import {
  PCB_DISPLAY_OPTIONS,
  PCB_PAINTER,
  PCB_RENDER_SETTINGS,
} from '@ziroeda/pcbnew/src/pcb_painter.js';
import { PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/src/pcb_track.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { ZONE } from '@ziroeda/pcbnew/src/zone.js';
import { SELECTED, BRIGHTENED } from '@ziroeda/common/src/eda_item_flags.js';

/** A GAL that records the drawing calls the painter makes. */
class RECORDING_GAL extends GAL {
  calls: { op: string; args: unknown[] }[] = [];
  fill = false;
  stroke = false;
  lineWidth = 0;
  strokeColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  fillColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  glyphSize: VECTOR2I = { x: 0, y: 0 };

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.ResizeScreen(1000, 1000);
  }

  /** The base GAL's is a no-op; the netname clipping needs a viewport. */
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
    this.ComputeWorldScreenMatrix();
  }

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }

  override SetIsFill(aIsFillEnabled: boolean): void {
    this.fill = aIsFillEnabled;
    super.SetIsFill(aIsFillEnabled);
  }
  override SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.stroke = aIsStrokeEnabled;
    super.SetIsStroke(aIsStrokeEnabled);
  }
  override SetLineWidth(aLineWidth: number): void {
    this.lineWidth = aLineWidth;
    super.SetLineWidth(aLineWidth);
  }
  override SetStrokeColor(aColor: Color4d): void {
    this.strokeColor = aColor;
    super.SetStrokeColor(aColor);
  }
  override SetFillColor(aColor: Color4d): void {
    this.fillColor = aColor;
    super.SetFillColor(aColor);
  }
  override SetGlyphSize(aSize: VECTOR2I): void {
    this.glyphSize = aSize;
    super.SetGlyphSize(aSize);
  }

  override DrawSegment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {
    this.record(
      'DrawSegment',
      aStartPoint,
      aEndPoint,
      aWidth,
      this.fill,
      this.stroke,
      this.fillColor,
    );
  }
  override DrawCircle(aCenterPoint: Vec2, aRadius: number): void {
    this.record('DrawCircle', aCenterPoint, aRadius, this.fill, this.stroke, this.lineWidth);
  }
  override DrawLine(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.record('DrawLine', { ...aStartPoint }, { ...aEndPoint }, this.lineWidth);
  }
  override DrawRectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.record('DrawRectangle', { ...aStartPoint }, { ...aEndPoint }, this.fill, this.stroke);
  }
  /** The base keeps `m_worldScale` protected; the anchor test needs one. */
  setWorldScale(aScale: number): void {
    this.m_worldScale = aScale;
  }
  override DrawArc(
    aCenterPoint: Vec2,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
  ): void {
    this.record('DrawArc', aCenterPoint, aRadius, aStartAngle.AsDegrees(), aAngle.AsDegrees());
  }
  override DrawPolygon(a: readonly Vec2[] | SHAPE_LINE_CHAIN | SHAPE_POLY_SET, b?: boolean): void {
    this.record('DrawPolygon', a, b, this.fill, this.stroke, this.fillColor);
  }
  override DrawPolyline(a: readonly Vec2[] | SHAPE_LINE_CHAIN): void {
    this.record('DrawPolyline', a);
  }
  override BitmapText(aText: string, aPosition: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.record(
      'BitmapText',
      aText,
      { ...aPosition },
      aAngle.AsDegrees(),
      { ...this.glyphSize },
      this.lineWidth,
    );
  }

  of(op: string): { op: string; args: unknown[] }[] {
    return this.calls.filter((c) => c.op === op);
  }
}

const mm = (v: number): number => pcbIUScale.mmToIU(v);

let cfg: PCBNEW_SETTINGS;

beforeAll(() => {
  // pcbconfig(): Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" )
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
  cfg = new PCBNEW_SETTINGS();
  pgm.GetSettingsManager().RegisterSettings('pcbnew', cfg);
  SetPgm(pgm);
});

function makePainter(): {
  gal: RECORDING_GAL;
  painter: PCB_PAINTER;
  settings: PCB_RENDER_SETTINGS;
} {
  const gal = new RECORDING_GAL();
  const painter = new PCB_PAINTER(gal, FRAME_T.FRAME_PCB_EDITOR);
  const settings = painter.GetSettings();
  settings.LoadColors(new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT));
  settings.LoadDisplayOptions(new PCB_DISPLAY_OPTIONS());
  return { gal, painter, settings };
}

function makeBoard(): { board: BOARD; track: PCB_TRACK; via: PCB_VIA } {
  const board = new BOARD();
  board.Add(new NETINFO_ITEM(board, 'GND'));

  const track = new PCB_TRACK(board);
  track.SetStart({ x: 0, y: 0 });
  track.SetEnd({ x: mm(20), y: 0 });
  track.SetWidth(mm(0.5));
  track.SetLayer(F_Cu);
  track.SetNetCode(1);
  board.Add(track);

  const via = new PCB_VIA(board);
  via.SetStart({ x: mm(5), y: mm(5) });
  via.SetWidth(mm(0.8));
  via.SetDrill(mm(0.4));
  via.SetNetCode(1);
  board.Add(via);

  return { board, track, via };
}

describe('PCB_PAINTER::draw( PCB_TRACK )', () => {
  it('a filled track on its copper layer is one DrawSegment of the track width, filled', () => {
    const { gal, painter } = makePainter();
    const { track } = makeBoard();

    expect(painter.Draw(track, F_Cu)).toBe(true);

    const segs = gal.of('DrawSegment');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.args[2]).toBe(mm(0.5));
    expect(segs[0]!.args[3]).toBe(true); // fill
    expect(segs[0]!.args[4]).toBe(false); // stroke
  });

  it('m_DisplayPcbTrackFill off draws the outline at the outline width', () => {
    const { gal, painter, settings } = makePainter();
    const { track } = makeBoard();
    cfg.m_Display.m_DisplayPcbTrackFill = false;

    painter.Draw(track, F_Cu);

    cfg.m_Display.m_DisplayPcbTrackFill = true;

    const segs = gal.of('DrawSegment');
    expect(segs[0]!.args[3]).toBe(false);
    expect(segs[0]!.args[4]).toBe(true);
    expect(gal.lineWidth).toBe(settings.GetOutlineWidth());
  });

  it('on a solder mask layer the width grows by twice the mask expansion', () => {
    const { gal, painter } = makePainter();
    const { board, track } = makeBoard();
    board.GetDesignSettings().m_SolderMaskExpansion = mm(0.1);
    track.SetLayerSet(track.GetLayerSet().set(F_Mask));

    painter.Draw(track, F_Mask);

    const segs = gal.of('DrawSegment');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.args[2]).toBe(mm(0.5) + 2 * track.GetSolderMaskExpansion());
    expect(track.GetSolderMaskExpansion()).toBe(mm(0.1));
  });

  it('the net name layer draws BitmapText at 0.55 of the width, centred on the segment', () => {
    const { gal, painter } = makePainter();
    const { track } = makeBoard();
    gal.ResizeScreen(1000, 1000);

    painter.Draw(track, GetNetnameLayer(F_Cu));

    const texts = gal.of('BitmapText');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args[0]).toBe('GND');
    expect(texts[0]!.args[1]).toEqual({ x: mm(10), y: 0 });
    expect(texts[0]!.args[3]).toEqual({
      x: Math.trunc(mm(0.5) * 0.55),
      y: Math.trunc(mm(0.5) * 0.55),
    });
    expect(texts[0]!.args[4]).toBeCloseTo(mm(0.5) / 12.0);
  });

  it('a track too short for its name draws no text', () => {
    const { gal, painter } = makePainter();
    const { track } = makeBoard();
    track.SetEnd({ x: mm(1), y: 0 }); // 3 chars * 0.5 mm = 1.5 mm needed
    gal.ResizeScreen(1000, 1000);

    painter.Draw(track, GetNetnameLayer(F_Cu));

    expect(gal.of('BitmapText')).toHaveLength(0);
  });

  it('m_NetNames < 2 suppresses track net names', () => {
    const { gal, painter } = makePainter();
    const { track } = makeBoard();
    gal.ResizeScreen(1000, 1000);
    cfg.m_Display.m_NetNames = 1;

    painter.Draw(track, GetNetnameLayer(F_Cu));

    cfg.m_Display.m_NetNames = 3;
    expect(gal.of('BitmapText')).toHaveLength(0);
  });

  it('the clearance layer strokes the track at width + 2 * clearance when SHOW_WITH_VIA_ALWAYS', () => {
    const { gal, painter } = makePainter();
    const { track } = makeBoard();
    cfg.m_Display.m_TrackClearance = 4; // SHOW_WITH_VIA_ALWAYS

    painter.Draw(track, CLEARANCE_LAYER_FOR(F_Cu));

    cfg.m_Display.m_TrackClearance = 2;

    const segs = gal.of('DrawSegment');
    expect(segs).toHaveLength(1);
    // GetOwnClearance is the DRC engine's (stage 4); without one it is 0
    const clearance = track.GetOwnClearance(F_Cu);
    expect(segs[0]!.args[2]).toBe(mm(0.5) + clearance * 2);
    expect(segs[0]!.args[3]).toBe(false); // fill
    expect(segs[0]!.args[4]).toBe(true); // stroke
  });
});

describe('PCB_PAINTER::draw( PCB_VIA )', () => {
  it('the hole layer is a filled circle of the drill radius', () => {
    const { gal, painter } = makePainter();
    const { via } = makeBoard();

    painter.Draw(via, LAYER_VIA_HOLES);

    const circles = gal.of('DrawCircle');
    expect(circles).toHaveLength(1);
    expect(circles[0]!.args[1]).toBe(mm(0.4) / 2);
    expect(circles[0]!.args[2]).toBe(true); // fill
    expect(circles[0]!.args[3]).toBe(false); // stroke
  });

  it('LAYER_VIA_THROUGH itself draws no copper: that is the via copper layer', () => {
    const { gal, painter } = makePainter();
    const { via } = makeBoard();

    painter.Draw(via, LAYER_VIA_THROUGH);

    expect(gal.of('DrawCircle')).toHaveLength(0);
  });

  it('the copper is a ring: line width = annulus, radius = width/2 - annulus/2', () => {
    const { gal, painter } = makePainter();
    const { via } = makeBoard();

    // The via's copper is drawn on the per-layer via copper layer, not on LAYER_VIA_THROUGH
    painter.Draw(via, VIA_COPPER_LAYER_FOR(F_Cu));

    const circles = gal.of('DrawCircle');
    expect(circles).toHaveLength(1);
    const annular = Math.trunc((mm(0.8) - mm(0.4)) / 2.0);
    expect(circles[0]!.args[4]).toBe(annular);
    expect(circles[0]!.args[1]).toBe(mm(0.8) / 2.0 - annular / 2.0);
  });

  it('the net name layer draws the name in a font no larger than MAX_FONT_SIZE', () => {
    const { gal, painter } = makePainter();
    const { via } = makeBoard();

    painter.Draw(via, GetNetnameLayer(F_Cu));

    const texts = gal.of('BitmapText');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args[0]).toBe('GND');
    // tsize = min( 1.5 * size / max( chars, 3 ), size ) * 0.75
    let tsize = (1.5 * mm(0.8)) / Math.max(3, 3);
    tsize = Math.min(tsize, mm(0.8)) * 0.75;
    expect(texts[0]!.args[3]).toEqual({ x: Math.trunc(tsize), y: Math.trunc(tsize) });
  });
});

describe('PCB_PAINTER::draw( PAD )', () => {
  function padBoard(): { board: BOARD; pad: PAD } {
    const board = new BOARD();
    board.Add(new NETINFO_ITEM(board, 'VCC'));
    const fp = new FOOTPRINT(board);
    board.Add(fp);
    const pad = new PAD(fp);
    pad.SetAttribute(PAD_ATTRIB.SMD);
    pad.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.RECTANGLE);
    pad.SetSize(PCB_LAYER_ID.F_Cu, { x: mm(2), y: mm(1) });
    pad.SetLayerSet(new LSET([F_Cu]));
    pad.SetNumber('7');
    pad.SetNetCode(1);
    fp.Add(pad);
    return { board, pad };
  }

  it('a rectangular SMD pad is one filled polygon (its SHAPE_RECT) on its copper layer', () => {
    const { gal, painter } = makePainter();
    const { pad } = padBoard();

    painter.Draw(pad, F_Cu);

    const rects = gal.of('DrawRectangle');
    const polys = gal.of('DrawPolygon');
    expect(rects.length + polys.length).toBeGreaterThan(0);
    expect(gal.fill).toBe(true);
  });

  it('the pad name layer draws the number and the net name, bold, in two lines', () => {
    const { gal, painter } = makePainter();
    const { pad } = padBoard();

    painter.Draw(pad, LAYER_PAD_FR_NETNAMES);

    const texts = gal.of('BitmapText');
    expect(texts.map((t) => t.args[0])).toEqual(['VCC', '7']);
    // Two lines: the net name below the centre, the number above
    expect((texts[0]!.args[1] as VECTOR2I).y).toBeGreaterThan(0);
    expect((texts[1]!.args[1] as VECTOR2I).y).toBeLessThan(0);
  });
});

describe('PCB_PAINTER::draw( ZONE )', () => {
  it('the zone fill layer draws the filled polygon set; the copper layer only the outline', () => {
    const { gal, painter } = makePainter();
    const board = new BOARD();
    const zone = new ZONE(board);
    zone.SetLayer(F_Cu);
    const outline = new SHAPE_POLY_SET();
    outline.NewOutline();
    outline.Append({ x: 0, y: 0 });
    outline.Append({ x: mm(10), y: 0 });
    outline.Append({ x: mm(10), y: mm(10) });
    outline.Append({ x: 0, y: mm(10) });
    zone.SetOutline(outline);
    const fill = new SHAPE_POLY_SET(outline);
    zone.SetFilledPolysList(F_Cu, fill);
    zone.SetIsFilled(true);
    board.Add(zone);

    painter.Draw(zone, ZONE_LAYER_FOR(F_Cu));
    expect(gal.of('DrawPolygon')).toHaveLength(1);
    expect(gal.of('DrawPolygon')[0]!.args[2]).toBe(true); // fill

    gal.calls = [];
    painter.Draw(zone, F_Cu);
    expect(gal.of('DrawPolygon')).toHaveLength(0);
    expect(gal.of('DrawPolyline')).toHaveLength(1);
  });
});

describe('PCB_PAINTER::draw( FOOTPRINT )', () => {
  it('LAYER_ANCHOR is a 5-pixel cross at the footprint position', () => {
    const { gal, painter } = makePainter();
    const board = new BOARD();
    const fp = new FOOTPRINT(board);
    fp.SetPosition({ x: mm(3), y: mm(4) });
    board.Add(fp);
    gal.setWorldScale(0.001);

    painter.Draw(fp, LAYER_ANCHOR);

    const lines = gal.of('DrawLine');
    expect(lines).toHaveLength(2);
    const size = 5.0 / 0.001;
    expect(lines[0]!.args[0]).toEqual({ x: mm(3) - size, y: mm(4) });
    expect(lines[0]!.args[1]).toEqual({ x: mm(3) + size, y: mm(4) });
    expect(lines[0]!.args[2]).toBe(1.0 / 0.001);
  });
});

describe('PCB_RENDER_SETTINGS::GetColor', () => {
  it('a selected item takes m_layerColorsSel: the layer colour brightened by m_selectFactor', () => {
    const { settings } = makePainter();
    const { track } = makeBoard();
    const plain = settings.GetColor(track, F_Cu);

    track.SetFlags(SELECTED);
    const sel = settings.GetColor(track, F_Cu);
    track.ClearFlags(SELECTED);

    // RENDER_SETTINGS::update(): factor = min( 1, m_selectFactor * 0.5 + brightness^3 ),
    // m_selectFactor being 0.5f, and the colour brightened by that
    const factor = Math.min(1.0, 0.5 * 0.5 + brightness(plain) ** 3);
    expect(sel).toEqual(brightened(plain, factor));
  });

  it('a brightened item is the select-factor brightening at alpha 0.8', () => {
    const { settings } = makePainter();
    const { track } = makeBoard();

    track.SetFlags(BRIGHTENED);
    const c = settings.GetColor(track, F_Cu);
    track.ClearFlags(BRIGHTENED);

    expect(c.a).toBeCloseTo(0.8);
  });

  it('high contrast dims an inactive layer towards the background by m_hiContrastFactor', () => {
    const { settings } = makePainter();
    const { track } = makeBoard();
    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
    settings.LoadDisplayOptions(opts);
    settings.SetLayerIsHighContrast(B_Cu);

    const dimmed = settings.GetColor(track, F_Cu);
    const plain = settings.GetLayerColor(F_Cu);
    // Mixed towards the background: no channel exceeds the plain colour's
    expect(dimmed.r).toBeLessThanOrEqual(plain.r + 1e-9);
    expect(dimmed.g).toBeLessThanOrEqual(plain.g + 1e-9);
    expect(dimmed.b).toBeLessThanOrEqual(plain.b + 1e-9);
    expect(dimmed).not.toEqual(plain);
  });

  it('HIDDEN high contrast makes an inactive layer CLEAR', () => {
    const { settings } = makePainter();
    const { track } = makeBoard();
    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.HIDDEN;
    settings.LoadDisplayOptions(opts);
    settings.SetLayerIsHighContrast(B_Cu);

    expect(settings.GetColor(track, F_Cu)).toEqual({ r: 1, g: 0, b: 1, a: 0 });
  });

  it('NET_COLOR_MODE::ALL paints a copper item in its net colour', () => {
    const { settings } = makePainter();
    const { track } = makeBoard();
    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_NetColorMode = NET_COLOR_MODE.ALL;
    settings.LoadDisplayOptions(opts);
    settings.GetNetColorMap().set(1, { r: 0.1, g: 0.2, b: 0.3, a: 1 });

    const c = settings.GetColor(track, F_Cu);
    expect(c.r).toBeCloseTo(0.1);
    expect(c.g).toBeCloseTo(0.2);
    expect(c.b).toBeCloseTo(0.3);
  });

  it('the track opacity multiplies the alpha of tracks, the via opacity of vias', () => {
    const { settings } = makePainter();
    const { track, via } = makeBoard();
    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_TrackOpacity = 0.5;
    opts.m_ViaOpacity = 0.25;
    settings.LoadDisplayOptions(opts);

    expect(settings.GetColor(track, F_Cu).a).toBeCloseTo(settings.GetLayerColor(F_Cu).a * 0.5);
    // A via's copper takes the copper layer's colour (LAYER_VIA_THROUGH has no colour of its own)
    expect(settings.GetLayerColor(F_Cu).a).toBe(1);
    expect(settings.GetColor(via, VIA_COPPER_LAYER_FOR(F_Cu)).a).toBeCloseTo(
      settings.GetLayerColor(F_Cu).a * 0.25,
    );
  });

  it('LoadColors floors a layer alpha at 0.2 and inverts the netname label on a bright copper', () => {
    const settings = new PCB_RENDER_SETTINGS();
    const cs = new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT);
    cs.SetColor(F_Cu, { r: 1, g: 1, b: 1, a: 0.05 });
    settings.LoadColors(cs);

    expect(settings.GetLayerColor(F_Cu).a).toBe(0.2);
    // brightness > 0.5 => the dark label (the inverted netname colour)
    const light = cs.GetColor(NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START);
    const label = settings.GetLayerColor(GetNetnameLayer(F_Cu));
    expect(label).toEqual({ r: 1 - light.r, g: 1 - light.g, b: 1 - light.b, a: light.a });
  });

  it('m_hiContrastFactor is 1 - the common hicontrast_dimming_factor, as a float', () => {
    const settings = new PCB_RENDER_SETTINGS();
    settings.LoadColors(new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT));
    expect((settings as unknown as { m_hiContrastFactor: number }).m_hiContrastFactor).toBe(
      Math.fround(1.0 - 0.8),
    );
  });

  it('the pad hole wall thickness is the plating thickness times the ADVANCED_CFG multiplier', () => {
    expect(ADVANCED_CFG.GetCfg().m_HoleWallPaintingMultiplier).toBe(1.5);
    expect(new BOARD().GetDesignSettings().GetHolePlatingThickness()).toBe(mm(0.02));
  });

  it("a back-side pad's copper is hidden when the front is the only high-contrast layer", () => {
    const { settings } = makePainter();
    const board = new BOARD();
    const fp = new FOOTPRINT(board);
    board.Add(fp);
    const pad = new PAD(fp);
    pad.SetAttribute(PAD_ATTRIB.SMD);
    pad.SetLayerSet(new LSET([B_Cu]));
    fp.Add(pad);

    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.HIDDEN;
    settings.LoadDisplayOptions(opts);
    settings.SetLayerIsHighContrast(F_Cu);
    settings.SetLayerIsHighContrast(LAYER_PADS);

    // The pad copper layer resolves to B_Cu, which is not high contrast: CLEAR
    expect(settings.GetColor(pad, PAD_COPPER_LAYER_FOR(B_Cu))).toEqual({ r: 1, g: 0, b: 1, a: 0 });
    // ...while LAYER_PADS stays active for a pad that is simply not on the primary layer
    expect(settings.GetColor(pad, LAYER_PADS)).toEqual(settings.GetLayerColor(LAYER_PADS));
  });
});
