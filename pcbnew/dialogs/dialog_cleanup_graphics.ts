// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CLEANUP_GRAPHICS` (pcbnew/dialogs/dialog_cleanup_graphics.cpp): the
 * GRAPHICS_CLEANER options, a dry run on every change listing what would go
 * (no "Build Changes" step, unlike the tracks cleanup), and the real run on OK
 * ("Update PCB", or "Update Footprint" in the footprint editor). The window is
 * dialog_cleanup_graphics_ui.tsx.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { RC_TREE_MODEL, RC_TREE_VIEW_STATE, type RC_TREE_NODE } from '@ziroeda/common/rc_item.js';
import { RPT_SEVERITY_ACTION } from '@ziroeda/common/reporter.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { type CLEANUP_ITEM, VECTOR_CLEANUP_ITEMS_PROVIDER } from '../cleanup_item.js';
import { GRAPHICS_CLEANER } from '../graphics_cleaner.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';

/** `static int s_defaultTolerance = pcbIUScale.mmToIU( 2 )`: kept across opens. */
let s_defaultTolerance = pcbIUScale.mmToIU(2);

export class DIALOG_CLEANUP_GRAPHICS {
  m_createRectanglesOpt = false;
  m_deleteRedundantOpt = false;
  m_mergePadsOpt = false;
  m_fixBoardOutlines = false;
  readonly m_tolerance: UNIT_BINDER;

  readonly m_changesView = new RC_TREE_VIEW_STATE();
  readonly m_changesTreeModel: RC_TREE_MODEL;

  private m_items: CLEANUP_ITEM[] = [];
  private readonly m_listeners = new Set<() => void>();

  constructor(
    private readonly m_parentFrame: PCB_BASE_EDIT_FRAME,
    readonly m_isFootprintEditor: boolean,
  ) {
    this.m_tolerance = new UNIT_BINDER(
      m_parentFrame as unknown as ConstructorParameters<typeof UNIT_BINDER>[0],
      'Tolerance:',
    );
    this.m_changesTreeModel = new RC_TREE_MODEL(
      m_parentFrame as unknown as ConstructorParameters<typeof RC_TREE_MODEL>[0],
      this.m_changesView,
    );
  }

  /** `SetupStandardButtons( { { wxID_OK, ... } } )`. */
  GetOKLabel(): string {
    return this.m_isFootprintEditor ? 'Update Footprint' : 'Update PCB';
  }

  /** Any option changed: list again. */
  OnCheckBox(): void {
    this.doCleanup(true);
  }

  TransferDataToWindow(): boolean {
    this.m_tolerance.SetValue(s_defaultTolerance);
    this.doCleanup(true);
    return true;
  }

  TransferDataFromWindow(): boolean {
    s_defaultTolerance = this.m_tolerance.GetValue();
    this.doCleanup(false);
    return true;
  }

  SetToleranceText(aText: string): void {
    this.m_tolerance.SetText(aText);
    this.notify();
  }

  private doCleanup(aDryRun: boolean): void {
    const commit = new BOARD_COMMIT(this.m_parentFrame);
    const board = this.m_parentFrame.GetBoard()!;
    const fp = this.m_isFootprintEditor ? board.GetFirstFootprint() : null;
    const toolMgr = this.m_parentFrame.GetToolManager()!;
    const cleaner = new GRAPHICS_CLEANER(
      fp ? fp.GraphicalItems() : board.Drawings(),
      fp,
      commit,
      toolMgr,
    );

    if (!aDryRun) {
      // Clear current selection list to avoid selection of deleted items
      toolMgr.RunAction(ACTIONS.selectionClear);

      // ... and to keep the treeModel from trying to refresh a deleted item
      this.m_changesTreeModel.Update(null, RPT_SEVERITY_ACTION);
    }

    this.m_items = [];

    // Old model has to be refreshed, GAL normally does not keep updating it
    this.m_parentFrame.Compile_Ratsnest(false);

    cleaner.CleanupBoard(
      aDryRun,
      this.m_items,
      this.m_createRectanglesOpt,
      this.m_deleteRedundantOpt,
      this.m_mergePadsOpt,
      this.m_fixBoardOutlines,
      this.m_tolerance.GetIntValue(),
    );

    if (aDryRun) {
      this.m_changesTreeModel.Update(
        new VECTOR_CLEANUP_ITEMS_PROVIDER(this.m_items),
        RPT_SEVERITY_ACTION,
      );
    } else if (!commit.Empty()) {
      commit.Push('Cleanup Graphics');
      this.m_parentFrame.GetCanvas()?.Refresh(true);
    }

    this.notify();
  }

  /** `OnSelectItem`: show the layer the item is on, and focus on it. */
  OnSelectItem(aNode: RC_TREE_NODE | null): void {
    const itemID = aNode ? RC_TREE_MODEL.ToUUID(aNode) : null;
    const item = itemID ? this.m_parentFrame.GetBoard()!.ResolveItem(itemID, true) : null;

    if (item) {
      if (!item.GetLayerSet().Contains(this.m_parentFrame.GetActiveLayer()))
        this.m_parentFrame.SetActiveLayer(item.GetLayerSet().UIOrder()[0]!);

      this.m_parentFrame.FocusOnItem(item);
      this.m_parentFrame.GetCanvas()?.Refresh();
    }
  }

  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => {
      this.m_listeners.delete(aListener);
    };
  }

  private notify(): void {
    for (const l of this.m_listeners) l();
  }
}
