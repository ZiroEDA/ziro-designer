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

export interface CanvasController {
  /** `objectsOnly` fits what is drawn and ignores the page (zoomFitObjects). */
  zoomToFit: (objectsOnly?: boolean) => void;
  /** Fit the view to a world-space box (Zoom to Selected Objects). */
  zoomToBox: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Force a repaint without changing the view (Refresh / zoomRedraw). */
  redraw: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Centre the viewport on a world point (used by ERC click-to-locate). */
  centerOn: (p: Vec2) => void;
  /**
   * The current scale and the canvas size in pixels — `VIEW::GetScale()` and
   * `GetViewport().GetSize()`, which `ZoomFitCrossProbeBBox` reads before it
   * decides anything. Null before the canvas has been sized.
   */
  viewMetrics: () => {
    scale: number;
    width: number;
    height: number;
    /** The WORLD point at the middle of the canvas — `GetViewport().Centre()`. */
    cx: number;
    cy: number;
  } | null;
  /** `VIEW::SetScale( s )`, keeping the world point at the centre. */
  setScale: (s: number) => void;
  /**
   * What `SCH_SELECTION_TOOL::SelectPoint` would collect at the cursor:
   * `collectAndGuess`' candidates, closest first, empty when the pointer is off
   * the canvas.
   *
   * `RequestSelection` reads `GetCursorPosition( true )` — the *snapped* cursor
   * — and the hit accuracy scales with the zoom, so both live here rather than
   * in the editor, which knows neither.
   */
  candidatesAtCursor: () => readonly ItemRef[];
}

export interface SchematicCanvasProps {
  schematic: Schematic;
  libById: Map<string, LibSymbol>;
  selection: ReadonlySet<string>;
  activeTool: string;
  lineMode: LineMode;
  /** eeschema.drawing.arc_edit_mode: what dragging an arc's edit points means. */
  arcEditMode: ArcEditMode;
  /** Start drawing a wire from this point (Unfold from Bus hands the tool over
   *  with the entry's far end already placed). A fresh nonce re-arms it. */
  wireStartRequest?: { at: Vec2; nonce: number } | null;
  placeLib: LibSymbol | null;
  /**
   * Give a symbol its reference as it is placed, when the "Annotate
   * Automatically" toggle (or a power symbol) calls for it. Returns the symbol
   * unchanged otherwise. Applied before the placement command is built, so the
   * placement and its number are one undo step, as KiCad's single COMMIT is.
   */
  onAnnotatePlacement?: (sym: SchSymbol, lib: LibSymbol) => SchSymbol;
  /**
   * Autoplace a symbol's fields as it is placed, gated on the
   * "Automatically place symbol fields" preference
   * (`SCH_DRAWING_TOOLS::PlaceSymbol`, sch_drawing_tools.cpp:484-499).
   *
   * Upstream runs it twice, and the difference is the screen argument: once
   * with a null screen while the symbol is still attached to the cursor
   * ("Not placed yet, so pass a nullptr screen reference"), and again with the
   * real screen once it lands, so the second pass can see what is already on
   * the sheet and step the fields around it. `dropped` picks which.
   */
  onAutoplacePlacement?: (sym: SchSymbol, lib: LibSymbol, dropped: boolean) => SchSymbol;
  /**
   * A click with the place tool active and nothing on the cursor: reopen the
   * chooser. Upstream has no separate path for this - the chooser lives inside
   * the click branch's `if( !symbol )` - so a Cancel leaves the tool running
   * and the very next click asks again.
   */
  onRequestChooser?: () => void;
  /** Unit of `placeLib` attached to the cursor ("Place all units" stepping). */
  placeUnit?: number;
  /** A ready-built symbol to place instead of one made from `placeLib`'s
   *  defaults: Place Next Symbol Unit attaches a copy of an existing symbol so
   *  the new unit keeps its reference, fields and orientation. */
  placeInstance?: SchSymbol | null;
  /** A symbol was just placed, the editor steps units / reopens the chooser. */
  onSymbolPlaced?: () => void;
  /** A named label that follows the cursor until clicked to place (null = none yet). */
  pendingLabel: PendingLabel | null;
  /** A netclass directive label following the cursor (SCH_DIRECTIVE_LABEL). */
  pendingDirective?: PendingDirective | null;
  /** The pending label was just dropped: take the next one, or stop. */
  /** A label was placed; the argument is its id, which F1 repeats. */
  onLabelPlaced?: (id?: string) => void;
  /** A `(hyperlink …)` on text was Ctrl-clicked: "#<page>" or a URL. */
  onFollowLink?: (link: string) => void;
  /** A label tool clicked with nothing attached, ask for the next label
   *  (SCH_DRAWING_TOOLS::TwoClickPlace calls createNewLabel on that click).
   *  The click point lets the editor take the net name off the wire instead. */
  onLabelPrompt?: (at: Vec2) => void;
  /** Wire ids whose net is highlighted (KiCad's net-highlight overlay). */
  highlight?: ReadonlySet<string>;
  onSelect: (id: string | null, additive: boolean) => void;
  /** Highlight-Net tool: the clicked item whose net to brighten, or null to clear. */
  onHighlight?: (id: string | null) => void;
  /** Switch the active tool (used to auto-start a wire from a dangling pin). */
  onRequestTool?: (id: string) => void;
  /** Double-clicked item (KiCad's Properties action, sch_edit_tool.cpp). */
  onEditItem?: (id: string, kind: ItemRef['kind']) => void;
  /** Properties invoked over the drawing sheet with nothing selected: KiCad
   *  posts ACTIONS::pageSettings for that (SCH_EDIT_TOOL::Properties). */
  onEditDrawingSheet?: () => void;
  /** Box-selection result (KiCad SelectMultiple): replace/add/subtract the ids. */
  onSelectBox?: (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => void;
  /** Items being pasted: they follow the cursor until clicked to drop (KiCad's paste-then-move). */
  pastePending?: PastePayload | null;
  /** The paste was dropped: the command was submitted; `ids` are the pasted item ids. */
  onPasteDone?: (ids: ReadonlySet<string>) => void;
  /** ERC violations to draw as KiCad marker arrows (null = ERC not run);
   *  `excluded` picks LAYER_ERC_EXCLUSION's colour (SCH_MARKER::GetColorLayer). */
  ercMarkers?: readonly (ErcViolation & { excluded?: boolean; brightened?: boolean })[] | null;
  /** Other viewers' live cursor positions (designer/src/sync/) — no upstream
   *  KiCad counterpart, KiCad has no notion of another viewer. World coords. */
  remoteCursors?: readonly { peerId: string; label: string; world: Vec2 }[];
  /** What each other viewer has selected on THIS sheet, by uuid — drawn as
   *  their own dashed box, and claimed: see `lockedIds`. */
  remoteSelections?: readonly { peerId: string; ids: ReadonlySet<string> }[];
  /**
   * Items another viewer has claimed by selecting them (designer/src/sync/).
   *
   * A grab on any of these is refused before it starts, which is the board
   * editor's `beginMove` guard: letting the drag run and discarding it on
   * drop would mean the item follows your cursor and then snaps back, and
   * the whole point of a lock is to be visible while you are pushing
   * against it rather than after.
   */
  lockedIds?: ReadonlySet<string>;
  /**
   * A click landed on an ERC marker. `SCH_MARKER_T` is "always selectable" in
   * `SCH_SELECTION_TOOL`, and selecting one cross-probes to the ERC dialog
   * (`SCH_INSPECTION_TOOL::CrossProbe`); a double-click routes through
   * `SCH_EDIT_TOOL::Properties`, which calls the same thing but opens the
   * dialog first if it is closed.
   */
  onMarkerPick?: (violation: ErcViolation, doubleClick: boolean) => void;
  onCommand: (cmd: EditCommand) => void;
  /**
   * A move was dropped INTO a sheet — `SCH_MOVE_TOOL::moveSelectionToSheet`
   * (`sch_move_tool.cpp:1001-1013`, `:1957-2008`).
   *
   * The canvas cannot do this itself: the items leave this sheet's screen for
   * another document's, and only the editor holds the project's other sheets.
   * So it hands over the sheet it is dropping into, the items as KiCad's own
   * clipboard text (which carries the library definitions they need), and their
   * extent, which is what the destination's placement search needs.
   *
   * `source` is this sheet's half — the items leaving it — handed over rather
   * than issued as an ordinary `onCommand`, because the two halves are ONE undo
   * step: `SCH_COMMIT` stages both screens and pushes a single entry
   * (`sch_move_tool.cpp:2005-2006`). Issuing them separately made undoing the
   * source leave the copy on the destination, which duplicates rather than
   * reverts.
   */
  onDropIntoSheet?: (drop: {
    sheetId: string;
    text: string;
    box: BBox;
    source: EditCommand;
  }) => void;
  /**
   * "Defaults for New Objects" (Preferences > Schematic Editor > Editing
   * Options), which `SCH_DRAWING_TOOLS` stamps onto the item as it is created.
   */
  newSheetDefaults?: NewSheetDefaults;
  /** `m_Drawing.new_power_symbols`: which power kind a placed power symbol is
   *  converted to (`sch_drawing_tools.cpp:436-471`). */
  newPowerSymbols?: NewPowerSymbols;
  /** WX_INFOBAR message from a tool ("Junction location contains no joinable
   *  wires and/or pins."); null dismisses it. */
  onInfoBar?: (message: string | null) => void;
  /**
   * The pointer moved. `world` is the raw position; `snapped` is where the
   * cursor actually *is* — `KIGFX::VIEW_CONTROLS::GetCursorPosition()`, which
   * snaps to the grid (or, for the connection-snapping tools, to the anchor
   * `BestSnapAnchor` picked). The status bar reads the snapped one, as
   * `SCH_BASE_FRAME::UpdateStatusBar` does.
   */
  onCursorMove?: (world: Vec2 | null, snapped: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Active colour theme (Preferences > Colors). */
  theme?: Theme;
  /** Display options (Preferences > Display Options / Grids). */
  renderOpts?: RenderOpts;
  /** Mouse and editing behaviour (Preferences > Mouse and Touchpad / Editing Options). */
  inputPrefs?: InputPrefs;
  /** A hierarchical sheet rectangle was drawn: prompt for name/file and commit. */
  onSheetDrawn?: (at: Vec2, size: { w: number; h: number }) => void;
  /** A text-box rectangle was drawn: prompt for its text and commit (SCH_TEXTBOX). */
  onTextBoxDrawn?: (start: Vec2, end: Vec2) => void;
  /** A table dragged out: `DrawTable` derives its grid from the rectangle. */
  onTableDrawn?: (start: Vec2, end: Vec2) => void;
  /** A sheet-pin click landed on a sheet edge: prompt for the pin name and add it. */
  onSheetPinClick?: (sheetIndex: number, at: Vec2, side: 0 | 90 | 180 | 270) => void;
  /** The sheet-pin tool clicked with no sheet under the cursor. */
  onSheetPinMiss?: () => void;
  /**
   * `schematic->Settings().m_DefaultTextSize`, in IU. The table tool needs it:
   * a column is fifteen characters wide and a row two high, so the grid a drag
   * describes is a function of the text size.
   */
  tableFontSizeIU?: number;
  /** An image chosen in the editor, following the cursor until clicked to place. */
  pendingImage?: SchImage | null;
  /** The pending image was dropped at `at`. */
  onImagePlaced?: (at: Vec2) => void;
  /** Keyboard-initiated grabbed move (SCH_MOVE_TOOL): 'move' leaves connected
   *  wires behind, 'drag' keeps them attached. A fresh nonce starts a move of
   *  the current selection that follows the cursor until clicked to drop. */
  /** SCH_MOVE_TOOL's four modes; break and slice split the wire, then drag it. */
  grabRequest?: { kind: 'move' | 'drag' | 'break' | 'slice'; nonce: number } | null;
  /** Zoom to Selection Area (ACTIONS::zoomTool): the user dragged a rectangle;
   *  fit the view to it (and the parent returns the tool to select). */
  onZoomArea?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Plain right-click with the select tool idle (KiCad's selection-tool
   *  context menu): `hit` is the already-hit-tested item under the cursor.
   *  The editor updates the selection and pops the menu at the client point. */
  onContextMenuRequest?: (
    clientX: number,
    clientY: number,
    hit: ItemRef | null,
    /** Where the click landed and which edit point it was over, so the menu can
     *  offer Add / Remove Corner (SCH_POINT_EDITOR's two context-menu items). */
    pointEdit: { world: Vec2; handle: EditHandle | null; tolerance: number },
  ) => void;
  /** An ambiguous click (several candidates after GuessSelectionCandidates):
   *  the editor pops the Clarify Selection menu at the client point. */
  onClarify?: (clientX: number, clientY: number, candidates: ItemRef[], additive: boolean) => void;
  /** The current selection is one a right-click made for its menu
   *  (`SELECTION::IsHover`), which gets no point-editor handles. */
  isHoverSelection?: boolean;
}

// ---- The Symbol Editor's canvas. Upstream both frames draw on SCH_DRAW_PANEL;
// ours are two components (designer's SymbolCanvas.tsx implements this one,
// reached through SYMBOL_EDIT_FRAME_APP.SymbolCanvas). ----

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
