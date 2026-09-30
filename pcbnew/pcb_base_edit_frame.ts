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
}

/** `PANEL_SELECTION_FILTER` as the frame calls it (`pcbnew/widgets/panel_selection_filter.h`). */
export interface PANEL_SELECTION_FILTER_LIKE {
  SetCheckboxesFromFilter(aOptions: PCB_SELECTION_FILTER_OPTIONS): void;
}

export interface PCB_BASE_EDIT_FRAME extends UNDO_REDO_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (UNDO_REDO_MIXIN mixin, see libs/core/mixins.ts)
export abstract class PCB_BASE_EDIT_FRAME extends PCB_BASE_FRAME {
  protected m_undoRedoBlocked = false;

  /** `m_selectionFilterPanel` (pcb_base_edit_frame.h:281): set by the window that docks it. */
  m_selectionFilterPanel: PANEL_SELECTION_FILTER_LIKE | null = null;
  /** `m_appearancePanel` (pcb_base_edit_frame.h:282): set by the window that docks it. */
  m_appearancePanel: APPEARANCE_CONTROLS_LIKE | null = null;

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
