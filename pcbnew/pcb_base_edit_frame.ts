// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_EDIT_FRAME` (pcbnew/pcb_base_edit_frame.h/.cpp): the common base
 * of the board and footprint editors — here `SetBoard`, `OnBoardChanging`
 * and `GetColorSettings`, plus `pcbView`/`m_undoRedoBlocked` (our own
 * helper and the undo/redo mixin's one piece of state).
 *
 * The undo/redo half (`pcbnew/undo_redo.cpp` whole) is `UNDO_REDO_MIXIN`
 * (`undo_redo.ts`), mixed in below with `applyMixins` — see that file's own
 * doc comment for why this class can't just `extends` it directly the way
 * `PCB_BASE_FRAME` is extended.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { DIALOG_TEXT_PROPERTIES } from './dialogs/dialog_text_properties.js';
import { DIALOG_TABLE_PROPERTIES } from './dialogs/dialog_table_properties.js';
import { DIALOG_TEXTBOX_PROPERTIES } from './dialogs/dialog_textbox_properties.js';
import { DIALOG_BARCODE_PROPERTIES } from './dialogs/dialog_barcode_properties.js';
import { DIALOG_REFERENCE_IMAGE_PROPERTIES } from './dialogs/dialog_reference_image_properties.js';
import { DIALOG_PAD_PROPERTIES } from './dialogs/dialog_pad_properties.js';
import { DIALOG_DIMENSION_PROPERTIES } from './dialogs/dialog_dimension_properties.js';
import { DIALOG_SHAPE_PROPERTIES } from './dialogs/dialog_shape_properties.js';
import type { PAD } from './pad.js';
import type { PCB_REFERENCE_IMAGE } from './pcb_reference_image.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { BOARD_ITEM } from './board_item.js';

/**
 * What `DRAWING_TOOL::PlaceImportedGraphics` reads off an OK'd
 * DIALOG_IMPORT_GRAPHICS: `GetImportedItems()`, `ShouldGroupItems()`,
 * `IsPlacementInteractive()`, `ShouldFixDiscontinuities()` and
 * `GetTolerance()` (IU).
 */
/** `PASTE_MODE` (dialog_paste_special.h). */
export type PASTE_MODE = 'UNIQUE_ANNOTATIONS' | 'KEEP_ANNOTATIONS' | 'REMOVE_ANNOTATIONS';

export interface IMPORT_GRAPHICS_RESULT {
  items: BOARD_ITEM[];
  groupItems: boolean;
  interactive: boolean;
  fixDiscontinuities: boolean;
  tolerance: number;
}
import type { DIALOG_COPPER_ZONE } from './dialogs/panel_zone_properties.js';
import type { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import type { DIALOG_RULE_AREA_PROPERTIES } from './dialogs/dialog_rule_area_properties.js';
import { ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { DRC_ENGINE } from './drc/drc_engine.js';
/**
 * Each `drc_test_provider_*.cpp` registers itself with a file-scope
 * `DRC_REGISTER_TEST_PROVIDER<...>`, so linking pcbnew is what fills
 * `DRC_TEST_PROVIDER_REGISTRY`. A module's initialiser runs only when
 * something imports it, and nothing outside `qa` did: the app built the
 * engine below over an EMPTY registry, and `Run DRC` reported zero
 * violations on a board KiCad finds 176 in. The engine is constructed here,
 * so the providers are pulled in here.
 */
import './browser/drc_test_providers.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { EVENTS } from '@ziroeda/common/tool/tool_event.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type {
  LAYER_PRESET,
  PCB_SELECTION_FILTER_OPTIONS,
  VIEWPORT,
} from '@ziroeda/common/project/board_project_settings.js';
import type { BOARD } from './board.js';
import type { PCB_VIEW } from './pcb_view.js';
import { PCB_BASE_FRAME } from './pcb_base_frame.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import { UNDO_REDO_MIXIN } from './undo_redo.js';

/**
 * `APPEARANCE_CONTROLS` as the frame calls it (`pcbnew/widgets/appearance_controls.h`):
 * the user's layer presets and viewports, and the preset in force. The widget is
 * the window's (`widgets/appearance_controls.tsx`); the window sets
 * `m_appearancePanel` to its answer.
 */
export interface APPEARANCE_CONTROLS_LIKE {
  GetUserLayerPresets(): LAYER_PRESET[];
  SetUserLayerPresets(aPresetList: LAYER_PRESET[]): void;
  GetActiveLayerPreset(): string;
  GetUserViewports(): VIEWPORT[];
  SetUserViewports(aPresetList: VIEWPORT[]): void;
  /** `APPEARANCE_CONTROLS::SetLayerVisible`. */
  SetLayerVisible?(aLayer: number, isVisible: boolean): void;
  /** `APPEARANCE_CONTROLS::SetObjectVisible`. */
  SetObjectVisible?(aLayer: number, isVisible: boolean): void;
}

/** `PCB_VERTEX_EDITOR_PANE` as the frame calls it (`pcbnew/widgets/vertex_editor_pane.h`). */
export interface PCB_VERTEX_EDITOR_PANE_LIKE {
  OnSelectionChanged(aItem: BOARD_ITEM | null): void;
}

/** `PANEL_SELECTION_FILTER` as the frame calls it (`pcbnew/widgets/panel_selection_filter.h`). */
export interface PANEL_SELECTION_FILTER_LIKE {
  SetCheckboxesFromFilter(aOptions: PCB_SELECTION_FILTER_OPTIONS): void;
  /** `OnFlashEvent`: flash the checkboxes of the categories `aOptions` names. */
  OnFlashEvent?(aOptions: PCB_SELECTION_FILTER_OPTIONS): void;
}

export interface PCB_BASE_EDIT_FRAME extends UNDO_REDO_MIXIN {
  // PCB_BASE_FRAME's virtual no-op, overridden by UNDO_REDO_MIXIN's: stated
  // here so the two declarations resolve to the edit frame's overloads.
  SaveCopyInUndoList(aItem: EDA_ITEM, aCommandType: UNDO_REDO): void;
  SaveCopyInUndoList(aItemsList: PICKED_ITEMS_LIST, aCommandType: UNDO_REDO): void;
}

/**
 * What draws PCB_BASE_EDIT_FRAME's dialogs: the window's half of each
 * `Show…Dialog`. Every member is optional — a frame with no window shows none.
 */
export interface PCB_BASE_EDIT_FRAME_DIALOG_HOOKS {
  /** DIALOG_PASTE_SPECIAL: the chosen mode and clear-nets, or null for Cancel. */
  showPasteSpecialDialog?(
    aShowClearNets: boolean,
  ): Promise<{ mode: PASTE_MODE; clearNets: boolean } | null>;
  /** DIALOG_PAGES_SETTINGS: true when OK wrote the page and title block into the frame. */
  showPageSettingsDialog?(): Promise<boolean>;
  /** DIALOG_IMPORT_GRAPHICS: what OK read off it, or null. */
  showImportGraphicsDialog?(aFilenameOverride?: string): Promise<IMPORT_GRAPHICS_RESULT | null>;
  /** DIALOG_BARCODE_PROPERTIES on a live barcode, new or not; true when OK closed it. */
  showBarcodePropertiesDialog?(aDialog: DIALOG_BARCODE_PROPERTIES): Promise<boolean>;
  /** DIALOG_TEXTBOX_PROPERTIES on a live text box, new or not; true when OK closed it. */
  showTextBoxPropertiesDialog?(aDialog: DIALOG_TEXTBOX_PROPERTIES): Promise<boolean>;
  /** The "Choose Image" file dialog: the bytes chosen, or null for Cancel. */
  showImageFileDialog?(): Promise<Uint8Array | null>;
  /** DIALOG_TABLE_PROPERTIES on a live table, new or not; true when OK closed it. */
  showTablePropertiesDialog?(aDialog: DIALOG_TABLE_PROPERTIES): Promise<boolean>;
  /** A zone's properties dialog on a ZONE_SETTINGS alone; true when OK closed it. */
  showZoneSettingsDialog?(
    aDialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES,
  ): Promise<boolean>;
  /** DIALOG_TEXT_PROPERTIES shown quasi-modally; true when OK closed it. */
  showTextPropertiesDialog?(aDialog: DIALOG_TEXT_PROPERTIES): Promise<boolean>;
  /** DIALOG_REFERENCE_IMAGE_PROPERTIES, modal: true when OK closed it. */
  showReferenceImagePropertiesDialog?(aDialog: DIALOG_REFERENCE_IMAGE_PROPERTIES): Promise<boolean>;
  /** `ShowPadPropertiesDialog`: DIALOG_PAD_PROPERTIES, modal. */
  showPadPropertiesDialog?(aDialog: DIALOG_PAD_PROPERTIES): void;
  /** `DIALOG_DIMENSION_PROPERTIES dlg( this, dim ); dlg.ShowModal()`. */
  showDimensionPropertiesDialog?(aDialog: DIALOG_DIMENSION_PROPERTIES): void;
  /** `ShowGraphicItemPropertiesDialog`: DIALOG_SHAPE_PROPERTIES, modal. */
  showGraphicItemPropertiesDialog?(aDialog: DIALOG_SHAPE_PROPERTIES): void;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (UNDO_REDO_MIXIN mixin, see libs/core/mixins.ts)
export abstract class PCB_BASE_EDIT_FRAME extends PCB_BASE_FRAME {
  protected m_undoRedoBlocked = false;

  /** `m_selectionFilterPanel` (pcb_base_edit_frame.h:281): set by the window that docks it. */
  m_selectionFilterPanel: PANEL_SELECTION_FILTER_LIKE | null = null;
  /** `m_appearancePanel` (pcb_base_edit_frame.h:282): set by the window that docks it. */
  m_appearancePanel: APPEARANCE_CONTROLS_LIKE | null = null;
  /**
   * `m_vertexEditorPane` (pcb_base_edit_frame.h:285): the floating Edit Vertices
   * pane, which the window creates and floats.
   */
  m_vertexEditorPane: PCB_VERTEX_EDITOR_PANE_LIKE | null = null;

  /** `UpdateVertexEditorSelection( aItem )` (pcb_base_edit_frame.cpp:470-474). */
  UpdateVertexEditorSelection(aItem: BOARD_ITEM | null): void {
    if (this.m_vertexEditorPane) this.m_vertexEditorPane.OnSelectionChanged(aItem);
  }

  /** `OnVertexEditorPaneClosed( aPane )` (pcb_base_edit_frame.cpp:476-480). */
  OnVertexEditorPaneClosed(aPane: PCB_VERTEX_EDITOR_PANE_LIKE): void {
    if (this.m_vertexEditorPane === aPane) this.m_vertexEditorPane = null;
  }

  protected override unitsChangeRefresh(): void {
    super.unitsChangeRefresh();

    const board = this.GetBoard();

    if (board) {
      board.UpdateUserUnits(board, this.GetCanvas()?.GetView() ?? null);
      this.m_toolManager?.PostEvent(EVENTS.SelectedItemsModified);
    }

    this.ReCreateAuxiliaryToolbar();
    this.UpdateProperties();
  }

  /**
   * The frame's `wxEVT_IDLE` handler (pcb_base_edit_frame.cpp:75-88): "Handle
   * cursor adjustments. While we can get motion and key events through
   * wxWidgets, we can't get modifier-key-up events." A page has no idle event;
   * the frame calls this after each canvas event and each key the window sees.
   */
  OnIdle(): void {
    if (this.m_toolManager) {
      const selTool = this.m_toolManager.FindTool('common.InteractiveSelection') as unknown as {
        OnIdle(): void;
      } | null;

      if (selTool) selTool.OnIdle();
    }
  }

  /**
   * `HighlightSelectionFilter( aOptions )` (pcb_base_edit_frame.cpp:428-432):
   * `wxPostEvent` of a `PCB_SELECTION_FILTER_EVENT`, which the Selection Filter
   * panel answers by flashing the checkboxes that rejected a click.
   */
  HighlightSelectionFilter(aOptions: PCB_SELECTION_FILTER_OPTIONS): void {
    queueMicrotask(() => this.m_selectionFilterPanel?.OnFlashEvent?.(aOptions));
  }

  /**
   * The window that draws this frame's dialogs. Each dialog below is the
   * model KiCad's method builds, handed to the window to show; a frame with
   * no window answers Cancel. PCB_EDIT_FRAME and FOOTPRINT_EDIT_FRAME answer
   * with their hooks.
   */
  protected dialogHooks(): PCB_BASE_EDIT_FRAME_DIALOG_HOOKS {
    return {};
  }

  /**
   * `DIALOG_TEXT_PROPERTIES dlg( frame, text ); dlg.ShowQuasiModal() == wxID_OK`:
   * the window shows it and answers whether OK closed it.
   */
  ShowTextPropertiesDialog(aDialog: DIALOG_TEXT_PROPERTIES): Promise<boolean> {
    return this.dialogHooks().showTextPropertiesDialog?.(aDialog) ?? Promise.resolve(false);
  }

  /**
   * `InvokeCopperZonesEditor` / `InvokeNonCopperZonesEditor` /
   * `InvokeRuleAreaEditor` on a ZONE_SETTINGS alone: whether OK closed it.
   */
  ShowZoneSettingsDialog(
    aDialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES,
  ): Promise<boolean> {
    return this.dialogHooks().showZoneSettingsDialog?.(aDialog) ?? Promise.resolve(false);
  }

  /** `DIALOG_TABLE_PROPERTIES( frame, table ).ShowQuasiModal() == wxID_OK`, on the live table. */
  ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<boolean> {
    return (
      this.dialogHooks().showTablePropertiesDialog?.(new DIALOG_TABLE_PROPERTIES(this, aTable)) ??
      Promise.resolve(false)
    );
  }

  /**
   * `wxFileDialog( this, _( "Choose Image" ), ..., FILEEXT::ImageFileWildcard(), wxFD_OPEN )`:
   * the bytes of the file chosen, or null for Cancel.
   */
  ShowImageFileDialog(): Promise<Uint8Array | null> {
    return this.dialogHooks().showImageFileDialog?.() ?? Promise.resolve(null);
  }

  /**
   * `ShowTextBoxPropertiesDialog( aTextBox )` (dialog_textbox_properties.cpp:185-191):
   * `DIALOG_TEXTBOX_PROPERTIES( this, aTextBox ).ShowQuasiModal() == wxID_OK`.
   */
  ShowTextBoxPropertiesDialog(aTextBox: PCB_TEXTBOX): Promise<boolean> {
    return (
      this.dialogHooks().showTextBoxPropertiesDialog?.(
        new DIALOG_TEXTBOX_PROPERTIES(this, aTextBox),
      ) ?? Promise.resolve(false)
    );
  }

  /**
   * `DIALOG_BARCODE_PROPERTIES( this, aBarcode ).ShowModal() == wxID_OK`, as
   * `DRAWING_TOOL::DrawBarcode` and `EDIT_TOOL::Properties` open it.
   */
  ShowBarcodePropertiesDialog(aBarcode: PCB_BARCODE): Promise<boolean> {
    return (
      this.dialogHooks().showBarcodePropertiesDialog?.(
        new DIALOG_BARCODE_PROPERTIES(this, aBarcode),
      ) ?? Promise.resolve(false)
    );
  }

  /**
   * `DIALOG_IMPORT_GRAPHICS( this )`, `SetFilenameOverride` on a drop, then
   * `ShowModal() == wxID_OK`: what OK read off it, or null for any other answer.
   */
  ShowImportGraphicsDialog(aFilenameOverride?: string): Promise<IMPORT_GRAPHICS_RESULT | null> {
    return (
      this.dialogHooks().showImportGraphicsDialog?.(aFilenameOverride) ?? Promise.resolve(null)
    );
  }

  /**
   * `DIALOG_PAGES_SETTINGS( this, … ).ShowModal() == wxID_OK`
   * (board_editor_control.cpp:526-533). OK has written the page and the title
   * block into the frame (`SetPageSettings` / `SetTitleBlock`).
   */
  ShowPageSettingsDialog(): Promise<boolean> {
    return this.dialogHooks().showPageSettingsDialog?.() ?? Promise.resolve(false);
  }

  /**
   * `DIALOG_PASTE_SPECIAL( this, &mode, "REF**" )`, `HideClearNets()` unless
   * `aShowClearNets`, then `ShowModal()`: the mode and `GetClearNets()`, or null
   * for Cancel.
   */
  ShowPasteSpecialDialog(
    aShowClearNets: boolean,
  ): Promise<{ mode: PASTE_MODE; clearNets: boolean } | null> {
    return this.dialogHooks().showPasteSpecialDialog?.(aShowClearNets) ?? Promise.resolve(null);
  }

  /**
   * `PCB_BASE_EDIT_FRAME::ShowReferenceImagePropertiesDialog`
   * (dialog_reference_image_properties.cpp:77-89).
   */
  ShowReferenceImagePropertiesDialog(aBitmap: PCB_REFERENCE_IMAGE): void {
    const dlg = new DIALOG_REFERENCE_IMAGE_PROPERTIES(this, aBitmap);

    void (
      this.dialogHooks().showReferenceImagePropertiesDialog?.(dlg) ?? Promise.resolve(false)
    ).then((aOk) => {
      if (!aOk) return;

      // The bitmap is cached in Opengl: clear the cache in case it has become invalid
      this.GetCanvas()?.GetView().RecacheAllItems();
      this.m_toolManager?.PostEvent(EVENTS.SelectedItemsModified);
      this.OnModify();
    });
  }

  /** `PCB_BASE_FRAME::ShowPadPropertiesDialog( PAD* aPad )`. */
  ShowPadPropertiesDialog(aPad: PAD): void {
    this.dialogHooks().showPadPropertiesDialog?.(new DIALOG_PAD_PROPERTIES(this, aPad));
  }

  /** `OnEditItemRequest`'s dimension arm: `DIALOG_DIMENSION_PROPERTIES dlg( this, dim )`. */
  ShowDimensionPropertiesDialog(aDimension: PCB_DIMENSION_BASE): void {
    this.dialogHooks().showDimensionPropertiesDialog?.(
      new DIALOG_DIMENSION_PROPERTIES(this, aDimension),
    );
  }

  /** `PCB_BASE_EDIT_FRAME::ShowGraphicItemPropertiesDialog( PCB_SHAPE* aShape )`. */
  ShowGraphicItemPropertiesDialog(aShape: PCB_SHAPE): void {
    this.dialogHooks().showGraphicItemPropertiesDialog?.(new DIALOG_SHAPE_PROPERTIES(this, aShape));
  }

  /** `SetObjectVisible` (pcb_base_edit_frame.cpp:271-275): through the Appearance panel. */
  SetObjectVisible(aLayer: GAL_LAYER_ID, aVisible = true): void {
    if (this.m_appearancePanel) this.m_appearancePanel.SetObjectVisible?.(aLayer, aVisible);
  }

  /** `APPEARANCE_CONTROLS* GetAppearancePanel()` (pcb_base_edit_frame.h:244). */
  GetAppearancePanel(): APPEARANCE_CONTROLS_LIKE | null {
    return this.m_appearancePanel;
  }

  /** The canvas's view, as the undo code needs it (`KIGFX::PCB_VIEW`). */
  protected pcbView(): PCB_VIEW | null {
    return this.GetCanvas()?.GetView() ?? null;
  }

  override SetBoard(aBoard: BOARD | null, aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    const is_new_board = aBoard !== this.m_pcb;

    if (is_new_board) {
      if (this.m_toolManager) this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);

      this.OnBoardChanging();

      this.GetCanvas()?.GetView().Clear();
      this.GetCanvas()?.GetView().InitPreview();
    }

    super.SetBoard(aBoard, aReporter);

    if (aBoard)
      this.GetCanvas()?.GetGAL().SetGridOrigin(aBoard.GetDesignSettings().GetGridOrigin());

    if (is_new_board && aBoard) {
      const bds = aBoard.GetDesignSettings();
      bds.m_DRCEngine = new DRC_ENGINE(aBoard, bds);
    }

    // update the tool manager with the new board and its view.
    if (this.m_toolManager) {
      const canvas = this.GetCanvas();

      if (canvas && aBoard) {
        canvas.DisplayBoard(aBoard, aReporter);

        canvas.UpdateColors();
      }

      this.m_toolManager.SetEnvironment(
        aBoard,
        canvas?.GetView() ?? null,
        canvas?.GetViewControls() ?? null,
        this.config(),
        this,
      );

      if (is_new_board) this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);
    }
  }

  /** `EDA_EVT_BOARD_CHANGING`, the event `SetBoard` raises before the swap. */
  protected OnBoardChanging(): void {}

  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    const cfg = this.GetPcbNewSettings();
    return GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME);
  }

  /**
   * `wxMessageBox( _( "Incomplete undo/redo operation: some items not found" ) )`:
   * the designer's frame shows it.
   */
  protected ShowUndoRedoIncompleteMessage(): void {}

  /**
   * Check if the undo and redo operations are currently blocked.
   */
  /**
   * `GetRotationAngle()` (pcb_base_edit_frame.h:191): the step `rotateCw` /
   * `rotateCcw` turn by. The board editor's is Preferences > Editing Options'
   * "Rotation angle" (`PCB_EDIT_FRAME::GetRotationAngle`, pcb_edit_frame.cpp:1803),
   * 90 degrees when there is no configuration.
   */
  GetRotationAngle(): EDA_ANGLE {
    return this.GetPcbNewSettings()?.m_RotationAngle ?? ANGLE_90;
  }

  UndoRedoBlocked(): boolean {
    return this.m_undoRedoBlocked;
  }

  /**
   * Enable/disable undo and redo operations.
   */
  UndoRedoBlock(aBlock = true): void {
    this.m_undoRedoBlocked = aBlock;
  }
}

applyMixins(PCB_BASE_EDIT_FRAME, [UNDO_REDO_MIXIN]);
