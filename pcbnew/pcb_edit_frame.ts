// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME` (pcbnew/pcb_edit_frame.h) — the non-window part the React
 * editor owns: the board, the tool manager wired as `setupTools` wires it,
 * the undo/redo stacks, and the settings the commit and undo code read.
 * `PcbEditor.tsx` is the window.
 *
 * The listener is `BOARD_LISTENER` as the React side subscribes to it: every
 * notification schedules one re-derivation of the view from the BOARD.
 */
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { CLEARANCE_LAYER_FOR, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import { BOARD_LISTENER } from './board.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { PAD } from './pad.js';
import { PCB_VIA, VIATYPE } from './pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import { PCB_BASE_EDIT_FRAME } from './pcb_base_edit_frame.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from './pcb_base_frame.js';
import { PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from './board_commit.js';
import type { FOOTPRINT } from './footprint.js';
import type { NETLIST } from './netlist_reader/pcb_netlist.js';
import { type DIALOG_DRC_LIKE, DRC_TOOL } from './tools/drc_tool.js';
import type { DRC_JOB_HOOKS, DRC_JOB_REQUEST } from './drc/drc_job.js';
import { runDrcJobOffThread } from './drc_runner.js';
import { PCB_TOOL_BASE } from './tools/pcb_tool_base.js';
import { MARKER_T } from '@ziroeda/common/marker_base.js';
import { RPT_SEVERITY_EXCLUSION } from '@ziroeda/common/reporter.js';
import type { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { GridEntry } from '@ziroeda/common/settings/grid_settings_ui.js';
import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
} from '@ziroeda/common/use_document_title.js';
import { defaultUnitsToggle } from '@ziroeda/common/settings/app_settings_units.js';
import type { CrosshairMode } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import type { RawFile } from '@ziroeda/common';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { INITPCB_MIXIN } from './initpcb.js';
import { EDIT_MIXIN } from './edit.js';
import { FILES_MIXIN } from './files.js';

/**
 * The slice of the designer's `PcbnewSettings` (`prefs/settings.ts`)
 * `pcbnewSettingsOf` reads — named structurally, the way
 * `FOOTPRINT_EDITOR_SETTINGS_LIKE` (`pcb_base_frame.ts`) already is, so this
 * package states what it needs of the JSON without importing `designer/`.
 * The designer's own `PcbnewSettings` satisfies this by construction; every
 * field name and type below is copied from its `PcbDisplayOptions` /
 * `PcbEditingSettings` (`prefs/settings.ts`).
 */
export interface PCBNEW_JSON_SETTINGS_LIKE {
  DRC: {
    report_all_track_errors: boolean;
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
  };
  appearance: {
    color_theme: string;
  };
  cross_probing: CROSS_PROBING_SETTINGS;
  pcb_display: {
    net_names_mode: 0 | 1 | 2 | 3;
    pad_numbers: boolean;
    track_clearance_mode: 0 | 1 | 2 | 3 | 4;
    pad_clearance: boolean;
    pad_use_via_color_for_normal_th_padstacks: boolean;
    force_show_fields_when_fp_selected: boolean;
    live_3d_refresh: boolean;
    origin_mode: 0 | 1 | 2;
    origin_invert_x_axis: boolean;
    origin_invert_y_axis: boolean;
    ratsnest_footprint: boolean;
    ratsnest_curved: boolean;
    ratsnest_thickness: number;
    show_page_borders: boolean;
  };
  editing: {
    pcb_angle_snap_mode: 0 | 1 | 2;
    rotation_angle: number;
    arc_edit_mode: number;
    track_drag_action: 0 | 1 | 2;
    flip_left_right: boolean;
    allow_free_pads: boolean;
    auto_fill_zones: boolean;
    magnetic_pads: 0 | 1 | 2;
    magnetic_tracks: 0 | 1 | 2;
    magnetic_graphics: boolean;
    esc_clears_net_highlight: boolean;
    show_courtyard_collisions: boolean;
    ctrl_click_highlight: boolean;
    polar_coords: boolean;
  };
  /**
   * `APP_SETTINGS_BASE::m_Window.grid` / `.cursor` — the slice the window's
   * grid/crosshair toggles and grid-size list read. Added for
   * `pcbTogglesFromSettings` (`toggles.ts`) and the window's own
   * `pcbGridSizesIU`/`storedPcbGridIU`, both narrower readers of the same
   * `PcbnewSettings.window` than `windowSettingsOf` (`pgm_app.ts`) is.
   * `style`/`line_width`/`min_spacing`/`snap`/`always_show_cursor` are the
   * rest of `PANEL_GAL_OPTIONS`' two groups (`common/dialogs/
   * panel_gal_options.cpp:110-124`), which `PcbEditor.tsx`'s `galRef`
   * spreads together with `pcb_display` into a `windowSettingsOf`-shaped
   * object.
   */
  window: {
    grid: {
      sizes: GridEntry[];
      last_size_idx: number;
      show: boolean;
      style: 'dots' | 'lines' | 'crosses';
      line_width: number;
      min_spacing: number;
      snap: 0 | 1 | 2;
    };
    cursor: {
      crosshair: 'small' | 'full' | '45';
      always_show_cursor: boolean;
    };
  };
}

/**
 * `PCBNEW_SETTINGS`' PARAM list, the part of it the frame, the commit and the
 * undo code read, from the designer's `pcbnew.json` slice
 * (`pcbnew_settings.cpp`'s `pcb_display.*` and `editing.*` rows).
 */
export function pcbnewSettingsOf(json: PCBNEW_JSON_SETTINGS_LIKE): PCBNEW_SETTINGS {
  const s = new PCBNEW_SETTINGS();
  const d = json.pcb_display;
  const e = json.editing;

  s.m_Display.m_NetNames = d.net_names_mode;
  s.m_ViewersDisplay.m_DisplayPadNumbers = d.pad_numbers;
  s.m_Display.m_TrackClearance = d.track_clearance_mode;
  s.m_Display.m_PadClearance = d.pad_clearance;
  s.m_Display.m_UseViaColorForNormalTHPadstacks = d.pad_use_via_color_for_normal_th_padstacks;
  s.m_Display.m_ForceShowFieldsWhenFPSelected = d.force_show_fields_when_fp_selected;
  s.m_Display.m_Live3DRefresh = d.live_3d_refresh;
  s.m_Display.m_DisplayOrigin = d.origin_mode;
  s.m_Display.m_DisplayInvertXAxis = d.origin_invert_x_axis;
  s.m_Display.m_DisplayInvertYAxis = d.origin_invert_y_axis;
  s.m_Display.m_ShowModuleRatsnest = d.ratsnest_footprint;
  s.m_Display.m_DisplayRatsnestLinesCurved = d.ratsnest_curved;
  s.m_Display.m_RatsnestThickness = d.ratsnest_thickness;
  s.m_ShowPageLimits = d.show_page_borders;
  s.m_ColorTheme = json.appearance.color_theme;

  s.m_CrossProbing = { ...json.cross_probing };

  s.m_DRCDialog.report_all_track_errors = json.DRC.report_all_track_errors;
  s.m_DRCDialog.crossprobe = json.DRC.crossprobe;
  s.m_DRCDialog.scroll_on_crossprobe = json.DRC.scroll_on_crossprobe;

  s.m_AngleSnapMode = e.pcb_angle_snap_mode;
  s.m_RotationAngle = new EDA_ANGLE(e.rotation_angle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  s.m_ArcEditMode = e.arc_edit_mode;
  s.m_TrackDragAction = e.track_drag_action;
  s.m_FlipDirection = e.flip_left_right ? FLIP_DIRECTION.LEFT_RIGHT : FLIP_DIRECTION.TOP_BOTTOM;
  s.m_AllowFreePads = e.allow_free_pads;
  s.m_AutoRefillZones = e.auto_fill_zones;
  s.m_MagneticItems.pads = e.magnetic_pads;
  s.m_MagneticItems.tracks = e.magnetic_tracks;
  s.m_MagneticItems.graphics = e.magnetic_graphics;
  s.m_ESCClearsNetHighlight = e.esc_clears_net_highlight;
  s.m_ShowCourtyardCollisions = e.show_courtyard_collisions;
  s.m_CtrlClickHighlight = e.ctrl_click_highlight;
  s.m_PolarCoords = e.polar_coords;

  return s;
}

export interface PCB_EDIT_FRAME_HOOKS {
  /** `PCBNEW_SETTINGS`, read on every access so a changed preference is seen. */
  settings(): PCBNEW_SETTINGS;
  /** `PCB_BASE_FRAME::OnModify`'s effect on the window: the dirty flag. */
  onModify(): void;
  /** `new DIALOG_DRC( m_editFrame, aParent )`: the window's DRC dialog. */
  createDrcDialog(aTool: DRC_TOOL, aParent: unknown): DIALOG_DRC_LIKE;
  /** `Kiface().IsSingle()`: no schematic to test parity against. */
  isSingle(): boolean;
  /** `PCB_EDIT_FRAME::FetchNetlistFromSchematic`: fills aNetlist, false on failure. */
  fetchNetlistFromSchematic(aNetlist: NETLIST, aAnnotateMessage: string): boolean;
  /**
   * The netlist text behind the last `fetchNetlistFromSchematic`, which is
   * what the DRC worker is given in place of the NETLIST object.
   */
  schematicNetlistText(): string | null;
  /** The project's `.kicad_pro` text, PROJECT not being ported. */
  projectText(): string | null;
  /** `PCB_EDIT_FRAME::OnEditItemRequest`: the item's properties dialog. */
  onEditItemRequest(aItem: BOARD_ITEM | null): void;
  /** `DIALOG_EXCHANGE_FOOTPRINTS( frame, footprint, updateMode, true ).ShowQuasiModal()`. */
  showExchangeFootprintsDialog(aFootprint: FOOTPRINT, aUpdateMode: boolean): void;
  /** `findDialogs()`: the open modeless dialogs' rectangles, in canvas client pixels. */
  findDialogRects(): BOX2D[];
  /**
   * `VIEW::SetCenter( aPos, aObscuringScreenRects )` as the editor applies it: the
   * editor still owns the view transform, so it performs the centre.
   */
  setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void;
  /** `wxMessageBox( _( "Incomplete undo/redo operation: some items not found" ) )`. */
  onUndoRedoIncomplete(): void;
  /**
   * `pcb->SetHighLightNet()` + `renderSettings->SetHighlight()`: the editor
   * still owns the highlighted-net set, so it performs the change. Empty is
   * no highlight.
   */
  setHighlightNets(aNetCodes: ReadonlySet<number>): void;
  /**
   * `PCB_ACTIONS::syncSelection` / `syncSelectionWithNets` on the items
   * `FindItemsFromSyncSelection` names: the editor owns the selection, so it
   * resolves the parts and applies them. `on_selection` has been checked.
   */
  syncSelection(aParts: readonly string[], aSelectConnections: boolean): void;
  /** `m_toolManager->RunAction( ACTIONS::updatePcbFromSchematic )`: the editor's dialog. */
  updatePcbFromSchematic(): void;
}

export interface PCB_EDIT_FRAME extends INITPCB_MIXIN, EDIT_MIXIN, FILES_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (INITPCB_MIXIN mixin, see libs/core/mixins.ts)
export class PCB_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  protected readonly hooks: PCB_EDIT_FRAME_HOOKS;
  /** The project's .kicad_dru as last given to OnBoardLoaded: `GetDesignRulesPath()` and its text. */
  private m_designRulesText: string | null = null;
  private m_designRulesPath = '';

  constructor(hooks: PCB_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.hooks = hooks;
    this.setupTools();
  }

  /**
   * `PCB_EDIT_FRAME::setupTools` (pcb_edit_frame.cpp:940): the manager, its
   * environment, the tools registered in the C++ order - DRC_TOOL (#636 stage
   * 4d) and common's PROPERTIES_TOOL and EMBED_TOOL are the ones ported so far;
   * the rest are stage 3's.
   */
  private setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.m_pcb, null, null, this.hooks.settings(), this);

    // Register tools
    this.m_toolManager.RegisterTool(new DRC_TOOL());
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());
    this.m_toolManager.InitTools();

    for (const tool of this.m_toolManager.Tools()) {
      if (tool instanceof PCB_TOOL_BASE) tool.SetIsBoardEditor(true);
    }

    // Run the selection tool, it is supposed to be always active
    // m_toolManager->InvokeTool( "common.InteractiveSelection" ): stage 3's
  }

  /** `PCB_EDIT_FRAME::GetDesignRulesPath()`: the project's rules file. */
  GetDesignRulesPath(): string {
    return this.m_designRulesPath;
  }

  /** The rules file's text, which `DRC_ENGINE::InitEngine` reads here in place of the path. */
  GetDesignRulesText(): string | null {
    return this.m_designRulesText;
  }

  /** `PCB_EDIT_FRAME::KiwayMailIn` (pcbnew/cross-probing.cpp:533). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_CROSS_PROBE:
        this.ExecuteRemoteCommand(payload);
        break;

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH, as upstream
      case MAIL_T.MAIL_SELECTION:
        if (!this.hooks.settings().m_CrossProbing.on_selection) break;

      // KI_FALLTHROUGH;

      case MAIL_T.MAIL_SELECTION_FORCE: {
        // $SELECT: <mode 0 - only footprints, 1 - with connections>,<spec1>,<spec2>,<spec3>
        const prefix = '$SELECT: ';

        if (payload.startsWith(prefix)) {
          const del = ',';
          const paramStr = payload.substring(prefix.length);
          const modeEnd = paramStr.indexOf(del);
          // std::stoi of the mode: its leading integer, and wxFAIL (false) on none.
          const mode = Number.parseInt(
            modeEnd === -1 ? paramStr : paramStr.substring(0, modeEnd),
            10,
          );
          const selectConnections = mode === 1;

          // `paramStr.substr( modeEnd + 1 )`: npos + 1 wraps to 0, the whole string.
          const syncStr = paramStr.substring(modeEnd + 1);

          this.hooks.syncSelection(syncStr.split(del), selectConnections);
        }

        break;
      }

      case MAIL_T.MAIL_PCB_UPDATE:
        this.hooks.updatePcbFromSchematic();
        break;

      default:
        break;
    }
  }

  /**
   * `PCB_EDIT_FRAME::ExecuteRemoteCommand` (pcbnew/cross-probing.cpp:83): a
   * cross-probe packet from the schematic. The `$CLEAR`, `$NET:` and `$NETS:`
   * arms are here; `$CONFIG`, `$CUSTOM_RULES`, `$DRC` and the item probes
   * (`$PART:`, `$PAD:`, `$REF:`, `$VAL:`, `$SHEET:`) are not yet.
   */
  ExecuteRemoteCommand(cmdline: string): void {
    const pcb = this.GetBoard();

    if (!pcb) return;

    const crossProbingSettings = this.hooks.settings().m_CrossProbing;

    const tok = new STRTOK(strncpyLine(cmdline));
    const idcmd = tok.Next(' \n\r');
    const text = tok.Next('"\n\r');

    if (idcmd === null) return;

    let netcode = -1;
    let multiHighlight = false;
    const highlighted = new Set<number>();

    if (idcmd === '$CLEAR') {
      this.hooks.setHighlightNets(new Set());
      return;
    } else if (idcmd === '$NET:') {
      if (!crossProbingSettings.auto_highlight) return;

      const netinfo = pcb.FindNet(text ?? '');

      if (netinfo) netcode = netinfo.GetNetCode();

      // fall through to highlighting section
    } else if (idcmd === '$NETS:') {
      if (!crossProbingSettings.auto_highlight) return;

      // wxStringTokenizer( …, ",", wxTOKEN_STRTOK ): empty tokens are skipped.
      for (const token of (text ?? '').split(',')) {
        if (token === '') continue;

        const netinfo = pcb.FindNet(token.trim());

        if (netinfo) {
          highlighted.add(netinfo.GetNetCode());
          multiHighlight = true;
        }
      }

      netcode = -1;

      // fall through to highlighting section
    } else {
      return;
    }

    if (netcode > 0 || multiHighlight) {
      if (!multiHighlight) highlighted.add(netcode);

      this.hooks.setHighlightNets(highlighted);
    } else {
      // renderSettings->SetHighlight( false )
      this.hooks.setHighlightNets(new Set());
    }
  }

  /**
   * `PCB_EDIT_FRAME::SendSelectItemsToSch` (pcbnew/cross-probing.cpp:349),
   * over the parts `collectItemsForSyncParts` gives (`boardSyncSelectionParts`,
   * sorted as upstream's `std::set`). The focus item is not sent: the
   * selection tool does not yet tell a point select from the rest, so the mode
   * is always 0. Nothing is sent for no parts, as upstream.
   */
  SendSelectItemsToSch(aParts: readonly string[], aForce: boolean): void {
    let command = '$SELECT: ';

    command += '0,';

    if (aParts.length === 0) return;

    for (const part of aParts) {
      command += part;
      command += ',';
    }

    command = command.slice(0, -1);

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_SCH,
      aForce ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: command },
      this,
    );
  }

  /** `PCB_EDIT_FRAME::SendCrossProbeNetName` (pcbnew/cross-probing.cpp:405). */
  SendCrossProbeNetName(aNetName: string): void {
    // The command is a keyword followed by a quoted string.
    const packet = `$NET: "${aNetName}"`;

    this.Kiway()?.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_CROSS_PROBE, { value: packet }, this);
  }

  CreateDrcDialog(aTool: DRC_TOOL, aParent: unknown): DIALOG_DRC_LIKE {
    return this.hooks.createDrcDialog(aTool, aParent);
  }

  /** The project file whose `board.design_settings` the DRC job reloads. */
  GetProjectText(): string | null {
    return this.hooks.projectText();
  }

  GetSchematicNetlistText(): string | null {
    return this.hooks.schematicNetlistText();
  }

  /**
   * `DRC_TOOL::RunTests`' engine run, on a worker.
   *
   * The frame owns this because a `Worker` is the designer's business; the
   * tool only knows it hands over a request and gets violations back. The
   * runner falls back to running the same job in-process where there is no
   * worker (the test runner), so the two paths cannot drift.
   */
  RunDrcJob(aRequest: DRC_JOB_REQUEST, aHooks: DRC_JOB_HOOKS): Promise<void> {
    return runDrcJobOffThread(aRequest, aHooks);
  }

  IsSingle(): boolean {
    return this.hooks.isSingle();
  }

  FetchNetlistFromSchematic(aNetlist: NETLIST, aAnnotateMessage: string): boolean {
    return this.hooks.fetchNetlistFromSchematic(aNetlist, aAnnotateMessage);
  }

  ShowExchangeFootprintsDialog(aFootprint: FOOTPRINT, aUpdateMode: boolean): void {
    this.hooks.showExchangeFootprintsDialog(aFootprint, aUpdateMode);
  }

  override findDialogRects(): BOX2D[] {
    return this.hooks.findDialogRects();
  }

  protected override setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void {
    this.hooks.setViewCenter(aPos, aObscuringScreenRects);
  }

  /** `PCB_EDIT_FRAME::ResolveDRCExclusions` (pcb_edit_frame.cpp:1378). */
  ResolveDRCExclusions(aCreateMarkers: boolean): void {
    const commit = new BOARD_COMMIT(this);

    for (const marker of this.GetBoard()!.ResolveDRCExclusions(aCreateMarkers)) {
      if (marker.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET) {
        const sheet = this.GetCanvas()?.GetDrawingSheet();

        if (sheet) marker.GetRCItem()!.SetItems(sheet);
      }

      commit.Add(marker);
    }

    commit.Push('', SKIP_UNDO | SKIP_SET_DIRTY);

    for (const marker of this.GetBoard()!.Markers()) {
      if (marker.GetSeverity() === RPT_SEVERITY_EXCLUSION)
        this.GetCanvas()?.GetView().Update(marker);
    }

    this.GetBoard()!.UpdateRatsnestExclusions();
  }

  override SetBoard(
    aBoard: BOARD | null,
    aBuildConnectivity: boolean | PROGRESS_REPORTER_LIKE | null = true,
    aReporter: PROGRESS_REPORTER_LIKE | null = null,
  ): void {
    // `SetBoard( BOARD*, PROGRESS_REPORTER* )` is `SetBoard( aBoard, true, aReporter )`
    if (typeof aBuildConnectivity !== 'boolean') {
      aReporter = aBuildConnectivity;
      aBuildConnectivity = true;
    }

    if (this.m_pcb) this.m_pcb.ClearProject();

    super.SetBoard(aBoard, aReporter);

    aBoard!.SetProject(this.Prj());

    if (aBuildConnectivity) aBoard!.BuildConnectivity();

    // reload the drawing-sheet: SetPageSettings( aBoard->GetPageSettings() ) is the window's
    // UpdateVariantSelectionCtrl(): the toolbar's
  }

  /**
   * `PCB_EDIT_FRAME::OnBoardLoaded` (pcb_edit_frame.cpp:1933): the layer
   * names into the PCB_LAYER_ID enum map (canonical and user), the DRC engine
   * initialised on the project's rules, the clearance cache filled. The rules
   * file arrives as its text (`GetDesignRulesPath()` is the caller's), null
   * when the project has none; a PARSE_ERROR stays quiet, as upstream's does.
   * The WRL-to-STEP migration below it is the 3D viewer's.
   */
  OnBoardLoaded(aRulesText: string | null, aRulesPath = ''): void {
    this.m_designRulesText = aRulesText;
    this.m_designRulesPath = aRulesPath;

    const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

    layerEnum.Choices().Clear();
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask()) {
      // Canonical name
      layerEnum.Map(layer, LSET.Name(layer));

      // User name
      layerEnum.Map(layer, this.GetBoard()!.GetLayerName(layer));
    }

    const drcEngine = this.GetBoard()!.GetDesignSettings().m_DRCEngine;

    try {
      drcEngine?.InitEngine(aRulesText, aRulesPath);
    } catch (e) {
      // Not sure this is the best place to tell the user their rules are buggy, so
      // we'll stay quiet for now.  Feel free to revisit this decision....
      if (!(e instanceof PARSE_ERROR)) throw e;
    }

    this.GetBoard()!.InitializeClearanceCache();
  }

  /**
   * `PCB_EDIT_FRAME::SetActiveLayer( aLayer, aForceRedraw )` (pcb_edit_frame.cpp:1823):
   * the canvas half. The Appearance panel's `OnLayerChanged` is the React
   * state's, and `PCB_ACTIONS::layerChanged` is stage 3's.
   */
  override SetActiveLayer(aLayer: PCB_LAYER_ID, aForceRedraw = false): void {
    const oldLayer = this.GetActiveLayer();

    if (oldLayer === aLayer && !aForceRedraw) return;

    super.SetActiveLayer(aLayer);

    const canvas = this.GetCanvas();

    if (!canvas) return;

    canvas.SetHighContrastLayer(aLayer);

    /*
     * Only show pad, via and track clearances when a copper layer is active
     * and then only show the clearance layer for that copper layer. For
     * front/back non-copper layers, show the clearance layer for the outer
     * layer on that side.
     *
     * For pads/vias, this is to avoid clutter when there are pad/via layers
     * that vary in flash (i.e. clearance from the hole or pad edge), padstack
     * shape on each layer or clearances on each layer.
     *
     * For tracks, this follows the same logic as pads/vias, but in theory could
     * have their own set of independent clearance layers to allow track clearance
     * to be shown for more layers.
     */
    const getClearanceLayerForActive = (aActiveLayer: PCB_LAYER_ID): number | null => {
      if (IsCopperLayer(aActiveLayer)) return CLEARANCE_LAYER_FOR(aActiveLayer);

      return null;
    };

    const oldClearanceLayer = getClearanceLayerForActive(oldLayer);

    if (oldClearanceLayer !== null) canvas.GetView().SetLayerVisible(oldClearanceLayer, false);

    const newClearanceLayer = getClearanceLayerForActive(aLayer);

    if (newClearanceLayer !== null) canvas.GetView().SetLayerVisible(newClearanceLayer, true);

    const contrastMode = this.GetDisplayOptions().m_ContrastModeDisplay;

    canvas.GetView().UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
      if (!aItem.IsBOARD_ITEM()) return 0;

      return PCB_EDIT_FRAME.activeLayerUpdateFlags(
        aItem as BOARD_ITEM,
        oldLayer,
        aLayer,
        contrastMode,
      );
    });

    canvas.Refresh();
  }

  /** `PCB_EDIT_FRAME::activeLayerUpdateFlags` (pcb_edit_frame.cpp:1881). */
  static activeLayerUpdateFlags(
    aItem: BOARD_ITEM,
    aOldLayer: PCB_LAYER_ID,
    aNewLayer: PCB_LAYER_ID,
    aContrastMode: HIGH_CONTRAST_MODE,
  ): number {
    // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as they
    // won't be found in the view layer's itemset for re-painting.
    if (aContrastMode === HIGH_CONTRAST_MODE.HIDDEN) {
      if (aItem.IsOnLayer(aOldLayer) || aItem.IsOnLayer(aNewLayer)) return VIEW_UPDATE_FLAGS.ALL;
    }

    // High contrast dims by active layer so all flagged items repaint; without it only the flashed
    // copper geometry depends on the active layer, so re-cache just the items whose flashing changes.
    const highContrast = aContrastMode !== HIGH_CONTRAST_MODE.NORMAL;

    if (aItem instanceof PCB_VIA) {
      const via = aItem;

      if (
        via.GetViaType() === VIATYPE.BLIND ||
        via.GetViaType() === VIATYPE.BURIED ||
        via.GetViaType() === VIATYPE.MICROVIA
      ) {
        if (highContrast || via.GetLayerSet().test(aOldLayer) !== via.GetLayerSet().test(aNewLayer))
          return VIEW_UPDATE_FLAGS.REPAINT;
      }

      if (
        via.GetRemoveUnconnected() &&
        (highContrast || via.FlashLayer(aOldLayer) !== via.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    } else if (aItem instanceof PAD) {
      const pad = aItem;

      if (
        pad.GetRemoveUnconnected() &&
        (highContrast || pad.FlashLayer(aOldLayer) !== pad.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    }

    return 0;
  }

  GetName(): string {
    return PCB_EDIT_FRAME_NAME;
  }

  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }

  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.hooks.settings();
  }

  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }

  override OnModify(): void {
    super.OnModify();
    this.hooks.onModify();
  }

  protected override ShowUndoRedoIncompleteMessage(): void {
    this.hooks.onUndoRedoIncomplete();
  }
}

applyMixins(PCB_EDIT_FRAME, [INITPCB_MIXIN, EDIT_MIXIN, FILES_MIXIN]);

/**
 * The React side's BOARD_LISTENER: whatever the board reports, the view is
 * re-derived once, after the current commit or undo has finished — the
 * listener is invoked in the middle of both.
 */
export class REACT_BOARD_LISTENER extends BOARD_LISTENER {
  private pending = false;
  /**
   * The items the notifications since the last re-derivation named, so the
   * view keeps every other item's object (`boardFromBOARD`'s `aUnchanged`);
   * null once a notification named no items (net settings), which means
   * every item's view is re-derived.
   */
  private touched: Set<BOARD_ITEM> | null = new Set();

  constructor(private readonly refresh: (aUnchanged: ((k: BOARD_ITEM) => boolean) | null) => void) {
    super();
  }

  /** True between a notification and the re-derivation it scheduled. */
  IsPending(): boolean {
    return this.pending;
  }

  private note(aItems: readonly BOARD_ITEM[]): void {
    if (!this.touched) return;
    for (const item of aItems) {
      this.touched.add(item);
      // A footprint's children are viewed through the footprint.
      const fp = item.GetParentFootprint();
      if (fp) this.touched.add(fp);
    }
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const touched = this.touched;
      this.touched = new Set();
      this.refresh(touched ? (k) => !touched.has(k) : null);
    });
  }

  override OnBoardItemAdded(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsAdded(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemRemoved(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsRemoved(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemChanged(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsChanged(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardCompositeUpdate(
    _aBoard: BOARD,
    aAddedItems: BOARD_ITEM[],
    aRemovedItems: BOARD_ITEM[],
    aChangedItems: BOARD_ITEM[],
  ): void {
    this.note(aAddedItems);
    this.note(aRemovedItems);
    this.note(aChangedItems);
    this.schedule();
  }
  override OnBoardNetSettingsChanged(_aBoard: BOARD): void {
    this.touched = null;
    this.schedule();
  }
}

// --- PCB_EDIT_FRAME's grid + snap arithmetic (was pcb_grid.ts) ---

/**
 * Where the grid is, and how a point snaps onto it.
 *
 * A board carries its own grid origin — `(setup (grid_origin x y))`,
 * `BOARD_DESIGN_SETTINGS::GetGridOrigin` — and pcbnew installs it on the GAL the
 * moment a board is opened (`pcb_base_edit_frame.cpp`:
 * `GetGAL()->SetGridOrigin( aBoard->GetDesignSettings().GetGridOrigin() )`).
 * Everything that touches the grid then works relative to it: `CAIRO_GAL_BASE::
 * DrawGrid` offsets every dot by `m_gridOrigin`, and `GRID_HELPER::AlignGrid`
 * rounds about `GRID_HELPER::GetOrigin()`, which reads the same value back off
 * the GAL.
 *
 * We had it hardcoded to (0, 0) in both places. That is invisible on a board
 * whose origin happens to be a whole number of grid steps from the world origin
 * — most of them, which is why it survived — and plainly wrong on one where it
 * is not: the dots sit at a fixed fraction of a step away from every track and
 * pad that KiCad placed on them.
 *
 * Lives in its own module rather than in `PcbEditor.tsx` so the qa package can
 * typecheck it; qa's tsc has no `--jsx`, so anything imported from a `.tsx`
 * fails the workspace typecheck even though vitest runs it happily.
 */

/** A point in internal units. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * `EDIT_TOOL::Move`'s movement, for one frame (edit_tool_move_fct.cpp:1144-1177).
 *
 *     m_cursor = grid.BestSnapAnchor( mousePos, layers, selectionGrid, sel_items );
 *     movement = m_cursor - prevPos;
 *     …
 *     prevPos  = m_cursor;
 *
 * `prevPos` is seeded to the drag origin — `grid.BestDragOrigin(…)`, an anchor
 * *on the selection*, with the pointer warped onto it (:1311-1351). Summed over
 * the gesture the telescoping leaves `anchor + Σmovement = BestSnapAnchor(…)`,
 * so what is really being placed is the **anchor**, absolutely, at the snapped
 * cursor. That is the whole of why two parts dragged in KiCad line up with each
 * other: each one's anchor lands on a grid node rather than keeping whatever
 * fraction of a grid step it had.
 *
 * `snap` is `BestSnapAnchor`, taken as an argument because it needs the board,
 * the view scale and the moving items to skip — none of which this arithmetic
 * has any business knowing.
 *
 * The browser cannot warp the pointer. It does not need to: with the warp,
 * upstream's `mousePos` is the anchor plus the pointer's motion since the grab,
 * which is what the first line reconstructs. Called with `anchor === grabOrigin`
 * — a selection that offers no anchor at all, where `BestDragOrigin` returns the
 * mouse position — it degenerates to exactly upstream's own answer for that case.
 */
export function moveDelta(
  anchor: GridPoint,
  grabOrigin: GridPoint,
  cursor: GridPoint,
  snap: (p: GridPoint) => GridPoint,
): GridPoint {
  const to = snap({
    x: anchor.x + (cursor.x - grabOrigin.x),
    y: anchor.y + (cursor.y - grabOrigin.y),
  });

  return { x: to.x - anchor.x, y: to.y - anchor.y };
}

// --- PCB_EDIT_FRAME::UpdateTitle (was frame_title.ts) ---

/** `_( "PCB Editor" )`, the half after the dash. */
export const PCB_FRAME_NAME = 'PCB Editor';

/**
 * `_( "3D Viewer" )` — `eda_3d_viewer_frame.cpp:634`, and row 12 of
 * `docs/frame-titles.md`.
 *
 * The child 3D frame names ITSELF. A parent only overrides that title by
 * passing `aTitle` to `PCB_BASE_FRAME::Update3DView` (pcb_base_frame.cpp:161),
 * and exactly two frames do: the Footprint Library Browser
 * (`footprint_viewer_frame.cpp:966`) and the Footprint Chooser
 * (`footprint_chooser_frame.cpp:392-398`), which both build
 * `_( "3D Viewer" ) + " — " + <footprint name>` — the frame name FIRST, the
 * reverse of every other frame.
 *
 * Neither of our two call sites is one of those. `PCB_EDIT_FRAME` and
 * `DISPLAY_FOOTPRINTS_FRAME` (`display_footprints_frame.cpp:417`) both call
 * `Update3DView` with no title at all, so upstream shows the bare frame name.
 * Ours prefixed the board or footprint name and an ASCII hyphen to both.
 */
export const VIEWER_3D_FRAME_NAME = '3D Viewer';

export interface PcbFrameTitleSpec {
  /**
   * The board's file name, extension included or not — this drops it, the way
   * `wxFileName::GetName()` does, along with any directory. Empty or absent is
   * the no-board case.
   */
  fileName?: string | null;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `!fn.IsFileWritable()`. A browser has no per-file writable bit; the
   * condition that stands in for one here is the demo project, the same
   * substitution `SchematicEditor`'s `readOnly` prop documents.
   *
   * There is no `[Unsaved]` counterpart, for the reason the schematic's module
   * gives: upstream sets it from `!fn.FileExists()`, and a board in this app
   * exists in the project store from the moment it is opened, so the flag
   * would never be true.
   */
  readOnly?: boolean;
}

export function pcbFrameTitle(spec: PcbFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';
  // `wxFileName::GetName()` — the NAME half alone, no directory and no
  // extension. A leading dot is not an extension, so `.kicad_pcb` stays whole.
  const name = raw.split(/[/\\]/).filter(Boolean).pop() ?? '';
  const document = name.replace(/(?!^)\.[^./\\]*$/, '');

  return frameTitle({
    frameName: PCB_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}

// --- PROJECT::GetProjectFullName / PCB_EDIT_FRAME::GetDesignRulesPath over a file list (was project_settings.ts) ---

const PRO_RE = /\.kicad_pro$/i;

/** Path basename (project references store a bare file name). */
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The project's `.kicad_pro` (same pinning rule as the schematic side). */
export function findProjectPro(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const want = proBase ? `${proBase}.kicad_pro`.toLowerCase() : null;
  if (want) {
    const pinned = files.find(
      (f) => PRO_RE.test(f.name) && basename(f.name).toLowerCase() === want,
    );
    if (pinned) return pinned;
  }
  return files.find((f) => PRO_RE.test(f.name));
}

const PRL_RE = /\.kicad_prl$/i;

/** The project's `.kicad_prl` (PROJECT_LOCAL_SETTINGS), if it has ever written one. */
export function findProjectPrl(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const want = proBase ? `${proBase}.kicad_prl`.toLowerCase() : null;
  if (want) {
    const pinned = files.find(
      (f) => PRL_RE.test(f.name) && basename(f.name).toLowerCase() === want,
    );
    if (pinned) return pinned;
  }
  return files.find((f) => PRL_RE.test(f.name));
}

/** The custom-rules file KiCad pairs with a project:
 *  `<project>.kicad_dru` (FILEEXT::DesignRulesFileExtension). */
export function druFileName(proName: string): string {
  return proName.replace(/\.kicad_pro$/i, '.kicad_dru');
}

/** The project's `.kicad_dru`, resolved via its `.kicad_pro` sibling. */
export function findProjectDru(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const pro = findProjectPro(files, proBase);
  if (!pro) return undefined;
  const want = druFileName(pro.name).toLowerCase();
  return files.find((f) => f.name.toLowerCase() === want);
}

/** Local alias so code merged in from toggles.ts is unchanged. */
type PcbnewSettings = PCBNEW_JSON_SETTINGS_LIKE;

// --- PCB_EDIT_FRAME's left-toolbar toggle state (was toggles.ts) ---

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`pcbnew/toolbars_pcb_editor.cpp:164-177`), in upstream's own order. The
 * units group leads with millimetres here and with inches in eeschema
 * (`eeschema/toolbars_sch_editor.cpp:82-84`), so the order is per-frame data,
 * not a shared constant: it is what the button cycles through on click.
 *
 * The zone-display pair is not an upstream group — those two are separate
 * `AppendAction`s (`toolbars_pcb_editor.cpp:186-188`) — but they read one
 * `ZONE_DISPLAY_MODE`, so only one can be in force.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];

/**
 * What a fresh PCB_EDIT_FRAME shows, entry by entry:
 *
 * - `toggleGrid` — `window.grid.show`, default `true`
 *   (`common/settings/app_settings.cpp:555-556`).
 * - the units button — the `APP_SETTINGS_BASE` branch
 *   (`app_settings.cpp:228-238`). `PCBNEW_SETTINGS` passes the filename
 *   `"pcbnew"` (`pcbnew/pcbnew_settings.cpp:50`), which is on neither imperial
 *   name, so the board opens in millimetres.
 * - `crosshairSmall` — `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )`
 *   (`common/gal/gal_display_options.cpp:52`).
 * - `lineModeFree` — `m_AngleSnapMode( LEADER_MODE::DIRECT )`
 *   (`pcbnew/pcbnew_settings.cpp:59`), which
 *   `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps to
 *   `PCB_ACTIONS::lineModeFree` (`pcbnew/tools/board_editor_control.cpp:364`).
 *   **This was `lineMode90`**, which is the DEG90 arm — a mode the board editor
 *   never starts in. The footprint editor's own default is DEG45
 *   (`pcbnew/footprint_editor_settings.cpp:55`), so the three pcbnew-family
 *   frames disagree on purpose and none of them may be copied from a neighbour.
 * - `zoneDisplayFilled` — `m_ZoneDisplayMode = ZONE_DISPLAY_MODE::SHOW_FILLED`
 *   (`include/pcb_display_options.h:35`).
 * - `showLayersManager` — `aui.show_layer_manager`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:78-79`).
 * - `showProperties` — `aui.show_properties`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:110-111`).
 *
 * And one entry that is deliberately ABSENT: `ratsnestLineMode` is checked off
 * `m_Display.m_DisplayRatsnestLinesCurved` (`curvedRatsnestCond`,
 * `pcbnew/pcb_edit_frame.cpp:1150-1155`), whose default is `false`
 * (`pcb_display.ratsnest_curved`, `pcbnew/pcbnew_settings.cpp:258-259`). Ours
 * listed it, so a fresh board drew **curved** ratsnest lines where KiCad draws
 * straight ones.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('pcbnew'),
  'crosshairSmall',
  'lineModeFree',
  'zoneDisplayFilled',
  'showLayersManager',
  'showProperties',
]);

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));

  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}

/**
 * {@link DEFAULT_TOGGLES}, but with the three entries that have a stored value
 * taken FROM that value — `EDA_DRAW_FRAME::LoadSettings` reading
 * `m_Window.grid.show`, `m_Window.cursor.cross_hair_mode` and the frame's unit
 * back out of `pcbnew.json` on open (`common/eda_draw_frame.cpp`).
 *
 * Preferences > PCB Editor > Display Options edits the crosshair shape and the
 * Grids page the rest of `window.grid`; a frame that booted from a hardcoded
 * set would show a choice the canvas never took. `editors/drawingsheet/
 * toggles.ts`' `togglesFromSettings` is the same function for pl_editor.
 *
 * The other four entries stay literal because no key of `PcbnewSettings` backs
 * them yet — inventing one to derive them from would be the opposite of this.
 */
export function pcbTogglesFromSettings(cfg: PcbnewSettings): Set<string> {
  const out = new Set(DEFAULT_TOGGLES);

  out.delete('toggleGrid');
  if (cfg.window.grid.show) out.add('toggleGrid');

  for (const id of ['crosshairSmall', 'crosshairFull', 'crosshair45']) out.delete(id);
  out.add(crosshairToggleId(cfg.window.cursor.crosshair));

  // `curvedRatsnestCond` reads `m_Display.m_DisplayRatsnestLinesCurved`
  // (`pcbnew/pcb_edit_frame.cpp:1150-1155`), which Preferences > PCB Editor >
  // Editing Options is the other control over.
  out.delete('ratsnestLineMode');
  if (cfg.pcb_display.ratsnest_curved) out.add('ratsnestLineMode');

  // `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps `m_AngleSnapMode` onto
  // one of the three Line mode buttons (`board_editor_control.cpp:360-368`), so
  // the toolbar group and Editing Options' "Constrain actions to H, V, 45
  // degrees" are ONE value.
  for (const id of ['lineModeFree', 'lineMode45', 'lineMode90']) out.delete(id);
  out.add(lineModeToggleId(cfg.editing.pcb_angle_snap_mode));

  return out;
}

/** `LEADER_MODE` -> the left toolbar's button id. DIRECT 0, DEG45 1, DEG90 2. */
export function lineModeToggleId(mode: number): string {
  return mode === 1 ? 'lineMode45' : mode === 2 ? 'lineMode90' : 'lineModeFree';
}

/** …and back. */
export function lineModeOf(id: string): 0 | 1 | 2 | null {
  if (id === 'lineModeFree') return 0;
  if (id === 'lineMode45') return 1;
  if (id === 'lineMode90') return 2;
  return null;
}

/** `CROSS_HAIR_MODE` -> the left toolbar's button id. */
export function crosshairToggleId(mode: CrosshairMode): string {
  return mode === 'full' ? 'crosshairFull' : mode === '45' ? 'crosshair45' : 'crosshairSmall';
}

/** …and back, for a click on one of the three. */
export function crosshairModeOf(id: string): CrosshairMode | null {
  if (id === 'crosshairFull') return 'full';
  if (id === 'crosshair45') return '45';
  if (id === 'crosshairSmall') return 'small';
  return null;
}

/**
 * Fold a toolbar activation back into `pcbnew.json`, so the button and
 * Preferences are one value rather than two that drift.
 *
 * `GAL_DISPLAY_OPTIONS`' setters write straight through to the settings object
 * upstream — `PCB_BASE_FRAME::SaveSettings` then persists it — which is why
 * flipping the crosshair from the toolbar and reopening Preferences shows the
 * new shape selected. Returns true when it took the click, so the caller knows
 * not to treat it as canvas-only state.
 */
export function foldPcbToggle(cfg: PcbnewSettings, id: string): boolean {
  const mode = crosshairModeOf(id);

  if (mode !== null) {
    cfg.window.cursor.crosshair = mode;
    return true;
  }

  const line = lineModeOf(id);

  if (line !== null) {
    cfg.editing.pcb_angle_snap_mode = line;
    return true;
  }

  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }

  if (id === 'ratsnestLineMode') {
    cfg.pcb_display.ratsnest_curved = !cfg.pcb_display.ratsnest_curved;
    return true;
  }

  if (id === 'togglePolarCoords') {
    cfg.editing.polar_coords = !cfg.editing.polar_coords;
    return true;
  }

  return false;
}

/** Whether {@link foldPcbToggle} would write the file for this id. */
export function isStoredPcbToggle(id: string): boolean {
  return (
    crosshairModeOf(id) !== null ||
    lineModeOf(id) !== null ||
    id === 'toggleGrid' ||
    id === 'ratsnestLineMode' ||
    id === 'togglePolarCoords'
  );
}
