// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GLOBAL_EDIT_TOOL` (pcbnew/tools/global_edit_tool.cpp, global_edit_tool.h),
 * on the live BOARD: the board-wide edits of the Edit and Tools menus.
 *
 * Ported so far: SwapLayers and ZonesManager. The other handlers
 * (ExchangeFootprints, EditTracksAndVias, EditTextAndGraphics, EditTeardrops,
 * GlobalDeletions, CleanupTracksAndVias, CleanupGraphics, RemoveUnusedPads,
 * Migrate3DModels) land with their dialogs, each adding its Go() here.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { EVENTS, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import { DIALOG_SWAP_LAYERS } from '../dialogs/dialog_swap_layers.js';
import { DIALOG_CLEANUP_TRACKS_AND_VIAS } from '../dialogs/dialog_cleanup_tracks_and_vias.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';

const GEOMETRY = VIEW_UPDATE_FLAGS.GEOMETRY;

/** What GLOBAL_EDIT_TOOL asks of PCB_EDIT_FRAME beyond PCB_BASE_EDIT_FRAME. */
export interface GLOBAL_EDIT_TOOL_FRAME {
  /** `DIALOG_SWAP_LAYERS dlg( frame(), layerMap ); dlg.ShowModal() == wxID_OK`. */
  ShowSwapLayersDialog(aDialog: DIALOG_SWAP_LAYERS): Promise<boolean>;
  /** `DIALOG_CLEANUP_TRACKS_AND_VIAS dlg( editFrame ); dlg.ShowModal()`. */
  ShowCleanupTracksAndViasDialog(aDialog: DIALOG_CLEANUP_TRACKS_AND_VIAS): void;
  /** `DIALOG_ZONE_MANAGER dlg( editFrame ); dlg.ShowQuasiModal()`, and its repour box. */
  ShowZoneManagerDialog(): Promise<{ ok: boolean; repour: boolean }>;
}

type FRAME = PCB_BASE_EDIT_FRAME & GLOBAL_EDIT_TOOL_FRAME;

export class GLOBAL_EDIT_TOOL extends PCB_TOOL_BASE {
  private m_commit: BOARD_COMMIT | null = null;

  constructor() {
    super('pcbnew.GlobalEdit');
  }

  override Reset(aReason: RESET_REASON): void {
    if (aReason !== RESET_REASON.RUN) this.m_commit = new BOARD_COMMIT(this);
  }

  override Init(): boolean {
    return true;
  }

  private editFrame(): FRAME {
    return this.getEditFrame<FRAME>();
  }

  /** One item's layer set through the map; true when it changed. */
  private swapBoardItem(aItem: BOARD_ITEM, aLayerMap: Map<PCB_LAYER_ID, PCB_LAYER_ID>): boolean {
    const originalLayers = aItem.GetLayerSet();
    const newLayers = new LSET();

    for (const original of originalLayers.Seq()) {
      if (aLayerMap.has(original)) newLayers.set(aLayerMap.get(original)!);
      else newLayers.set(original);
    }

    if (!originalLayers.equals(newLayers)) {
      this.m_commit!.Modify(aItem);
      aItem.SetLayerSet(newLayers);
      this.frame().GetCanvas()?.GetView().Update(aItem, GEOMETRY);
      return true;
    }

    return false;
  }

  SwapLayers(_aEvent: TOOL_EVENT): number {
    const layerMap = new Map<PCB_LAYER_ID, PCB_LAYER_ID>();
    const dlg = new DIALOG_SWAP_LAYERS(this.frame(), layerMap);

    dlg.TransferDataToWindow();

    void this.editFrame()
      .ShowSwapLayersDialog(dlg)
      .then((aOk) => {
        if (!aOk) return;

        this.doSwapLayers(layerMap);
      });

    return 0;
  }

  /** SwapLayers after `ShowModal() == wxID_OK` (global_edit_tool.cpp:145-190). */
  private doSwapLayers(layerMap: Map<PCB_LAYER_ID, PCB_LAYER_ID>): void {
    // `layerMap[ layer ]` is std::map::operator[]: a layer with no row reads
    // (and is inserted as) PCB_LAYER_ID 0, F_Cu.
    const at = (aLayer: PCB_LAYER_ID): PCB_LAYER_ID => {
      if (!layerMap.has(aLayer)) layerMap.set(aLayer, PCB_LAYER_ID.F_Cu);
      return layerMap.get(aLayer)!;
    };

    const board = this.frame().GetBoard()!;
    let hasChanges = false;

    // Change tracks.
    for (const segm of board.Tracks()) {
      if (segm.Type() === KICAD_T.PCB_VIA_T) {
        const via = segm as unknown as PCB_VIA;

        if (via.GetViaType() === VIATYPE.THROUGH) continue;

        const [top_layer, bottom_layer] = via.LayerPair();

        if (at(bottom_layer) !== bottom_layer || at(top_layer) !== top_layer) {
          this.m_commit!.Modify(via);
          via.SetLayerPair(at(top_layer), at(bottom_layer));
          this.frame().GetCanvas()?.GetView().Update(via, GEOMETRY);
          hasChanges = true;
        }
      } else {
        hasChanges = this.swapBoardItem(segm, layerMap) || hasChanges;
      }
    }

    for (const generator of board.Generators())
      hasChanges = this.swapBoardItem(generator, layerMap) || hasChanges;

    for (const zone of board.Zones()) hasChanges = this.swapBoardItem(zone, layerMap) || hasChanges;

    for (const drawing of board.Drawings())
      hasChanges = this.swapBoardItem(drawing, layerMap) || hasChanges;

    if (hasChanges) {
      this.frame().OnModify();
      this.m_commit!.Push('Swap Layers');
      this.frame().GetCanvas()?.Refresh();
    }
  }

  CleanupTracksAndVias(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();
    const dlg = new DIALOG_CLEANUP_TRACKS_AND_VIAS(editFrame);

    editFrame.ShowCleanupTracksAndViasDialog(dlg);
    return 0;
  }

  /**
   * The Zone Manager. Upstream's BOARD_COMMIT is filled with Modify( zone )
   * and never pushed, so the change files no undo entry.
   */
  ZonesManager(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();
    const commit = new BOARD_COMMIT(editFrame);
    const board = editFrame.GetBoard()!;

    for (const zone of board.Zones()) commit.Modify(zone);

    void editFrame.ShowZoneManagerDialog().then(({ ok, repour }) => {
      if (!ok) return;

      // Ensure all zones are deselected before make any change in view, to avoid
      // dangling pointers in EDIT_POINT
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      // OnModify must be called first to clear the zone bounding box cache before
      // we update the VIEW.
      editFrame.OnModify();

      for (const zone of board.Zones()) editFrame.GetCanvas()?.GetView().Update(zone);

      // TRANSITIONAL (#636 stage 3): the window's view board re-derives from
      // the board's listeners; KiCad's VIEW::Update above is enough upstream.
      board.OnItemsChanged([...board.Zones()]);

      //rebuildConnectivity
      board.BuildConnectivity();

      this.m_toolMgr?.PostEvent(EVENTS.ConnectivityChangedEvent);

      editFrame.GetCanvas()?.RedrawRatsnest();

      if (repour) this.m_toolMgr?.PostAction(PCB_ACTIONS.zoneFillAll);
    });

    return 0;
  }

  protected override setTransitions(): void {
    const S = SYNC_HANDLER<GLOBAL_EDIT_TOOL>;

    this.Go(S(this.SwapLayers), PCB_ACTIONS.swapLayers.MakeEvent());
    this.Go(S(this.CleanupTracksAndVias), PCB_ACTIONS.cleanupTracksAndVias.MakeEvent());
    this.Go(S(this.ZonesManager), PCB_ACTIONS.zonesManager.MakeEvent());
  }
}
