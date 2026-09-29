// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_ZONE_MANAGER's logic (zone_manager/dialog_zone_manager.ts), read off
 * dialog_zone_manager.cpp: OK writes clones back but keeps each original's
 * fill; Auto-assign copies the priorities to the clones and puts the originals
 * back; the four moves and drag-drop go through the model; the filter, layer
 * filter and Name/Net boxes re-apply the filter; Update Displayed Zones fills
 * the clones and is not re-entrant.
 */
import { describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  DIALOG_ZONE_MANAGER,
  type DIALOG_ZONE_MANAGER_UI,
  type PANEL_ZONE_PROPERTIES_LIKE,
} from '@ziroeda/pcbnew/zone_manager/dialog_zone_manager.js';
import type { wxDataViewItem } from '@ziroeda/pcbnew/zone_manager/model_zones_overview.js';
import { ZONE_PREVIEW_NOTEBOOK } from '@ziroeda/pcbnew/zone_manager/zone_preview_notebook.js';

vi.mock('@ziroeda/pcbnew/zone_utils.js', () => ({
  AutoAssignZonePriorities: (board: BOARD) => {
    // Reverse every priority, as a stand-in for the real overlap analysis.
    const zones = board.Zones();
    zones.forEach((z, i) => {
      z.SetAssignedPriority(zones.length - i);
    });
    return true;
  },
}));

function zone(board: BOARD, name: string, priority: number, layer = PCB_LAYER_ID.F_Cu): ZONE {
  const z = new ZONE(board);
  for (const p of [
    { x: 0, y: 0 },
    { x: 1e6, y: 0 },
    { x: 1e6, y: 1e6 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayer(layer);
  z.SetZoneName(name);
  z.SetAssignedPriority(priority);
  return z;
}

function setup(specs: [string, number, PCB_LAYER_ID?][]) {
  const board = new BOARD();
  const zones = specs.map(([n, p, l]) => {
    const z = zone(board, n, p, l);
    board.Add(z);
    return z;
  });
  const log: string[] = [];
  let selection: wxDataViewItem = null;
  let filterText = '';
  let choices: { name: string; layer: PCB_LAYER_ID }[] = [];
  let buttons: boolean | null = null;
  const ui: DIALOG_ZONE_MANAGER_UI = {
    GetSelection: () => selection,
    Select: (i) => {
      selection = i;
    },
    EnsureVisible: () => {},
    GetFilterText: () => filterText,
    SetLayerFilterChoices: (c) => {
      choices = [...c];
    },
    EnableMoveButtons: (e) => {
      buttons = e;
    },
    Reset: (n) => log.push(`reset ${n}`),
    RowChanged: (r) => log.push(`row ${r}`),
    GetRepourOnClose: () => true,
  };
  const panelState = { zone: null as ZONE | null, transfers: 0, valid: true };
  const panel: PANEL_ZONE_PROPERTIES_LIKE = {
    SetZone: (z) => {
      panelState.zone = z;
    },
    GetZone: () => panelState.zone,
    TransferZoneSettingsFromWindow: () => {
      panelState.transfers++;
      return panelState.valid;
    },
  };
  const notebook = new ZONE_PREVIEW_NOTEBOOK({
    GetBoard: () => board,
    CreateCanvas: () => ({
      GetView: () => ({ GetScale: () => 1, GetCenter: () => ({ x: 0, y: 0 }) }),
      LockZoom: () => {},
      ZoomFitScreen: () => {},
    }),
  });
  const fills: ZONE[][] = [];
  const frame = {
    GetBoard: () => board,
    GetColorSettings: () => new COLOR_SETTINGS(),
    FillZones: (_b: BOARD, z: ZONE[]) => {
      fills.push(z);
      // A fill takes a while and pumps events: a second click lands inside the first.
      if (reenter) dlg.OnUpdateDisplayedZonesClick();
      return true;
    },
  };
  let reenter = false;
  const dlg = new DIALOG_ZONE_MANAGER(frame, panel, notebook, ui);
  return {
    setReenter: (v: boolean) => {
      reenter = v;
    },
    board,
    zones,
    dlg,
    panelState,
    fills,
    log,
    notebook,
    choices: () => choices,
    buttons: () => buttons,
    setFilter: (t: string) => {
      filterText = t;
    },
    sel: () => selection,
  };
}

describe('DIALOG_ZONE_MANAGER construction', () => {
  it('lists the layers the zones use, selects row 0 and shows its properties and preview', () => {
    const t = setup([
      ['top', 1, PCB_LAYER_ID.F_Cu],
      ['bot', 2, PCB_LAYER_ID.B_Cu],
    ]);
    expect(t.choices().map((c) => c.layer)).toEqual([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]);
    // the initial ApplyFilter( "" ) is ClearFilter: priority order, so 'bot' (2) is row 0
    expect(t.panelState.zone!.GetZoneName()).toBe('bot');
    expect(t.notebook.GetPageCount()).toBeGreaterThan(0);
  });

  it('with no zones the properties panel is emptied', () => {
    const t = setup([]);
    expect(t.panelState.zone).toBeNull();
  });
});

describe('DIALOG_ZONE_MANAGER OK', () => {
  it('writes the clone over the original but keeps the original fill', () => {
    const t = setup([['a', 1]]);
    const orig = t.zones[0]!;
    const fill = new SHAPE_POLY_SET();
    fill.NewOutline();
    fill.Append(5, 5);
    fill.Append(9, 5);
    fill.Append(9, 9);
    orig.SetFilledPolysList(PCB_LAYER_ID.F_Cu, fill);
    // Edit the clone (what the properties panel's transfer does through the bag).
    // (UpdateClonedZones re-exports each clone's ZONE_SETTINGS, so that is what an edit changes.)
    const clone = [...t.dlg.GetBag().GetZonesCloneMap().values()][0]!;
    t.dlg.GetBag().GetZoneSettings(clone)!.m_Name = 'renamed';
    t.dlg.OnOk();
    expect(t.panelState.transfers).toBe(1);
    expect(orig.GetZoneName()).toBe('renamed');
    expect(orig.GetFilledPolysList(PCB_LAYER_ID.F_Cu).OutlineCount()).toBe(1);
  });
});

describe('DIALOG_ZONE_MANAGER priorities', () => {
  it('Move Up / Move to Bottom act on the selected row and re-select the moved zone', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    // priority order a b c. The constructor shows row 0 but does not select it in the
    // table (SelectZoneTableItem only updates the panel); the user clicks it.
    t.dlg.PostProcessZoneViewSelChange(0);
    t.dlg.OnMoveBottomClick();
    expect(t.sel()).toBe(2);
    expect(t.panelState.zone!.GetZoneName()).toBe('a');
    t.dlg.OnMoveUpClick();
    expect(t.sel()).toBe(1);
  });

  it('moves do nothing without a selection', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
    ]);
    t.dlg.OnMoveDownClick();
    const before = t.sel();
    t.dlg.OnBeginDrag(null);
    expect(t.sel()).toBe(before);
  });

  it('the move buttons follow the row count: off at one row', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
    ]);
    t.setFilter('a');
    t.dlg.OnFilterCtrlTextChange('a');
    expect(t.buttons()).toBe(false);
    t.dlg.OnFilterCtrlCancel();
    expect(t.buttons()).toBe(true);
  });

  it('drag and drop swaps the two rows and selects the drop row; a null drop is vetoed', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    t.dlg.OnBeginDrag(0);
    expect(t.dlg.OnDrop(null)).toBe(false);
    expect(t.dlg.OnDrop(2)).toBe(true);
    expect(t.sel()).toBe(2);
    expect(t.dlg.GetModel().GetZone(2)!.GetZoneName()).toBe('a');
  });

  it('Auto-assign copies the chosen priorities to the clones and restores the originals', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
    ]);
    t.dlg.OnAutoAssignClick();
    // originals back to their own priorities
    expect(t.zones.map((z) => z.GetAssignedPriority())).toEqual([3, 2]);
    // the stand-in reversed board order: zone 0 -> 2, zone 1 -> 1, and the clones took them
    const clones = [...t.dlg.GetBag().GetZonesCloneMap().values()];
    expect(clones.map((c) => c.GetAssignedPriority())).toEqual([2, 1]);
    expect(clones.map((c) => t.dlg.GetBag().GetZonePriority(c))).toEqual([2, 1]);
  });
});

describe('DIALOG_ZONE_MANAGER filters', () => {
  it('the layer filter narrows the table; "All Layers" (null) clears it', () => {
    const t = setup([
      ['top', 1, PCB_LAYER_ID.F_Cu],
      ['bot', 2, PCB_LAYER_ID.B_Cu],
    ]);
    t.dlg.OnLayerFilterChanged(PCB_LAYER_ID.F_Cu);
    expect(t.dlg.GetModel().GetCount()).toBe(1);
    // ApplyFilter answers no selection here, so PostProcess takes its first-row branch,
    // which selects row 0 and updates the PREVIEW only (not the properties panel).
    expect(t.sel()).toBe(0);
    expect(t.dlg.GetModel().GetZone(0)!.GetZoneName()).toBe('top');
    expect(t.notebook.GetPage(0).GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    t.dlg.OnLayerFilterChanged(null);
    expect(t.dlg.GetModel().GetCount()).toBe(2);
  });

  it('turning Name off with a filter typed re-applies it', () => {
    const t = setup([
      ['abc', 1],
      ['xyz', 2],
    ]);
    t.setFilter('abc');
    t.dlg.OnFilterCtrlTextChange('abc');
    expect(t.dlg.GetModel().GetCount()).toBe(1);
    t.dlg.OnFilterFieldCheckBox('name', false);
    expect(t.dlg.GetModel().GetCount()).toBe(0);
    // an empty filter box: the boxes alone do not re-filter
    t.setFilter('');
    t.dlg.OnFilterFieldCheckBox('name', true);
    expect(t.dlg.GetModel().GetCount()).toBe(0);
  });

  it('arrow keys clamp at both ends and only re-select on a change', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
    ]);
    t.dlg.NavigateZoneSelection(-1);
    expect(t.sel()).toBe(0);
    t.dlg.NavigateZoneSelection(1);
    expect(t.sel()).toBe(1);
    t.dlg.NavigateZoneSelection(1);
    expect(t.sel()).toBe(1);
  });
});

describe('DIALOG_ZONE_MANAGER Update Displayed Zones', () => {
  it('fills the clones, not the board zones, and refreshes the preview', () => {
    const t = setup([['a', 1]]);
    t.dlg.OnUpdateDisplayedZonesClick();
    expect(t.fills).toHaveLength(1);
    expect(t.fills[0]).toEqual(t.dlg.GetBag().GetClonedZoneList());
    expect(t.fills[0]![0]).not.toBe(t.zones[0]);
    expect(t.dlg.IsZoneFillComplete()).toBe(true);
  });

  it('is not re-entrant: a click during a fill is ignored', () => {
    const t = setup([['a', 1]]);
    t.setReenter(true);
    t.dlg.OnUpdateDisplayedZonesClick();
    expect(t.fills).toHaveLength(1);
  });

  it('bumps the board timestamp before filling', () => {
    const t = setup([['a', 1]]);
    const before = t.board.GetTimeStamp();
    t.dlg.OnUpdateDisplayedZonesClick();
    expect(t.board.GetTimeStamp()).toBeGreaterThan(before);
  });

  it('an invalid field stops it before any fill', () => {
    const t = setup([['a', 1]]);
    t.panelState.valid = false;
    t.dlg.OnUpdateDisplayedZonesClick();
    expect(t.fills).toHaveLength(0);
    // and the guard is released: the next click runs
    t.panelState.valid = true;
    t.dlg.OnUpdateDisplayedZonesClick();
    expect(t.fills).toHaveLength(1);
  });

  it('a name edit repaints that zone row', () => {
    const t = setup([
      ['a', 3],
      ['b', 2],
    ]);
    t.dlg.OnZoneNameUpdate();
    expect(t.log.at(-1)).toBe('row 0');
  });
});
