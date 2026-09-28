// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_RENDER_SETTINGS (`eeschema/sch_render_settings.{h,cpp}`): the
 * schematic's view of KiCad's built-in colour themes. (Was
 * `designer/src/editors/schematic/theme.ts`.)
 *
 * The colours themselves are NOT defined here. They live once, for every
 * editor, in `@ziroeda/common/settings/builtin_color_themes.ts` — a
 * mechanical port of `common/settings/builtin_color_themes.h`, which is
 * likewise the single place KiCad defines them. This module only names the
 * schematic layers eeschema's renderer cares about (`SCH_LAYER_ID`) and
 * renders each one to a CSS string, the way `SCH_RENDER_SETTINGS::LoadColors`
 * pulls `m_layerColors[aLayer]` out of the shared `COLOR_SETTINGS`.
 *
 * Adding a colour here means adding a layer to `SCH_LAYERS` below, never
 * typing an RGB value.
 */
import {
  BUILTIN_CLASSIC_THEME,
  BUILTIN_DEFAULT_THEME,
  type Color4d,
  toCssColor,
} from '@ziroeda/common';
import type { WksSheet } from '@ziroeda/common';
import type { TextVarResolverFn } from '@ziroeda/common/common.js';

/**
 * Which `SCH_LAYER_ID` each field of `Theme` reads, so that the mapping from
 * our renderer's vocabulary to KiCad's is stated once and can be checked
 * against `layer_ids.h`.
 */
const SCH_LAYERS = {
  background: 'LAYER_SCHEMATIC_BACKGROUND',
  grid: 'LAYER_SCHEMATIC_GRID',
  // `SCH_BASE_FRAME::UpdateGridColors` hands this one straight to the GAL:
  // `GetGAL()->SetAxesColor( colorSettings->GetColor( LAYER_SCHEMATIC_GRID_AXES ) )`
  // (`eeschema/sch_base_frame.cpp:612`). Only the Symbol Editor paints with it,
  // because it is the frame that turns the axes ON
  // (`symbol_edit_frame.cpp:265`, `GetCanvas()->GetGAL()->SetAxesEnabled( true )`).
  gridAxes: 'LAYER_SCHEMATIC_GRID_AXES',
  wire: 'LAYER_WIRE',
  bus: 'LAYER_BUS',
  busJunction: 'LAYER_BUS_JUNCTION',
  junction: 'LAYER_JUNCTION',
  symbolOutline: 'LAYER_DEVICE',
  symbolFill: 'LAYER_DEVICE_BACKGROUND',
  pin: 'LAYER_PIN',
  pinName: 'LAYER_PINNAM',
  pinNumber: 'LAYER_PINNUM',
  reference: 'LAYER_REFERENCEPART',
  value: 'LAYER_VALUEPART',
  fields: 'LAYER_FIELDS',
  label: 'LAYER_LOCLABEL',
  globalLabel: 'LAYER_GLOBLABEL',
  hierLabel: 'LAYER_HIERLABEL',
  netclassFlag: 'LAYER_NETCLASS_REFS',
  // `SCH_DRAG_NET_COLLISION_MONITOR::Update` reads this one straight off the
  // theme (`sch_drag_net_collision.cpp:158-163`) and derives both of the alphas
  // it strokes and fills the markers with from the colour's own.
  dragNetCollision: 'LAYER_DRAG_NET_COLLISION',
  netHighlight: 'LAYER_BRIGHTENED',
  selectionShadow: 'LAYER_SELECTION_SHADOWS',
  brightened: 'LAYER_BRIGHTENED',
  noteLine: 'LAYER_NOTES',
  noText: 'LAYER_NOTES',
  ruleArea: 'LAYER_RULE_AREAS',
  privateNote: 'LAYER_PRIVATE_NOTES',
  noConnect: 'LAYER_NOCONNECT',
  // The two marker layers `SCH_PAINTER::draw( SCH_SYMBOL )` paints over a
  // symbol's body: the DNP cross (sch_painter.cpp:2811) and the
  // excluded-from-simulation box and badge (:2839).
  dnpMarker: 'LAYER_DNP_MARKER',
  excludedFromSim: 'LAYER_EXCLUDED_FROM_SIM',
  ercError: 'LAYER_ERC_ERR',
  ercWarning: 'LAYER_ERC_WARN',
  ercExclusion: 'LAYER_ERC_EXCLUSION',
  sheetBorder: 'LAYER_SHEET',
  sheetBackground: 'LAYER_SHEET_BACKGROUND',
  sheetName: 'LAYER_SHEETNAME',
  sheetFile: 'LAYER_SHEETFILENAME',
  sheetLabel: 'LAYER_SHEETLABEL',
  sheetFields: 'LAYER_SHEETFIELDS',
  pageFrame: 'LAYER_SCHEMATIC_DRAWINGSHEET',
  pageLimits: 'LAYER_SCHEMATIC_PAGE_LIMITS',
  anchor: 'LAYER_SCHEMATIC_ANCHOR',
  hidden: 'LAYER_HIDDEN',
  cursor: 'LAYER_SCHEMATIC_CURSOR',
  auxItems: 'LAYER_SCHEMATIC_AUX_ITEMS',
} as const satisfies Record<string, keyof typeof BUILTIN_DEFAULT_THEME>;

export interface Theme {
  background: string;
  grid: string;
  /** LAYER_SCHEMATIC_GRID_AXES: the two lines through the world origin. */
  gridAxes: string;
  wire: string;
  bus: string;
  busJunction: string;
  junction: string;
  symbolOutline: string;
  symbolFill: string;
  pin: string;
  pinName: string;
  pinNumber: string;
  reference: string;
  value: string;
  /** User fields (LAYER_FIELDS). */
  fields: string;
  label: string;
  globalLabel: string;
  hierLabel: string;
  /** LAYER_NETCLASS_REFS, netclass directive labels. */
  netclassFlag: string;
  /** LAYER_DRAG_NET_COLLISION: the rings a drag that would merge two nets
   *  raises, and the line across a connection it has pulled apart. */
  dragNetCollision: string;
  netHighlight: string;
  selectionShadow: string;
  /** LAYER_BRIGHTENED: what a cross-probed item turns while it is focused. */
  brightened: string;
  noteLine: string;
  noText: string;
  /** LAYER_RULE_AREAS: the outline of a schematic rule area. */
  ruleArea: string;
  privateNote: string;
  noConnect: string;
  /** LAYER_DNP_MARKER: the red cross over a "Do not populate" symbol. */
  dnpMarker: string;
  /** LAYER_EXCLUDED_FROM_SIM: the box and tilde badge on an excluded symbol. */
  excludedFromSim: string;
  ercError: string;
  ercWarning: string;
  /** LAYER_ERC_EXCLUSION, the colour of an excluded marker. */
  ercExclusion: string;
  sheetBorder: string;
  sheetBackground: string;
  sheetName: string;
  sheetFile: string;
  sheetLabel: string;
  sheetFields: string;
  pageFrame: string;
  /** LAYER_SCHEMATIC_PAGE_LIMITS: the paper-edge lines when "Show page limits" is on. */
  pageLimits: string;
  /** LAYER_SCHEMATIC_ANCHOR: text/origin anchor crosses. */
  anchor: string;
  /** LAYER_HIDDEN: hidden pins/fields when shown. */
  hidden: string;
  /** LAYER_SCHEMATIC_CURSOR: the crosshair cursor. */
  cursor: string;
  /** LAYER_SCHEMATIC_AUX_ITEMS: what EDIT_POINTS derives its colours from. */
  auxItems: string;
}

/**
 * Project one built-in `COLOR_SETTINGS` onto the fields the renderer reads.
 *
 * A layer absent from a theme falls back to "KiCad Default". Upstream it would
 * not: `COLOR_SETTINGS::GetColor()` returns `COLOR4D::UNSPECIFIED` — fully
 * transparent — for a layer the theme never set, and the classic theme sets no
 * `LAYER_SCHEMATIC_PAGE_LIMITS`, so KiCad Classic draws no page limits at all.
 * The fallback stays because it is what this module has always rendered;
 * matching upstream's invisible page limits is a behaviour change, not a
 * transcription fix, so it is left for a deliberate one.
 */
const project = (colors: Partial<Record<string, Color4d>>): Theme =>
  Object.fromEntries(
    Object.entries(SCH_LAYERS).map(([field, layer]) => [
      field,
      toCssColor(colors[layer] ?? BUILTIN_DEFAULT_THEME[layer], ', '),
    ]),
  ) as unknown as Theme;

/**
 * The same projection for a theme that arrived as a FILE -- `colorThemeFromFile`
 * hands back CSS strings keyed by layer id, which is what a theme the PCM
 * installed is. A layer the file does not name falls back to "KiCad Default",
 * which for a file is exactly upstream: `COLOR_MAP_PARAM::Load` with
 * `aResetIfMissing` puts `s_defaultTheme`'s colour on any key the file lacks.
 */
export const themeFromLayerCss = (colors: Partial<Record<string, string>>): Theme =>
  Object.fromEntries(
    Object.entries(SCH_LAYERS).map(([field, layer]) => [
      field,
      colors[layer] ?? toCssColor(BUILTIN_DEFAULT_THEME[layer], ', '),
    ]),
  ) as unknown as Theme;

/** "KiCad Default", `s_defaultTheme` (the beige theme KiCad ships as default). */
export const KICAD_DEFAULT: Theme = project(BUILTIN_DEFAULT_THEME);

/** "KiCad Classic", `s_classicTheme` (the white legacy theme). */
export const KICAD_CLASSIC: Theme = project(BUILTIN_CLASSIC_THEME);

/** Builtin themes by their KiCad settings ids. */
export const BUILTIN_THEMES: Record<string, { name: string; theme: Theme }> = {
  _builtin_default: { name: 'KiCad Default', theme: KICAD_DEFAULT },
  _builtin_classic: { name: 'KiCad Classic', theme: KICAD_CLASSIC },
};

/** World(IU) -> screen(px): screenX = worldX * scale + offsetX. */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Render options driven by the Preferences dialog (EESCHEMA_SETTINGS): the
 * display-options toggles, the selection/highlight pen widths and the grid
 * appearance (GAL_OPTIONS + window.grid).
 */
export interface RenderOpts {
  showHiddenPins: boolean;
  /**
   * `EESCHEMA_SETTINGS::m_Appearance.show_directive_labels`
   * (`eeschema_settings.cpp:210-211`, default true).
   *
   * `SCH_PAINTER::draw( const SCH_DIRECTIVE_LABEL* )` opens with
   *
   *     if( !eeconfig()->m_Appearance.show_directive_labels && !aLabel->IsSelected() )
   *         return;                                    (sch_painter.cpp:3266-3267)
   *
   * — so a SELECTED directive label is drawn whatever the setting says, which
   * is what stops one vanishing under the pointer while it is being edited.
   */
  showDirectiveLabels: boolean;
  /**
   * `EESCHEMA_SETTINGS::m_Selection.fill_shapes`
   * (`eeschema_settings.cpp:441-442`, default FALSE — unlike its neighbours).
   *
   * A selected shape's shadow is filled rather than only outlined
   * (`sch_painter.cpp:2068-2080`). See `fillGraphicShadow` for why an arc is
   * the exception.
   */
  fillSelectedShapes: boolean;
  /**
   * `m_Appearance.show_pin_alt_icons` (`eeschema_settings.cpp:231-232`),
   * default TRUE, pushed at the render settings by
   * `SCH_EDIT_FRAME::eeconfigChanged` (`sch_edit_frame.cpp:2011`).
   */
  showPinAltIcons: boolean;
  /**
   * `m_Selection.highlight_netclass_colors` (`eeschema_settings.cpp:444-451`)
   * and its two numbers — thickness in MILS (default 15, 0..50) and alpha as a
   * FACTOR (default 0.6, 0..1).
   */
  highlightNetclassColors: boolean;
  netclassHighlightThicknessMils: number;
  netclassHighlightAlpha: number;
  /**
   * `m_Selection.draw_selected_children` (`eeschema_settings.cpp:438-439`),
   * default TRUE — the opposite of `fill_shapes` beside it.
   */
  drawSelectedChildren: boolean;
  showHiddenFields: boolean;
  /**
   * `SCH_RENDER_SETTINGS::m_OverrideItemColors` — the theme's
   * `override_schematic_item_colors`.
   *
   * When set, an item's OWN colour is ignored and everything is drawn in its
   * layer's colour. Upstream this is one branch in `SCH_PAINTER::getRenderColor`:
   *
   *     if( !m_schSettings.m_OverrideItemColors ) { … take the item's colour … }
   *     (`sch_painter.cpp:320`)
   *
   * which is why {@link itemColour} is the only place ours asks the question.
   */
  overrideItemColors?: boolean;
  /**
   * Device pixels per CSS pixel for THIS context, which is what turns a world
   * width into the pixel count KiCad rounds.
   *
   * It is a per-caller fact, not a global one: the editor's 2D overlays are
   * handed a context already sized in device pixels (their `view.scale` carries
   * the ratio), while the Colors preview lays out in CSS pixels and applies the
   * ratio with `setTransform`. Defaulting to 1 is right for the first and wrong
   * for the second, so the second says so.
   */
  devicePixelRatio?: number;
  showPageLimits: boolean;
  /**
   * The dangling marks — the square on a loose wire end or label anchor, the
   * circle on an unconnected pin. They are `SCH_PAINTER`'s
   * (`drawDanglingIndicator`, `drawPinDanglingIndicator`) and no `Plot()`
   * draws one: a plot has no connectivity to show. Defaults to true; a plot
   * turns it off.
   */
  showDanglingIndicators?: boolean;
  /**
   * Clear to the theme background before drawing. The screen always does; a
   * plot fills the page only for `m_useBackgroundColor && GetColorMode()`
   * (`SCH_PLOTTER::plotOneSheetPDF/PS/SVG`) and otherwise draws nothing
   * there. Defaults to true.
   */
  paintBackground?: boolean;
  /** Draw the page border + title block (LAYER_DRAWINGSHEET). Defaults to true;
   *  Print/Plot's "drawing sheet" option turns it off. */
  showDrawingSheet?: boolean;
  /** Custom drawing sheet (a loaded `.kicad_wks`), like KiCad's project
   *  `m_DrawingSheetFileName`. Unset = the built-in default stationery. */
  drawingSheet?: WksSheet;
  /**
   * A plot draws the drawing sheet itself (`PlotDrawingSheet`, straight into
   * the plotter) at the point the frame would be painted, after the page
   * background and before the items. Unset = paint it here.
   */
  plotDrawingSheet?: () => void;
  /** Pen width (IU) for zero-width strokes, the plot dialog's "Minimum line
   *  width" (default pen thickness). Unset = KiCad's 6-mil default. */
  defaultPenIU?: number;
  /** Default wire / bus pen (IU) when neither the item nor its netclass sets
   *  one (eeschema `m_Drawing.default_wire_thickness` / `default_bus_thickness`,
   *  6 and 12 mils). Unset = those defaults. */
  defaultWireIU?: number;
  defaultBusIU?: number;
  /** Effective junction-dot diameter (IU) for junctions with no explicit
   *  diameter (SCHEMATIC_SETTINGS::GetJunctionSize()). A value ≤ 1 means the
   *  user chose "None", no dot is drawn. Unset = DEFAULT_JUNCTION_DIAM. */
  junctionDiameterIU?: number;
  /**
   * The junctions the connectivity pass put on LAYER_BUS_JUNCTION, by refId
   * (`connection_graph.cpp:1451-1454`).
   *
   * A junction's layer is decided by the graph, not by the painter, so this
   * arrives as an answer rather than being worked out here — and an absent set
   * means "no connectivity has run", which paints every dot on LAYER_JUNCTION,
   * exactly as an unbuilt graph leaves them.
   */
  busJunctionIds?: ReadonlySet<string>;
  /** Dashed-line dash / gap lengths as multiples of the line width
   *  (m_DashedLineDashRatio / m_DashedLineGapRatio; ISO 128-2 defaults 12 / 3). */
  dashLengthRatio?: number;
  gapLengthRatio?: number;
  /** Label / pin-text lift as a fraction of text size (m_TextOffsetRatio;
   *  default 0.15, the Formatting panel's percent value ÷ 100). */
  textOffsetRatio?: number;
  /** Global-label box margin as a fraction of text size (m_LabelSizeRatio;
   *  default 0.375, the Formatting panel's percent value ÷ 100). */
  labelSizeRatio?: number;
  /** Overbar Y offset as a multiple of text size (FONT_METRICS
   *  m_OverbarHeight; default 1.23). */
  overbarHeightRatio?: number;
  /** Pin decoration size in IU (m_PinSymbolSize; default 25 mil). 0 keeps
   *  KiCad's per-pin fallback: the pin's own text sizes ÷ 2. */
  pinSymbolSizeIU?: number;
  /** Wire hop-over arc radius in IU (default line width ×
   *  SCHEMATIC_SETTINGS::GetHopOverScale). Unset or 0 = no hop-overs. */
  hopOverRadiusIU?: number;
  /** Inter-sheet references (m_IntersheetRefsShow on): resolves a global
   *  label's implicit "Intersheet References" field text from its resolved
   *  label text (SCH_GLOBALLABEL::ResolveTextVar `INTERSHEET_REFS` branch).
   *  Unset = the layer is hidden, like SetLayerVisible(LAYER_INTERSHEET_REFS). */
  intersheetRefs?: { text: (resolvedLabel: string) => string };
  /** Per-item netclass fallbacks (SCH_LINE::GetLineColor/GetPenWidth/
   *  GetEffectiveLineStyle, SCH_JUNCTION::getEffectiveShape): applied only
   *  where the item carries no stroke of its own. */
  netOverrides?: {
    lines: ReadonlyMap<string, { color?: string; widthIU?: number; dash?: string }>;
    junctions: ReadonlyMap<string, number>;
  };
  /** Text-variable resolver (PROJECT/TITLE_BLOCK/SCHEMATIC TextVarResolver):
   *  when set, `${VAR}` in labels, text, text boxes, tables and fields renders
   *  expanded (GetShownText). Unset = text draws verbatim. */
  resolveTextVar?: TextVarResolverFn;
  /** Unit-notation inputs for multi-unit references
   *  (SCHEMATIC_SETTINGS::SubReference: m_SubpartIdSeparator char code, 0 =
   *  none, and m_SubpartFirstId 'A'/'1'). Unset = plain letters (U1A). */
  subpart?: { separator: number; firstId: number };
  /** Title-block page context of the rendered sheet instance
   *  (SCH_SHEET_PATH / DS_DRAW_ITEM_LIST): the page-number *string* shown by
   *  `${#}` (SetPageNumber, may be "A", "ii", …), the sheet *ordinal*
   *  (SetSheetNumber, drives page1only/notonpage1 item visibility), the
   *  hierarchy's sheet count (`${##}`), and the sheet name / human-readable
   *  path (`${SHEETNAME}` / `${SHEETPATH}`). Unset = standalone sheet. */
  pageNumber?: string;
  sheetNumber?: number;
  sheetCount?: number;
  sheetName?: string;
  sheetPath?: string;
  /** A move is in progress, so a selected field draws its umbilical line back
   *  to its parent instead of its anchor cross (SCH_PAINTER::draw(SCH_FIELD):
   *  `aField->IsMoving()`). */
  movingSelection?: boolean;
  /**
   * Item ids to leave out of this render.
   *
   * KiCad caches each item's geometry separately, so re-drawing one item
   * leaves every other item's cached vertices alone
   * (`VIEW::updateItemGeometry`, common/view/view.cpp). For moves specifically,
   * `SCH_MOVE_TOOL` puts the dragged items in a preview group
   * (`m_view->AddToPreview` / `ClearPreview`) painted over a static background.
   *
   * Both need the same thing from the painter: draw the sheet *without* the
   * items being moved, so they are not painted twice, once stale from the
   * background and once live under the cursor.
   *
   * Absent or empty draws everything, which is what every existing caller
   * wants and gets.
   */
  hiddenItems?: ReadonlySet<string>;
  /**
   * Item ids to draw to the exclusion of all others: the other half of the
   * pair above, and what renders the preview. Its cost is set by how many
   * items are moving, not by how large the sheet is.
   */
  onlyItems?: ReadonlySet<string>;
  /**
   * `eeconfig()->m_Appearance.mark_sim_exclusions` (`sch_painter.cpp:2696`),
   * the Display Options checkbox that suppresses the excluded-from-simulation
   * marker. Its default is `true` (`eeschema/eeschema_settings.cpp:222-223`),
   * which is why the frame passes the setting rather than leaving this unset.
   *
   * Unset is OFF, and that is the plot/print path rather than a fallback:
   * `SCH_SYMBOL::Plot` emits `PlotDNP` (`sch_symbol.cpp:3348-3349`) and no
   * simulation marker at all, so a plotted sheet never shows one and has no
   * setting to consult.
   */
  markSimExclusions?: boolean;
  /** selection.thickness (mils). */
  selectionThicknessMils: number;
  /** selection.highlight_thickness (mils). */
  highlightThicknessMils: number;
  /**
   * The wire ends a drag is moving, by line id, so the *other* end of each can
   * be marked. `SCH_PAINTER::draw( SCH_LINE )` puts an indicator on the end of a
   * selected line that is **not** flagged, i.e. the one holding still:
   *
   *     if( ( aLine->IsWire() && aLine->IsStartDangling() )
   *         || ( drawingShadows && aLine->IsSelected() && !aLine->HasFlag( STARTPOINT ) ) )
   *
   * Unset outside a drag.
   */
  draggedEnds?: { startMoving: ReadonlySet<string>; endMoving: ReadonlySet<string> };
  /**
   * Which of the two passes to run.
   *
   * `SCH_PAINTER::getShadowWidth` is
   * `|screenWorldMatrix.scale.x * mils| + MilsToIU( mils )`: a fixed number of
   * *screen pixels* plus a small world width. That is a zoom-dependent
   * geometry, and the WebGL backend records geometry once and never re-records
   * on a zoom, so baking a halo into the buffer freezes it at the width it had
   * when it was recorded. Zoom in afterwards and a three-pixel glow becomes a
   * twenty-pixel bar that swallows the item it is meant to be behind.
   *
   * So on the GL path the halos are left out of the recording (`'skip'`) and
   * drawn per frame onto the 2D layer *underneath* it (`'only'`), which is
   * where a shadow belongs and costs what the selection costs rather than what
   * the sheet costs. Canvas2D repaints everything anyway and leaves this unset.
   */
  halos?: 'both' | 'skip' | 'only';
  grid: {
    show: boolean;
    sizeIU: number;
    style: 'dots' | 'lines' | 'crosses';
    lineWidthPx: number;
    minSpacingPx: number;
    /** Content scale factor (GAL::GetScaleFactor): the pixel-valued grid
     *  settings above are logical pixels, as they are in GAL, and are scaled by
     *  this for the device-pixel canvas. Unset = 1. */
    devicePixelRatio?: number;
    /** Per-item grid overrides (ACTIONS::toggleGridOverrides): IU sizes, only
     * present when enabled + that item's override is on. */
    overrides?: {
      enabled: boolean;
      connected?: number;
      wires?: number;
      text?: number;
      graphics?: number;
    };
  };
  /**
   * Whether the document has a connectivity graph at all.
   *
   * `SCH_PAINTER::draw( const SCH_TEXT* )` recolours a label to the bus layer
   * only `if( conn && conn->IsBus() )` — `conn` being
   * `aText->Connection( &m_schematic->CurrentSheet() )`, which is null for an
   * item that belongs to no SCH_SCREEN. The Colors preview is exactly that: a
   * bag of items added straight to a KIGFX::VIEW
   * (`panel_eeschema_color_settings.cpp:266-270`), so its `GLOBAL[0..3]` draws
   * in LAYER_GLOBLABEL's dark red and not the bus blue, however bus-shaped its
   * name is. Unset = the ordinary editor case, where there is a graph.
   */
  connectivity?: boolean;
}

export const DEFAULT_RENDER_OPTS: RenderOpts = {
  showHiddenPins: false,
  // [data] `PARAM<bool>( "selection.fill_shapes", …, false )` — the one of
  // these that upstream defaults OFF.
  fillSelectedShapes: false,
  // [data] `PARAM<bool>( "appearance.show_pin_alt_icons", …, true )`.
  showPinAltIcons: true,
  // [data] `PARAM<bool>( …, false )`, `PARAM<int>( …, 15, 0, 50 )` and
  // `PARAM<double>( …, 0.6, 0, 1 )` (`eeschema_settings.cpp:444-451`).
  highlightNetclassColors: false,
  netclassHighlightThicknessMils: 15,
  netclassHighlightAlpha: 0.6,
  // [data] `PARAM<bool>( "selection.draw_selected_children", …, true )`.
  drawSelectedChildren: true,
  // [data] `PARAM<bool>( "appearance.show_directive_labels", …, true )`.
  showDirectiveLabels: true,
  showHiddenFields: false,
  showPageLimits: true,
  selectionThicknessMils: 3,
  highlightThicknessMils: 2,
  grid: { show: true, sizeIU: 12700, style: 'dots', lineWidthPx: 1, minSpacingPx: 10 },
};
