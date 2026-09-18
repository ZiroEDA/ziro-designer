// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board editor's canvas, as `PCB_EDIT_FRAME`'s constructor builds it:
 * the `PCB_DRAW_PANEL_GAL` over the `<canvas>` React mounts, the PGM_BASE
 * with the common settings and the colour themes the panel reads, and the
 * bridge from the editor's React state (view transform, layer visibility,
 * display options, the highlighted net) into the frame, the view and the
 * render settings — the calls the toolbar handlers and the appearance panel
 * make upstream.
 */

import type {
  DRAW_PANEL_GAL_WINDOW,
  EDA_DRAW_PANEL_GAL,
} from '@ziroeda/common/src/draw_panel_gal.js';
import { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/src/drawing_sheet/ds_proxy_view_item.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/src/view/view_item.js';
import type { WksSheet } from '@ziroeda/common/src/drawing_sheet/types.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { KICURSOR } from '@ziroeda/common/src/gal/cursors.js';
import type { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/src/mouse_drag_action.js';
import {
  type COMMON_SETTINGS_INPUT,
  type COMMON_SETTINGS_LIKE,
  PGM_BASE,
  PgmOrNull,
  SetPgm,
} from '@ziroeda/common/src/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/src/settings/color_settings.js';
import { WXK } from '@ziroeda/common/src/wx/wx_event.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { parseBoardItemId } from '@ziroeda/pcbnew/src/edit-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/src/board_item.js';
import { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/src/pcb_draw_panel_gal.js';
import type { PCB_DISPLAY_OPTIONS } from '@ziroeda/pcbnew/src/pcb_painter.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/src/pcb_screen.js';
import { pcbnewSettingsOf, type PCB_EDIT_FRAME } from './pcb_edit_frame.js';
import { type KiCursor, kiCursor } from '../../ui/kicursors.js';
import { colorSettingsById } from '../../prefs/color_settings_list.js';
import { type MouseDragAction, type ScrollModifier, settings } from '../../prefs/settings.js';

// ---------------------------------------------------------------------------
// PGM_BASE: the common settings and the colour themes
// ---------------------------------------------------------------------------

/** `panel_mouse_settings.cpp:113-119`: the four choices are `WXK_*` codes. */
const MODIFIER_CODES: Readonly<Record<ScrollModifier, number>> = {
  none: WXK.WXK_NONE,
  ctrl: WXK.WXK_CONTROL,
  shift: WXK.WXK_SHIFT,
  alt: WXK.WXK_ALT,
};

/** `MOUSE_DRAG_ACTION`, as `common.json` encodes it. */
const DRAG_ACTIONS: Readonly<Record<MouseDragAction, MOUSE_DRAG_ACTION>> = {
  drag_any: MOUSE_DRAG_ACTION.DRAG_ANY,
  drag_selected: MOUSE_DRAG_ACTION.DRAG_SELECTED,
  select: MOUSE_DRAG_ACTION.SELECT,
  zoom: MOUSE_DRAG_ACTION.ZOOM,
  pan: MOUSE_DRAG_ACTION.PAN,
  none: MOUSE_DRAG_ACTION.NONE,
};

/** `COMMON_SETTINGS`, from the designer's `common.json` slice. */
export function commonSettingsOf(): COMMON_SETTINGS_LIKE {
  const c = settings.common;
  const i = c.input;
  const m_Input: COMMON_SETTINGS_INPUT = {
    focus_follow_sch_pcb: i.focus_follow_sch_pcb,
    auto_pan: i.auto_pan,
    auto_pan_acceleration: i.auto_pan_acceleration,
    center_on_zoom: i.center_on_zoom,
    immediate_actions: i.immediate_actions,
    warp_mouse_on_move: i.warp_mouse_on_move,
    horizontal_pan: i.horizontal_pan,
    hotkey_feedback: i.hotkey_feedback,
    zoom_acceleration: i.zoom_acceleration,
    zoom_speed: i.zoom_speed,
    zoom_speed_auto: i.zoom_speed_auto,
    scroll_modifier_zoom: MODIFIER_CODES[i.scroll_modifier_zoom],
    scroll_modifier_pan_h: MODIFIER_CODES[i.scroll_modifier_pan_h],
    scroll_modifier_pan_v: MODIFIER_CODES[i.scroll_modifier_pan_v],
    motion_pan_modifier: MODIFIER_CODES[i.motion_pan_modifier],
    drag_left: DRAG_ACTIONS[i.mouse_left],
    drag_middle: DRAG_ACTIONS[i.mouse_middle],
    drag_right: DRAG_ACTIONS[i.mouse_right],
    reverse_scroll_zoom: i.reverse_scroll_zoom,
    reverse_scroll_pan_h: i.reverse_scroll_pan_h,
  };

  return {
    m_Appearance: {
      show_scrollbars: c.appearance.show_scrollbars,
      zoom_correction_factor: c.appearance.zoom_correction_factor,
      hicontrast_dimming_factor: c.appearance.hicontrast_dimming_factor,
    },
    m_Input,
  };
}

/**
 * `SETTINGS_MANAGER::loadColorSettingsByName`'s file: a theme installed with
 * a file (`colorSettingsById`), or the "User" theme / one "New Theme..." made,
 * whose stored rows are the `board.*` parameter paths `COLOR_SETTINGS`
 * registers — a `JSON_SETTINGS::Load` over those.
 */
function loadColorSettingsByName(aName: string): COLOR_SETTINGS | null {
  const made = settings.userThemes[aName];

  if (aName === 'user' || made) {
    const cs = new COLOR_SETTINGS(aName);
    cs.SetName(made ? made.name : 'User');
    cs.LoadFromJsonPaths(made ? made.colors : settings.userColors);
    return cs;
  }

  const contents = colorSettingsById(aName);

  if (!contents) return null;

  const cs = new COLOR_SETTINGS(aName);
  cs.LoadFromContents(contents);
  return cs;
}

/**
 * `PGM_BASE::InitPgm` as far as the canvas needs it: install the program
 * object with the common settings, the colour-theme loader and the pcbnew
 * app settings. Idempotent; the settings objects are refreshed in place on a
 * later call so the readers (`pcbconfig()`, `Pgm().GetCommonSettings()`) see
 * a changed preference.
 */
export function installPgm(): PGM_BASE {
  let pgm = PgmOrNull();

  if (!pgm) {
    pgm = new PGM_BASE(commonSettingsOf());
    pgm.GetSettingsManager().SetColorSettingsLoader(loadColorSettingsByName);
    SetPgm(pgm);
  } else {
    pgm.SetCommonSettings(commonSettingsOf());
  }

  // `Kiface().KifaceSettings()` for pcbnew: the PCBNEW_SETTINGS the painter reads
  pgm.GetSettingsManager().RegisterSettings('pcbnew', pcbnewSettingsOf(settings.pcbnew));

  return pgm;
}

/**
 * The colour theme a frame paints with was edited (the Colors page, or a
 * made theme): reload its rows into the registered COLOR_SETTINGS, as the
 * panel's `SetColor` calls would have written them.
 */
export function reloadUserColorSettings(): void {
  const mgr = PgmOrNull()?.GetSettingsManager();

  if (!mgr) return;

  for (const cs of mgr.GetColorSettingsList()) {
    const name = cs.GetFilename();
    const made = settings.userThemes[name];

    if (name === 'user') cs.LoadFromJsonPaths(settings.userColors);
    else if (made) {
      cs.SetName(made.name);
      cs.LoadFromJsonPaths(made.colors);
    }
  }
}

// ---------------------------------------------------------------------------
// The wxWindow the panel adopts
// ---------------------------------------------------------------------------

/** `KICURSOR` -> the designer's `CURSOR_STORE` name. */
function cursorName(aCursor: KICURSOR): KiCursor {
  const name = KICURSOR[aCursor] ?? 'ARROW';
  const base = name.replace(/64$/, '');

  switch (base) {
    case 'DEFAULT':
      return 'ARROW';
    default:
      return base as KiCursor;
  }
}

/** The bitmap font atlas the GAL uploads, decoded once. */
let s_fontImage: Promise<ImageBitmap> | null = null;

export function loadBitmapFontImage(): Promise<ImageBitmap> {
  s_fontImage ??= (async () => {
    const url = new URL('../../../../common/src/gal/opengl/bitmap_font_img.png', import.meta.url)
      .href;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`bitmap font atlas: ${response.status}`);

    // No colour management and no premultiplication: the three channels are
    // signed distances, not colours, and either transform would corrupt them.
    return await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  })();

  return s_fontImage;
}

/**
 * `PCB_EDIT_FRAME::PCB_EDIT_FRAME`'s canvas construction: the panel on the
 * element, the frame's screen and canvas, the drawing sheet proxy item.
 *
 * @return the panel, or null when WebGL2 is unavailable (there is no Cairo
 *         here; the editor keeps its raster path for that).
 */
export function createPcbDrawPanel(
  aFrame: PCB_EDIT_FRAME,
  aCanvas: HTMLCanvasElement,
  aFontImage: ImageBitmap,
): PCB_DRAW_PANEL_GAL | null {
  const window: DRAW_PANEL_GAL_WINDOW = {
    canvas: aCanvas,
    GetCursorCss: (aCursor: KICURSOR): string => kiCursor(cursorName(aCursor)),
    GetBitmapFontImage: (): TexImageSource => aFontImage,
  };

  let panel: PCB_DRAW_PANEL_GAL;

  try {
    panel = new PCB_DRAW_PANEL_GAL(aFrame, window, aFrame.GetGalDisplayOptions());
  } catch (err) {
    console.warn(`Could not use OpenGL: ${(err as Error).message}`);
    return null;
  }

  if (panel.GetBackend() !== 1 /* GAL_TYPE_OPENGL */) {
    panel.Destroy();
    return null;
  }

  aFrame.SetCanvas(panel);

  // `PCB_BASE_FRAME::LoadSettings` (pcb_base_frame.cpp:850): the painter's
  // highlight and select factors come from the app settings' graphics
  // section - select_factor is 0.75 there, not RENDER_SETTINGS' own 0.5.
  {
    const cfg = aFrame.GetPcbNewSettings();
    const rs = panel.GetView().GetPainter().GetSettings();

    rs.SetHighlightFactor(cfg.m_Graphics.highlight_factor);
    rs.SetSelectFactor(cfg.m_Graphics.select_factor);
  }

  // SetScreen( new PCB_SCREEN( GetPageSettings().GetSizeIU( pcbIUScale.IU_PER_MILS ) ) ):
  // the A4 the frame starts with; attachBoardToPanel re-sizes it for the board
  aFrame.SetScreen(new PCB_SCREEN({ x: pcbIUScale.milsToIU(11693), y: pcbIUScale.milsToIU(8268) }));

  // Must be set after calling SetScreen()
  panel.GetGAL().SetAxesEnabled(false);

  return panel;
}

/**
 * The parts of the frame's construction and `OpenProjectFiles` that read the
 * board: the screen's page size and the drawing sheet proxy item
 * (`new DS_PROXY_VIEW_ITEM( pcbIUScale, &m_pcb->GetPageSettings(),
 * m_pcb->GetProject(), &m_pcb->GetTitleBlock(), m_pcb->GetProperties() )`).
 * The board draws KiCad's default sheet until PROJECT carries the
 * project's own.
 */
export function attachBoardToPanel(
  aFrame: PCB_EDIT_FRAME,
  aPanel: PCB_DRAW_PANEL_GAL,
  aBoard: BOARD,
): void {
  const screen = aFrame.GetScreen();

  if (screen) screen.InitDataPoints(aBoard.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS));

  const drawingSheet = new DS_PROXY_VIEW_ITEM(
    pcbIUScale,
    aBoard.GetPageSettings(),
    { GetDrawingSheet: (): WksSheet | null => null },
    aBoard.GetTitleBlock(),
    aBoard.GetProperties(),
  );
  drawingSheet.SetSheetName(aBoard.GetFileName());
  drawingSheet.SetFileName(aBoard.GetFileName());
  aPanel.SetDrawingSheet(drawingSheet);
}

/** The BOARD_ITEMs behind the editor's item ids (`kind:index[:sub]`). */
export function kItemsForIds(aBoard: Board, aIds: Iterable<string>): BOARD_ITEM[] {
  const out: BOARD_ITEM[] = [];

  for (const id of aIds) {
    const r = parseBoardItemId(id);

    if (!r) continue;

    let k: BOARD_ITEM | undefined;

    switch (r.kind) {
      case 'track':
        k = aBoard.tracks[r.index]?.k;
        break;
      case 'arc':
        k = aBoard.arcs[r.index]?.k;
        break;
      case 'via':
        k = aBoard.vias[r.index]?.k;
        break;
      case 'footprint':
        k = aBoard.footprints[r.index]?.k;
        break;
      case 'zone':
        k = aBoard.zones[r.index]?.k;
        break;
      case 'shape':
        k = aBoard.shapes[r.index]?.k;
        break;
      case 'text':
        k = aBoard.texts[r.index]?.k;
        break;
      case 'textbox':
        k = aBoard.textBoxes[r.index]?.k;
        break;
      case 'table':
        k = aBoard.tables[r.index]?.k;
        break;
      case 'image':
        k = aBoard.images[r.index]?.k;
        break;
      case 'dimension':
        k = aBoard.dimensions[r.index]?.k;
        break;
      case 'point':
        k = aBoard.points[r.index]?.k;
        break;
      case 'barcode':
        k = aBoard.barcodes[r.index]?.k;
        break;
      case 'group':
        k = aBoard.groups[r.index]?.k;
        break;
      case 'fptext':
        k = aBoard.footprints[r.index]?.texts[r.sub ?? 0]?.k;
        break;
      case 'pad':
        k = aBoard.footprints[r.index]?.pads[r.sub ?? 0]?.k;
        break;
    }

    if (k) out.push(k);
  }

  return out;
}

// ---------------------------------------------------------------------------
// The editor's state, into the frame
// ---------------------------------------------------------------------------

/** The editor's view: device pixels per IU, the device-pixel translation, the flip. */
export interface EditorView {
  scale: number;
  tx: number;
  ty: number;
  flipX: boolean;
}

/**
 * The editor's view transform into the VIEW: `VIEW::SetScale` / `SetCenter`
 * / `SetMirror`. The VIEW's scale is the GAL zoom factor, whose world scale
 * is `zoom * worldUnitLength * screenDPI` logical pixels per IU; the
 * editor's is device pixels per IU.
 */
export function syncViewTransform(
  aPanel: EDA_DRAW_PANEL_GAL,
  aView: EditorView,
  aDevicePixelRatio: number,
): void {
  const view = aPanel.GetView();
  const gal = aPanel.GetGAL();
  const screen = gal.GetScreenPixelSize();

  if (screen.x <= 0 || screen.y <= 0) return;

  // gal.GetWorldScale() / zoom is worldUnitLength * DPI, the factor between the two scales
  const zoomNow = view.GetScale();
  const unitScale = zoomNow > 0 ? gal.GetWorldScale() / zoomNow : 0;

  if (!(unitScale > 0)) return;

  const zoom = aView.scale / aDevicePixelRatio / unitScale;

  if (view.IsMirroredX() !== aView.flipX) view.SetMirror(aView.flipX, view.IsMirroredY());

  if (Math.abs(view.GetScale() - zoom) > zoom * 1e-9) view.SetScale(zoom);

  // The world point under the screen centre — `ComputeWorldScreenMatrix`'s
  // integer half of the screen size — in the editor's device-pixel transform
  const cx = Math.trunc(screen.x / 2) * aDevicePixelRatio;
  const cy = Math.trunc(screen.y / 2) * aDevicePixelRatio;
  const sx = aView.flipX ? -aView.scale : aView.scale;
  const center = { x: (cx - aView.tx) / sx, y: (cy - aView.ty) / aView.scale };
  const now = view.GetCenter();

  if (Math.abs(now.x - center.x) > 1e-6 || Math.abs(now.y - center.y) > 1e-6)
    view.SetCenter(center);
}

/** The editor's Appearance state, as `BOARD` and the render settings take it. */
export interface EditorDisplayState {
  /** The visible board layers, by name (`LAYER_*`, "F.Cu"...). */
  visibleLayers: ReadonlySet<PCB_LAYER_ID>;
  /** The Objects tab: each GAL layer's visibility. */
  visibleElements: ReadonlyMap<GAL_LAYER_ID, boolean>;
  displayOptions: PCB_DISPLAY_OPTIONS;
  activeLayer: PCB_LAYER_ID;
  /** The highlighted nets (BOARD_INSPECTION_TOOL::HighlightNet), empty for none. */
  highlightNets: ReadonlySet<number>;
  /** `COLOR_SETTINGS::GetFilename()` of the theme the frame paints with. */
  colorTheme: string;
}

/**
 * Push the editor's Appearance state into the board, the view and the render
 * settings, as the layer widget, the toolbar and the inspection tool would.
 */
export function applyDisplayState(
  aFrame: PCB_EDIT_FRAME,
  aPanel: PCB_DRAW_PANEL_GAL,
  aBoard: BOARD,
  aState: EditorDisplayState,
  aPrev: EditorDisplayState | null,
): void {
  const view = aPanel.GetView();
  const settings = view.GetPainter().GetSettings();

  // Layer visibility: BOARD::SetVisibleLayers + PCB_DRAW_PANEL_GAL::SyncLayersVisibility
  const visibilityChanged =
    !aPrev ||
    !setsEqual(aPrev.visibleLayers, aState.visibleLayers) ||
    !mapsEqual(aPrev.visibleElements, aState.visibleElements);

  if (visibilityChanged) {
    const visible = new LSET();

    for (const layer of aState.visibleLayers) visible.set(layer);

    aBoard.SetVisibleLayers(visible);

    for (const [layer, on] of aState.visibleElements) aBoard.SetElementVisibility(layer, on);

    aPanel.SyncLayersVisibility(aBoard);
  }

  // The theme: PCB_DRAW_PANEL_GAL::UpdateColors reads the frame's COLOR_SETTINGS
  if (!aPrev || aPrev.colorTheme !== aState.colorTheme) {
    aPanel.UpdateColors();
    view.UpdateAllLayersColor();
  }

  // The active layer: PCB_EDIT_FRAME::SetActiveLayer -- SetHighContrastLayer,
  // and the clearance layer of the active copper layer shown, every other
  // hidden. Forced after a SyncLayersVisibility as the open does
  // (`SetActiveLayer( ..., true )` follows it, pcb_edit_frame.cpp:2023-2037),
  // because Sync hides every clearance layer, the active one's included.
  if (visibilityChanged || aFrame.GetActiveLayer() !== aState.activeLayer)
    aFrame.SetActiveLayer(aState.activeLayer, true);

  // Display options: PCB_BASE_FRAME::SetDisplayOptions (no refresh: the frame's own repaint).
  // It recaches every item, so only when they differ from what the frame holds.
  const held = aPrev ? aPrev.displayOptions : aFrame.GetDisplayOptions();

  if (!displayOptionsEqual(held, aState.displayOptions))
    aFrame.SetDisplayOptions(aState.displayOptions, false);

  // Net highlight: BOARD_INSPECTION_TOOL::HighlightNet -> SetHighlight + UpdateAllLayersColor
  if (!aPrev || !setsEqual(aPrev.highlightNets, aState.highlightNets)) {
    settings.SetHighlight(new Set(aState.highlightNets), aState.highlightNets.size > 0);
    view.UpdateAllLayersColor();
  }

  // The first sync of a board is the tail of PCB_EDIT_FRAME::OnBoardLoaded
  // (pcb_edit_frame.cpp:2035-2055): after `SetActiveLayer( ..., true )`,
  // "Invalidate painting as loading the DRC engine will cause clearances to
  // become valid" - every item is re-recorded, so a pad or track cached by a
  // frame that slipped in before the engine had its rules draws its clearance
  // ring, and in the colour the painter gives it rather than the one
  // UpdateAllLayersColor just wrote over the cache.
  if (!aPrev) view.UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;

  for (const v of a) if (!b.has(v)) return false;

  return true;
}

function mapsEqual<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a.size !== b.size) return false;

  for (const [k, v] of a) if (b.get(k) !== v) return false;

  return true;
}

function displayOptionsEqual(a: PCB_DISPLAY_OPTIONS, b: PCB_DISPLAY_OPTIONS): boolean {
  return (
    a.m_ZoneDisplayMode === b.m_ZoneDisplayMode &&
    a.m_ContrastModeDisplay === b.m_ContrastModeDisplay &&
    a.m_NetColorMode === b.m_NetColorMode &&
    a.m_TrackOpacity === b.m_TrackOpacity &&
    a.m_ViaOpacity === b.m_ViaOpacity &&
    a.m_PadOpacity === b.m_PadOpacity &&
    a.m_ZoneOpacity === b.m_ZoneOpacity &&
    a.m_ImageOpacity === b.m_ImageOpacity &&
    a.m_FilledShapeOpacity === b.m_FilledShapeOpacity &&
    a.m_FlipBoardView === b.m_FlipBoardView
  );
}

/**
 * Hide (or show again) items in the view: what a move in flight does with
 * the items it is dragging while the editor draws their moving copies on
 * its overlay (`VIEW::Hide`, as the selection tool uses it).
 */
export function setItemsHidden(
  aPanel: PCB_DRAW_PANEL_GAL,
  aItems: Iterable<BOARD_ITEM>,
  aHide: boolean,
): void {
  const view = aPanel.GetView();

  for (const item of aItems) {
    if (view.HasItem(item)) view.Hide(item, aHide);
  }
}
