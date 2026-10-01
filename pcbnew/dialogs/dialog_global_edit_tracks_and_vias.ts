// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS` (pcbnew/dialogs/dialog_global_edit_tracks_and_vias.cpp),
 * on the live BOARD: Edit > Edit Track & Via Properties. The scope (tracks,
 * the four via types), the filters, and either the specified values or the
 * net class / custom rule values, applied to every visited item and saved as
 * one undo entry. The window is dialog_global_edit_tracks_and_vias_ui.tsx.
 */
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../board.js';
import { SetTrackSegmentWidth } from '../edit_track_width.js';
import { UNCONNECTED_LAYER_MODE } from '../padstack.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import { TrackWidthSelectBoxContent, ViaSizeSelectBoxContent } from '../toolbars_pcb_editor.js';
import {
  IPC4761_NAMES,
  IPC4761_PRESET,
  VIA_PROTECTION_UI_MIXIN,
} from '../via_protection_ui_mixin.js';

/** `g_netclassFilter` / `g_netFilter`: the filters a closed dialog leaves for the next. */
let g_netclassFilter = '';
let g_netFilter = '';

/** `m_annularRingsCtrlChoices[]` (dialog_global_edit_tracks_and_vias_base.cpp:200). */
const ANNULAR_RING_CHOICES = [
  'All copper layers',
  'Start, end, and connected layers',
  'Connected layers only',
  'Start and end layers only',
];

/** A `wxChoice`: its strings and the selected row. */
export interface CHOICE {
  items: string[];
  selection: number;
}

const leaveUnchanged = (c: CHOICE): boolean => c.items[c.selection] === INDETERMINATE_ACTION;

export class DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS {
  // Scope
  m_tracks = true;
  m_throughVias = true;
  m_microVias = true;
  m_blindVias = true;
  m_buriedVias = true;

  // Filter Items
  m_netFilterOpt = false;
  m_netFilter = -1;
  m_netclassFilterOpt = false;
  m_netclassFilter = '';
  m_layerFilterOpt = false;
  m_layerFilter: PCB_LAYER_ID;
  m_filterByTrackWidth = false;
  readonly m_trackWidthFilter: UNIT_BINDER;
  m_filterByViaSize = false;
  readonly m_viaSizeFilter: UNIT_BINDER;
  m_selectedItemsFilter = false;

  // Action
  m_setToSpecifiedValues = true;
  /** `m_layerCtrl`: UNDEFINED_LAYER is its "-- leave unchanged --". */
  m_layerCtrl: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  m_trackWidthCtrl: CHOICE;
  m_viaSizesCtrl: CHOICE;
  m_annularRingsCtrl: CHOICE = {
    items: [...ANNULAR_RING_CHOICES, INDETERMINATE_ACTION],
    selection: 0,
  };
  m_protectionFeatures: CHOICE;

  readonly m_netclassNames: string[] = [];

  private readonly m_brd: BOARD;
  private m_items_changed: PCB_TRACK[] = [];
  private readonly m_viaProtection = new VIA_PROTECTION_UI_MIXIN();

  constructor(private readonly m_parent: PCB_EDIT_FRAME) {
    this.m_brd = m_parent.GetBoard()!;

    const provider = m_parent as unknown as ConstructorParameters<typeof UNIT_BINDER>[0];
    this.m_trackWidthFilter = new UNIT_BINDER(provider, '');
    this.m_viaSizeFilter = new UNIT_BINDER(provider, '');
    this.m_layerFilter = m_parent.GetActiveLayer();

    this.buildFilterLists();

    const bds = this.m_brd.GetDesignSettings();
    const pair = m_parent.GetUnitPair();
    const units: [typeof pair.primary, typeof pair.secondary] = [pair.primary, pair.secondary];

    this.m_trackWidthCtrl = TrackWidthSelectBoxContent(bds, units, false, false);
    this.m_trackWidthCtrl.items.push(INDETERMINATE_ACTION);

    this.m_viaSizesCtrl = ViaSizeSelectBoxContent(bds, units, false, false);
    this.m_viaSizesCtrl.items.push(INDETERMINATE_ACTION);

    const presets: string[] = [];

    // `magic_enum::enum_values<IPC4761_PRESET>()`: enum order, which is also the
    // order `static_cast<IPC4761_PRESET>( GetSelection() )` reads the row back in.
    for (let preset = 0 as IPC4761_PRESET; preset < IPC4761_PRESET.CUSTOM; preset++)
      presets.push(IPC4761_NAMES.get(preset) ?? 'Unknown choice');

    presets.push(INDETERMINATE_ACTION);
    this.m_protectionFeatures = { items: presets, selection: 0 };
  }

  private buildFilterLists(): void {
    const highlighted = this.m_brd.GetHighLightNetCodes();

    if (highlighted.size > 0) this.m_netFilter = [...highlighted][0]!;

    const settings = this.m_brd.GetDesignSettings().m_NetSettings;

    this.m_netclassNames.push(settings.GetDefaultNetclass().GetName());

    for (const name of settings.GetNetclasses().keys()) this.m_netclassNames.push(name);

    this.m_netclassFilter = this.m_brd.GetDesignSettings().GetCurrentNetClassName();
    this.m_layerFilter = this.m_parent.GetActiveLayer();
  }

  /** The tri-state "Vias" box: on, off, or (null) undetermined. */
  GetViasValue(): boolean | null {
    const checked = [
      this.m_throughVias,
      this.m_microVias,
      this.m_blindVias,
      this.m_buriedVias,
    ].filter(Boolean).length;

    if (checked === 0) return false;
    else if (checked === 4) return true;
    else return null;
  }

  /** `onVias`: the "Vias" box sets all four. */
  OnVias(aChecked: boolean): void {
    this.m_throughVias = aChecked;
    this.m_microVias = aChecked;
    this.m_blindVias = aChecked;
    this.m_buriedVias = aChecked;
  }

  /** `onActionButtonChange`: the value controls only when setting specified values. */
  ActionControlsEnabled(): boolean {
    return this.m_setToSpecifiedValues;
  }

  TransferDataToWindow(): boolean {
    this.m_netclassFilter = this.m_netclassNames.includes(g_netclassFilter)
      ? g_netclassFilter
      : this.m_netclassFilter;

    const net = this.m_brd.FindNet(g_netFilter);

    if (net) this.m_netFilter = net.GetNetCode();

    this.m_trackWidthCtrl.selection = this.m_trackWidthCtrl.items.length - 1;
    this.m_viaSizesCtrl.selection = this.m_viaSizesCtrl.items.length - 1;
    this.m_annularRingsCtrl.selection = this.m_annularRingsCtrl.items.length - 1;
    this.m_layerCtrl = PCB_LAYER_ID.UNDEFINED_LAYER;
    this.m_protectionFeatures.selection = this.m_protectionFeatures.items.length - 1;

    return true;
  }

  /** The destructor's statics: the filters the next open starts from. */
  OnClose(): void {
    g_netclassFilter = this.m_netclassFilter;
    g_netFilter = this.m_brd.FindNet(this.m_netFilter)?.GetNetname() ?? '';
  }

  private processItem(aUndoList: PICKED_ITEMS_LIST, aItem: PCB_TRACK): void {
    const brdSettings = this.m_brd.GetDesignSettings();
    const isTrack = aItem.Type() === KICAD_T.PCB_TRACE_T;
    const isArc = aItem.Type() === KICAD_T.PCB_ARC_T;
    const isVia = aItem.Type() === KICAD_T.PCB_VIA_T;

    if (this.m_setToSpecifiedValues) {
      if ((isArc || isTrack) && !leaveUnchanged(this.m_trackWidthCtrl)) {
        const prevTrackWidthIndex = brdSettings.GetTrackWidthIndex();
        const trackWidthIndex = this.m_trackWidthCtrl.selection;

        if (trackWidthIndex >= 0) brdSettings.SetTrackWidthIndex(trackWidthIndex + 1);

        SetTrackSegmentWidth(aItem, aUndoList, false);
        brdSettings.SetTrackWidthIndex(prevTrackWidthIndex);
      }

      if (isVia && !leaveUnchanged(this.m_viaSizesCtrl)) {
        const prevViaSizeIndex = brdSettings.GetViaSizeIndex();
        const viaSizeIndex = this.m_viaSizesCtrl.selection;

        if (viaSizeIndex >= 0) brdSettings.SetViaSizeIndex(viaSizeIndex + 1);

        SetTrackSegmentWidth(aItem, aUndoList, false);
        brdSettings.SetViaSizeIndex(prevViaSizeIndex);
      }

      if (isVia && !leaveUnchanged(this.m_annularRingsCtrl)) {
        const v = aItem as unknown as PCB_VIA;

        switch (this.m_annularRingsCtrl.selection) {
          case 0:
            v.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.KEEP_ALL);
            break;
          case 1:
            v.Padstack().SetUnconnectedLayerMode(
              UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END,
            );
            break;
          case 2:
            v.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
            break;
          case 3:
            v.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.START_END_ONLY);
            break;
          default:
            break;
        }
      }

      if (isVia && !leaveUnchanged(this.m_protectionFeatures)) {
        this.m_viaProtection.setViaConfiguration(
          aItem as unknown as PCB_VIA,
          this.m_protectionFeatures.selection as IPC4761_PRESET,
        );
      }

      if ((isArc || isTrack) && this.m_layerCtrl !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        if (aUndoList.FindItem(aItem) < 0) {
          const picker = new ITEM_PICKER(null, aItem, UNDO_REDO.CHANGED);
          picker.SetLink(aItem.Clone());
          aUndoList.PushItem(picker);
        }

        aItem.SetLayer(ToLAYER_ID(this.m_layerCtrl));
        this.m_brd.GetConnectivity().Update(aItem);
      }
    } else {
      SetTrackSegmentWidth(aItem, aUndoList, true);
    }

    this.m_items_changed.push(aItem);
  }

  private visitItem(aUndoList: PICKED_ITEMS_LIST, aItem: PCB_TRACK): void {
    if (this.m_selectedItemsFilter) {
      if (!aItem.IsSelected()) {
        let group = aItem.GetParentGroup();

        while (group && !group.AsEdaItem().IsSelected()) group = group.AsEdaItem().GetParentGroup();

        if (!group) return;
      }
    }

    if (this.m_netFilterOpt && this.m_netFilter >= 0) {
      if (aItem.GetNetCode() !== this.m_netFilter) return;
    }

    if (this.m_netclassFilterOpt && this.m_netclassFilter !== '') {
      const netclass = aItem.GetEffectiveNetClass();

      if (!netclass.ContainsNetclassWithName(this.m_netclassFilter)) return;
    }

    if (this.m_layerFilterOpt && this.m_layerFilter !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (aItem.GetLayer() !== this.m_layerFilter) return;
    }

    if (aItem.Type() === KICAD_T.PCB_VIA_T) {
      if (this.m_filterByViaSize && aItem.GetWidth() !== this.m_viaSizeFilter.GetValue()) return;
    } else {
      if (this.m_filterByTrackWidth && aItem.GetWidth() !== this.m_trackWidthFilter.GetValue())
        return;
    }

    this.processItem(aUndoList, aItem);
  }

  /** "Apply and Close". */
  TransferDataFromWindow(): boolean {
    const itemsListPicker = new PICKED_ITEMS_LIST();

    for (const track of this.m_brd.Tracks()) {
      if (track.Type() === KICAD_T.PCB_TRACE_T && this.m_tracks) {
        this.visitItem(itemsListPicker, track);
      } else if (track.Type() === KICAD_T.PCB_ARC_T && this.m_tracks) {
        this.visitItem(itemsListPicker, track);
      } else if (track.Type() === KICAD_T.PCB_VIA_T) {
        const via = track as unknown as PCB_VIA;

        if (via.GetViaType() === VIATYPE.THROUGH && this.m_throughVias)
          this.visitItem(itemsListPicker, via);
        else if (via.GetViaType() === VIATYPE.MICROVIA && this.m_microVias)
          this.visitItem(itemsListPicker, via);
        else if (via.GetViaType() === VIATYPE.BLIND && this.m_blindVias)
          this.visitItem(itemsListPicker, via);
        else if (via.GetViaType() === VIATYPE.BURIED && this.m_buriedVias)
          this.visitItem(itemsListPicker, via);
      }
    }

    if (itemsListPicker.GetCount() > 0) {
      this.m_parent.SaveCopyInUndoList(itemsListPicker, UNDO_REDO.CHANGED);

      for (const track of this.m_brd.Tracks()) this.m_parent.GetCanvas()?.GetView().Update(track);
    }

    this.m_parent.GetCanvas()?.ForceRefresh();

    if (this.m_items_changed.length > 0) {
      this.m_brd.OnItemsChanged(this.m_items_changed);
      this.m_parent.OnModify();

      const connectivity = this.m_brd.GetConnectivity();
      connectivity.RecalculateRatsnest();
      connectivity.ClearLocalRatsnest();
      this.m_parent.GetCanvas()?.RedrawRatsnest();
      this.m_brd.OnRatsnestChanged();
    }

    return true;
  }
}
