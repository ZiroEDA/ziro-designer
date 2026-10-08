// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAW_PANEL (`eeschema/sch_draw_panel.{h,cpp}`): the schematic canvas's
 * contract with its frame — the props the frame hands it, the controller it
 * hands back (zoom, centring, the view metrics cross-probing reads), and the
 * pending-placement shapes the drawing tools ride on the cursor. The canvas
 * component itself (`designer/.../components/SchematicCanvas.tsx`, which the
 * frame reaches through `EESCHEMA_APP.SchematicCanvas`) implements it; these
 * types moved out of it so `eeschema/` can state the frame's side.
 */
import {
  EDA_DRAW_PANEL_GAL,
  GAL_TYPE,
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
} from '@ziroeda/common/draw_panel_gal.js';
import type { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { WX_VIEW_CONTROLS } from '@ziroeda/common/view/wx_view_controls.js';
import { ZOOM_MAX_LIMIT_EESCHEMA, ZOOM_MIN_LIMIT_EESCHEMA } from '@ziroeda/common/zoom_defines.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_BASE_FRAME } from './sch_base_frame.js';
import { SCH_PAINTER } from './sch_painter.js';
import type { SCH_SCREEN } from './sch_screen.js';
import { SCH_LAYER_ORDER, SCH_VIEW, SCH_WORLD_UNIT } from './sch_view.js';
import type { Vec2 } from '@ziroeda/kimath';
import type { InputPrefs } from '@ziroeda/common/ui/view_controls.js';
import type {
  ArcEditMode,
  BBox,
  DirectiveShape,
  EditCommand,
  EditedLabelField,
  EditHandle,
  ErcViolation,
  ItemRef,
  LabelKind,
  LabelShape,
  LibSymbol,
  NewPowerSymbols,
  NewSheetDefaults,
  PastePayload,
  Schematic,
  SchImage,
  SchSymbol,
} from './index.js';
import type { RenderOpts, Theme } from './sch_render_settings.js';
import type { LibGraphic, LibPin } from './types.js';
import type { SymbolViewOptions } from './symbol_editor/symbol_renderer.js';
import type { SymbolHit } from './symbol_editor/edits.js';

export type LineMode = 'free' | '90' | '45';

/** A label whose name/shape are chosen and which now follows the cursor for placement. */
export interface PendingLabel {
  kind: LabelKind;
  text: string;
  shape: LabelShape;
  /** Formatting from the label dialog (bold/italic/size in IU). */
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  /** Orientation (SPIN_STYLE) as the stored angle. */
  angle?: number;
  /** Explicit text colour, if the dialog's swatch was set. */
  color?: readonly [number, number, number, number];
  /** The label's own fields (`(property …)`), from the dialog's Fields grid. */
  fields?: readonly EditedLabelField[];
  /** "Auto": turn the label to suit what it is dropped on. */
  autoRotate?: boolean;
  /** Justification tokens for free text (the H/V alignment buttons). */
  justify?: readonly string[];
  /** FONT_CHOICE's face, when one was picked ('' / undefined = default). */
  face?: string;
  /** `(hyperlink "…")` on free text. */
  hyperlink?: string;
  /** `(exclude_from_sim yes)`, free text's simulation checkbox. */
  excludeFromSim?: boolean;
}

/** A netclass directive label whose shape/netclass are chosen, awaiting a click. */
export interface PendingDirective {
  shape: DirectiveShape;
  pinLength: number;
  netclass: string;
  angle: number;
  fontSize?: number;
  /**
   * Every field the dialog collected, not just the netclass.
   *
   * `createNewLabel` hands `DIALOG_LABEL_PROPERTIES` the real `SCH_LABEL_BASE`
   * and the dialog edits it in place, so whatever the fields grid ends up
   * holding — the netclass, the component class, anything added with the "+"
   * button — is on the item that then follows the cursor. Carrying only the
   * netclass across dropped the rest on the floor.
   */
  fields?: readonly EditedLabelField[];
}

export interface SymbolCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /**
   * `EDA_DRAW_FRAME::FocusOnLocation` (`common/eda_draw_frame.cpp`), which is
   * `GetCanvas()->GetView()->SetCenter( aPos )` once the point is off-screen:
   * the scale is kept and the world point goes to the middle of the canvas.
   * `SCH_FIND_REPLACE_TOOL::FindNext` ends on it for every hit.
   */
  centerOn: (pos: Vec2) => void;
}

export interface SymbolCanvasProps {
  symbol: LibSymbol | null;
  /** Active colour theme (Preferences > Colors). */
  theme?: Theme;
  opts: SymbolViewOptions;
  selection: ReadonlySet<string>;
  activeTool: string;
  /** A pin configured in the dialog, now following the cursor (two-click place). */
  pendingPin: LibPin | null;
  /** A text item configured in the dialog, following the cursor. */
  pendingText: { text: string; fontSize?: number } | null;
  /**
   * Imported graphics riding the cursor (`SYMBOL_EDITOR_DRAWING_TOOLS::
   * ImportGraphics`' preview): the drawing's origin sits on the cursor —
   * `item->Move( cursorPos )` — and a left click drops it.
   */
  pendingImport?: readonly LibGraphic[] | null;
  /** The imported drawing was dropped with its origin at pos. */
  onPlacePendingImport?: (pos: Vec2) => void;
  onSelect: (id: string | null, additive: boolean) => void;
  onSelectBox: (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => void;
  /** Commit an edited symbol as one undoable step. */
  onCommit: (next: LibSymbol, description: string) => void;
  /** First click of the pin tool: open the pin dialog for this position. */
  onPinToolClick: (pos: Vec2) => void;
  /** The pending pin was dropped at pos: place it (PlacePin + image pins). */
  onPlacePendingPin: (pos: Vec2) => void;
  /** First click of the text tool: open the text dialog. */
  onTextToolClick: (pos: Vec2) => void;
  /** The pending text was dropped. */
  onPlacePendingText: (pos: Vec2) => void;
  /** A finished shape from the drawing tools. */
  onPlaceShape: (g: LibGraphic) => void;
  onEditItem: (hit: SymbolHit) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
}

// ---------------------------------------------------------------------------
// SCH_DRAW_PANEL itself (sch_draw_panel.cpp): the GAL canvas a schematic or symbol is drawn on,
// SCH_VIEW and the live SCH_PAINTER on the shared EDA_DRAW_PANEL_GAL (as PCB_DRAW_PANEL_GAL is).
// ---------------------------------------------------------------------------

export class SCH_DRAW_PANEL extends EDA_DRAW_PANEL_GAL {
  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    const frame = this.schFrame();

    this.m_view = new SCH_VIEW(frame);
    this.m_view.SetGAL(this.m_gal!);
    this.m_gal!.SetWorldUnitLength(SCH_WORLD_UNIT);

    this.m_painter = new SCH_PAINTER(this.m_gal);

    const cs = frame ? frame.GetColorSettings() : COLOR_SETTINGS.CreateBuiltinColorSettings()[0]!;

    this.m_painter.GetSettings().LoadColors(cs);
    this.m_view.SetPainter(this.m_painter);

    // This fixes the zoom in and zoom out limits:
    this.m_view.SetScaleLimits(ZOOM_MAX_LIMIT_EESCHEMA, ZOOM_MIN_LIMIT_EESCHEMA);
    this.m_view.SetMirror(false, false);

    // Early initialization of the canvas background color,
    // before any OnPaint event is fired for the canvas using a wrong bg color
    const settings = this.m_painter.GetSettings();
    this.m_gal!.SetClearColor(settings.GetBackgroundColor());

    this.setDefaultLayerOrder();
    this.setDefaultLayerDeps();

    this.GetView().UpdateAllLayersOrder();

    // View controls is the first in the event handler chain, so the Tool Framework operates
    // on updated viewport data.
    this.m_viewControls = new WX_VIEW_CONTROLS(this.m_view, this);

    this.StartDrawing();
  }

  /** `dynamic_cast<SCH_BASE_FRAME*>( GetParentEDAFrame() )`. */
  private schFrame(): SCH_BASE_FRAME | null {
    const frame = this.GetParentEDAFrame();

    if (frame && typeof (frame as SCH_BASE_FRAME).GetColorSettings === 'function')
      return frame as SCH_BASE_FRAME;

    return null;
  }

  DisplaySymbol(aSymbol: LIB_SYMBOL | null): void {
    this.GetView().DisplaySymbol(aSymbol);
  }

  DisplaySheet(aScreen: SCH_SCREEN | null): void {
    this.GetView().Clear();

    if (aScreen) this.GetView().DisplaySheet(aScreen);
    else this.GetView().Cleanup();
  }

  protected setDefaultLayerOrder(): void {
    for (let i = 0; i < SCH_LAYER_ORDER.length; ++i) {
      const layer = SCH_LAYER_ORDER[i]!;
      this.m_view!.SetLayerOrder(layer, i);
    }
  }

  override SwitchBackend(aGalType: GAL_TYPE): boolean {
    const rv = super.SwitchBackend(aGalType);

    // The base constructor switches before the SCH_VIEW exists
    if (this.m_view) this.setDefaultLayerDeps();

    this.m_gal!.SetWorldUnitLength(SCH_WORLD_UNIT);
    this.Refresh();
    return rv;
  }

  protected setDefaultLayerDeps(): void {
    const view = this.m_view!;

    // caching makes no sense for Cairo and other software renderers
    const target =
      this.m_backend === GAL_TYPE.GAL_TYPE_OPENGL
        ? RENDER_TARGET.TARGET_CACHED
        : RENDER_TARGET.TARGET_NONCACHED;

    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++) view.SetLayerTarget(i, target);

    view.SetLayerTarget(SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR, RENDER_TARGET.TARGET_NONCACHED);
    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR);

    // Bitmaps are draw on a non cached GAL layer:
    view.SetLayerTarget(GAL_LAYER_ID.LAYER_DRAW_BITMAPS, RENDER_TARGET.TARGET_NONCACHED);

    // Some draw layers need specific settings
    view.SetLayerTarget(GAL_LAYER_ID.LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_GP_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_DRAWINGSHEET, RENDER_TARGET.TARGET_NONCACHED);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_DRAWINGSHEET);

    view.SetLayerTarget(SCH_LAYER_ID.LAYER_OP_VOLTAGES, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_OP_VOLTAGES);
    view.SetLayerTarget(SCH_LAYER_ID.LAYER_OP_CURRENTS, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_OP_CURRENTS);

    view.SetLayerTarget(SCH_LAYER_ID.LAYER_SELECTION_SHADOWS, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);

    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT);
    view.SetLayerDisplayOnly(SCH_LAYER_ID.LAYER_DANGLING);
  }

  override GetView(): SCH_VIEW {
    return this.m_view as SCH_VIEW;
  }

  override OnShow(): void {
    try {
      // Check if the current rendering backend can be properly initialized
      this.m_view!.UpdateItems();
    } catch (e) {
      // DisplayInfoMessage( frame, e.what() ): the canvas reports it in the console.
      console.warn(String(e));

      // Use fallback if one is available
      if (EDA_DRAW_PANEL_GAL.GAL_FALLBACK !== this.m_backend) {
        this.SwitchBackend(EDA_DRAW_PANEL_GAL.GAL_FALLBACK);
        // frame->ActivateGalCanvas(): the frame shows this canvas already.
      }
    }
  }

  protected override onPaint(): void {
    // The first paint can be fired at startup before the GAL engine is fully initialized
    // (depending on platforms). Do nothing in this case
    if (!this.m_gal!.IsInitialized() || !this.m_gal!.IsVisible()) return;

    super.onPaint();
  }
}
