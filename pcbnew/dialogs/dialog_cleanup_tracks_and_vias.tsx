// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CLEANUP_TRACKS_AND_VIAS` (pcbnew/dialogs/dialog_cleanup_tracks_and_vias.cpp):
 * the cleanup options and filters, a dry run that lists what TRACKS_CLEANER
 * would change ("Build Changes"), then the real run ("Update PCB").
 * `DialogCleanupTracksAndVias` below is the window, DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE over the
 * class.
 *
 * Not kept: DIALOG_SHIM's per-dialog control memory, which no model here has
 * yet; the checkboxes start cleared each time, as on a first run upstream.
 */
import { type JSX, useEffect, useReducer, useState } from 'react';
import { toCssColor } from '@ziroeda/common/gal/color4d.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { NetInfoList } from '@ziroeda/common/widgets/net_selector.js';
import { DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE } from './dialog_cleanup_tracks_and_vias_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RC_TREE_MODEL, RC_TREE_VIEW_STATE, type RC_TREE_NODE } from '@ziroeda/common/rc_item.js';
import { Reporter, RPT_SEVERITY_ACTION } from '@ziroeda/common/reporter.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { type CLEANUP_ITEM, VECTOR_CLEANUP_ITEMS_PROVIDER } from '../cleanup_item.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_LAYER_BOX_SELECTOR } from '../pcb_layer_box_selector.js';
import { LSET } from '@ziroeda/common/lset.js';
import { TRACKS_CLEANER } from '../tracks_cleaner.js';
import type { ZONE_FILLER_TOOL } from '../tools/zone_filler_tool.js';
import { _ } from '@ziroeda/wx/translation.js';

/** WX_TEXT_CTRL_REPORTER over `m_tcReport`: each Report is a line. */
class TEXT_CTRL_REPORTER extends Reporter {
  constructor(private readonly m_onChange: () => void) {
    super();
  }

  override report(message: string, severity?: number): this {
    super.report(message, severity);
    this.m_onChange();
    return this;
  }
}

export class DIALOG_CLEANUP_TRACKS_AND_VIAS {
  // Actions
  m_cbRefillZones = false;
  m_cleanShortCircuitOpt = false;
  m_cleanViasOpt = false;
  m_deleteDanglingViasOpt = false;
  m_mergeSegmOpt = false;
  m_deleteUnconnectedOpt = false;
  m_deleteTracksInPadsOpt = false;

  // Filter Items
  m_netFilterOpt = false;
  m_netFilter = 0;
  m_netclassFilterOpt = false;
  m_netclassFilter = '';
  m_layerFilterOpt = false;
  /** A PCB_LAYER_BOX_SELECTOR that never offers AllNonCuMask(). */
  readonly m_layerFilter = new PCB_LAYER_BOX_SELECTOR();
  m_selectedItemsFilter = false;

  /** `m_outputBook`: 0 the changes list, 1 the progress report. */
  m_outputPage = 0;

  readonly m_changesView = new RC_TREE_VIEW_STATE();
  readonly m_changesTreeModel: RC_TREE_MODEL;
  readonly m_reporter: TEXT_CTRL_REPORTER;
  readonly m_netclassNames: string[] = [];

  private readonly m_brd: BOARD;
  private m_firstRun = true;
  private m_items: CLEANUP_ITEM[] = [];
  private readonly m_listeners = new Set<() => void>();

  constructor(private readonly m_parentFrame: PCB_BASE_EDIT_FRAME) {
    this.m_brd = m_parentFrame.GetBoard()!;
    this.m_reporter = new TEXT_CTRL_REPORTER(() => this.notify());

    // Populate the netclass filter list with netclass names
    const settings = this.m_brd.GetDesignSettings().m_NetSettings;

    this.m_netclassNames.push(settings.GetDefaultNetclass().GetName());

    for (const name of settings.GetNetclasses().keys()) this.m_netclassNames.push(name);

    // Populate the layer filter list
    this.m_layerFilter.SetBoardFrame(m_parentFrame);
    this.m_layerFilter.SetLayersHotkeys(false);
    this.m_layerFilter.SetNotAllowedLayerSet(LSET.AllNonCuMask());
    this.m_layerFilter.Resync();

    this.m_changesTreeModel = new RC_TREE_MODEL(
      m_parentFrame as unknown as ConstructorParameters<typeof RC_TREE_MODEL>[0],
      this.m_changesView,
    );
  }

  /** `m_netFilter->SetNetInfo( &m_brd->GetNetInfo() )`. */
  GetNetInfo(): NetInfoList {
    return new Map(
      [...this.m_brd.GetNetInfo().NetsByNetcode()].map(
        ([code, net]) => [code, net.GetNetname()] as const,
      ),
    );
  }

  /** `setupOKButtonLabel`. */
  GetOKLabel(): string {
    return this.m_firstRun ? _('Build Changes') : _('Update PCB');
  }

  /** Any option or filter changed: the listed changes are stale. */
  OnCheckBox(): void {
    this.m_changesTreeModel.Update(null, RPT_SEVERITY_ACTION);
    this.m_firstRun = true;
    this.notify();
  }

  TransferDataToWindow(): boolean {
    const highlighted = this.m_brd.GetHighLightNetCodes();

    if (highlighted.size > 0) this.m_netFilter = [...highlighted][0]!;

    this.m_netclassFilter = this.m_brd.GetDesignSettings().GetCurrentNetClassName();
    this.m_layerFilter.SetLayerSelection(this.m_parentFrame.GetActiveLayer());
    return true;
  }

  /** OK: a dry run the first time (false keeps the dialog up), the cleanup after. */
  async TransferDataFromWindow(): Promise<boolean> {
    const dryRun = this.m_firstRun;

    await this.doCleanup(dryRun);

    return !dryRun;
  }

  private filter(aItem: BOARD_CONNECTED_ITEM): boolean {
    if (this.m_selectedItemsFilter) {
      if (!aItem.IsSelected()) {
        let group = aItem.GetParentGroup();

        while (group && !group.AsEdaItem().IsSelected()) group = group.AsEdaItem().GetParentGroup();

        if (!group) return true;
      }
    }

    if (this.m_netFilterOpt) {
      if (aItem.GetNetCode() !== this.m_netFilter) return true;
    }

    if (this.m_netclassFilterOpt) {
      const netclass = aItem.GetEffectiveNetClass();

      if (!netclass.ContainsNetclassWithName(this.m_netclassFilter)) return true;
    }

    if (this.m_layerFilterOpt) {
      if (aItem.GetLayer() !== this.m_layerFilter.GetLayerSelection()) return true;
    }

    return false;
  }

  private async doCleanup(aDryRun: boolean): Promise<void> {
    this.m_reporter.clear();

    const commit = new BOARD_COMMIT(this.m_parentFrame);
    const cleaner = new TRACKS_CLEANER(this.m_brd, commit);
    const toolMgr = this.m_parentFrame.GetToolManager()!;

    cleaner.SetFilter((aItem) => this.filter(aItem));

    this.m_outputPage = 1;
    this.notify();

    if (!aDryRun) {
      // Clear current selection list to avoid selection of deleted items
      toolMgr.RunAction(ACTIONS.selectionClear);

      // ... and to keep the treeModel from trying to refresh a deleted item
      this.m_changesTreeModel.Update(null, RPT_SEVERITY_ACTION);
    }

    this.m_items = [];

    const zoneFiller = toolMgr.FindTool('pcbnew.ZoneFiller') as unknown as ZONE_FILLER_TOOL | null;

    if (this.m_firstRun) {
      if (this.m_cbRefillZones) {
        this.m_reporter.report(_('Checking zones...'));
        await zoneFiller?.CheckAllZones(this);
      }

      this.m_firstRun = false;
    }

    // Old model has to be refreshed, GAL normally does not keep updating it
    this.m_reporter.report(_('Rebuilding connectivity...'));
    this.m_parentFrame.Compile_Ratsnest(false);

    cleaner.CleanupBoard(
      aDryRun,
      this.m_items,
      this.m_cleanShortCircuitOpt,
      this.m_cleanViasOpt,
      this.m_mergeSegmOpt,
      this.m_deleteUnconnectedOpt,
      this.m_deleteTracksInPadsOpt,
      this.m_deleteDanglingViasOpt,
      this.m_reporter,
    );

    if (this.m_cbRefillZones && !aDryRun) {
      this.m_reporter.report(_('Refilling all zones...'));
      await zoneFiller?.FillAllZones(this);
    }

    if (aDryRun) {
      this.m_changesTreeModel.Update(
        new VECTOR_CLEANUP_ITEMS_PROVIDER(this.m_items),
        RPT_SEVERITY_ACTION,
      );
    } else if (!commit.Empty()) {
      commit.Push(_('Board Cleanup'));
      this.m_parentFrame.GetCanvas()?.Refresh(true);
    }

    this.m_outputPage = 0;
    this.notify();
  }

  /** `OnSelectItem`: focus the board on the change's item. */
  OnSelectItem(aNode: RC_TREE_NODE | null): void {
    const itemID = aNode ? RC_TREE_MODEL.ToUUID(aNode) : null;
    const item = itemID ? this.m_brd.ResolveItem(itemID, true) : null;

    if (item) {
      this.m_parentFrame.FocusOnItem(item);
      this.m_parentFrame.GetCanvas()?.Refresh();
    }
  }

  GetReportLines(): string[] {
    return this.m_reporter.lines.map((l) => l.message);
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

type OPT =
  | 'm_cbRefillZones'
  | 'm_cleanShortCircuitOpt'
  | 'm_cleanViasOpt'
  | 'm_deleteDanglingViasOpt'
  | 'm_mergeSegmOpt'
  | 'm_deleteUnconnectedOpt'
  | 'm_deleteTracksInPadsOpt'
  | 'm_netFilterOpt'
  | 'm_netclassFilterOpt'
  | 'm_layerFilterOpt'
  | 'm_selectedItemsFilter';

/** `ShowModal()` of DIALOG_CLEANUP_TRACKS_AND_VIAS. */
export function DialogCleanupTracksAndVias({
  dialog,
  onClose,
}: {
  dialog: DIALOG_CLEANUP_TRACKS_AND_VIAS;
  onClose: () => void;
}): JSX.Element {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  // wxBusyCursor: the run is async here, so OK is held off until it returns rather than
  // started twice.
  const [busy, setBusy] = useState(false);

  useEffect(() => dialog.Subscribe(redraw), [dialog]);

  // onInitDialog -> TransferDataToWindow
  useEffect(() => {
    dialog.TransferDataToWindow();
    redraw();
  }, [dialog]);

  const opt = (aKey: OPT) => ({
    value: dialog[aKey],
    onChange: (aOn: boolean) => {
      dialog[aKey] = aOn;
      dialog.OnCheckBox();
    },
  });

  const ok = async (): Promise<void> => {
    setBusy(true);

    try {
      if (await dialog.TransferDataFromWindow()) onClose();
    } finally {
      setBusy(false);
    }
  };

  const layers = dialog.m_layerFilter;

  return (
    <DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE
      m_cbRefillZones={opt('m_cbRefillZones')}
      m_cleanShortCircuitOpt={opt('m_cleanShortCircuitOpt')}
      m_cleanViasOpt={opt('m_cleanViasOpt')}
      m_deleteDanglingViasOpt={opt('m_deleteDanglingViasOpt')}
      m_mergeSegmOpt={opt('m_mergeSegmOpt')}
      m_deleteUnconnectedOpt={opt('m_deleteUnconnectedOpt')}
      m_deleteTracksInPadsOpt={opt('m_deleteTracksInPadsOpt')}
      m_netFilterOpt={opt('m_netFilterOpt')}
      m_netFilter={{
        netInfo: dialog.GetNetInfo(),
        netcode: dialog.m_netFilter,
        // OnNetFilterSelect
        onChange: (aNetcode) => {
          dialog.m_netFilter = aNetcode;
          dialog.OnCheckBox();
        },
      }}
      m_netclassFilterOpt={opt('m_netclassFilterOpt')}
      m_netclassFilterChoices={dialog.m_netclassNames}
      m_netclassFilter={{
        value: dialog.m_netclassNames.indexOf(dialog.m_netclassFilter),
        // OnNetclassFilterSelect
        onChange: (aIndex) => {
          dialog.m_netclassFilter = dialog.m_netclassNames[aIndex]!;
          dialog.OnCheckBox();
        },
      }}
      m_layerFilterOpt={opt('m_layerFilterOpt')}
      m_layerFilter={{
        rows: layers.GetRows().map((r) => ({
          value: LSET_Name(r.layerid),
          label: r.name,
          swatch: r.swatch ? toCssColor(r.swatch) : undefined,
        })),
        value: LSET_Name(layers.GetLayerSelection() as PCB_LAYER_ID),
        // OnLayerFilterSelect
        onChange: (aLayer) => {
          layers.SetLayerSelection(LSET_NameToLayer(aLayer as never) as PCB_LAYER_ID);
          dialog.OnCheckBox();
        },
      }}
      m_selectedItemsFilter={opt('m_selectedItemsFilter')}
      m_outputBook={dialog.m_outputPage}
      m_changesTreeModel={dialog.m_changesTreeModel}
      m_changesView={dialog.m_changesView}
      OnSelectItem={(aNode) => dialog.OnSelectItem(aNode)}
      m_tcReport={dialog.GetReportLines().join('\n')}
      okLabel={dialog.GetOKLabel()}
      okEnabled={!busy}
      onOK={() => void ok()}
      onCancel={onClose}
    />
  );
}
