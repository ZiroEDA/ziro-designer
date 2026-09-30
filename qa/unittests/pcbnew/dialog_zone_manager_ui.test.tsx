// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_ZONE_MANAGER's window (zone_manager/dialog_zone_manager_ui.tsx) on a
 * real BOARD: what it shows, what its controls drive, and what OK writes back
 * (`dialog_zone_manager.cpp` OnOk: each clone over its original). The preview
 * canvases are WebGL and are the window's to make, so a fake factory stands in
 * and records what was asked of it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DialogZoneManager,
  type ZONE_MANAGER_FRAME,
  type ZonePreviewCanvasFactory,
} from '@ziroeda/pcbnew/zone_manager/dialog_zone_manager_ui.js';

afterEach(cleanup);

function makeZone(board: BOARD, name: string, priority: number, layers: PCB_LAYER_ID[]): ZONE {
  const z = new ZONE(board);
  for (const p of [
    { x: 0, y: 0 },
    { x: 1e6, y: 0 },
    { x: 1e6, y: 1e6 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayerSet(new LSET(layers));
  z.SetZoneName(name);
  z.SetAssignedPriority(priority);
  return z;
}

function setup(specs: [string, number, PCB_LAYER_ID[]][]) {
  const board = new BOARD();
  board.Add(new NETINFO_ITEM(board, 'GND', 1));
  const zones = specs.map(([n, p, l]) => {
    const z = makeZone(board, n, p, l);
    board.Add(z);
    return z;
  });
  const asked: { layer: PCB_LAYER_ID; zone: string }[] = [];
  const destroyed: PCB_LAYER_ID[] = [];
  const createCanvas: ZonePreviewCanvasFactory = (_b, zone, layer, page) => {
    asked.push({ layer, zone: zone.GetZoneName() });
    const canvas = document.createElement('canvas');
    page.appendChild(canvas);
    return {
      GetView: () => ({ GetScale: () => 1, GetCenter: () => ({ x: 0, y: 0 }) }),
      LockZoom: () => {},
      ZoomFitScreen: () => {},
      Destroy: () => destroyed.push(layer),
    };
  };
  const fills: number[] = [];
  const frame: ZONE_MANAGER_FRAME = {
    GetBoard: () => board,
    GetColorSettings: () => new COLOR_SETTINGS(),
    FillZones: (_b, z) => {
      fills.push(z.length);
      return true;
    },
  };
  const onResult = vi.fn();
  const nets = new Map<number, string>([
    [0, '<no net>'],
    [1, 'GND'],
  ]);
  const view = render(
    <DialogZoneManager
      frame={frame}
      units="mm"
      nets={nets}
      createCanvas={createCanvas}
      onResult={onResult}
    />,
  );
  return { board, zones, asked, destroyed, fills, onResult, view };
}

const rowsText = (): string[][] =>
  Array.from(document.querySelectorAll('.ze-zm-grid tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''),
  );
const selectedRow = (): number =>
  Array.from(document.querySelectorAll('.ze-zm-grid tbody tr')).findIndex((tr) =>
    tr.classList.contains('selected'),
  );
const nameInput = (): HTMLInputElement => document.getElementById('ze-cz-name') as HTMLInputElement;
const btn = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('Zone Manager window', () => {
  it('lists the zones by priority in Name / Net / Layers columns, the first selected', async () => {
    setup([
      ['low', 1, [PCB_LAYER_ID.F_Cu]],
      ['high', 2, [PCB_LAYER_ID.B_Cu]],
    ]);
    // Wait out the mount effect that builds the session.
    await act(async () => {});
    expect(
      Array.from(document.querySelectorAll('.ze-zm-grid th')).map((t) => t.textContent),
    ).toEqual(['Name', 'Net', 'Layers']);
    // Row 0 is the higher priority: "Top zone has the highest priority".
    expect(rowsText()).toEqual([
      ['high', '', 'B.Cu'],
      ['low', '', 'F.Cu'],
    ]);
    expect(selectedRow()).toBe(0);
    // ...and its properties are in the panel.
    expect(nameInput().value).toBe('high');
  });

  it('a layer filter choice per layer the zones use, and a canvas per layer of the selected zone', async () => {
    const t = setup([['both', 1, [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]]]);
    await act(async () => {});
    expect(t.asked.map((a) => a.layer).sort()).toEqual(
      [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu].sort(),
    );
    // One tab per page, named by the layer.
    expect(
      Array.from(document.querySelectorAll('.ze-zm-nb .ze-nb-tabs button')).map(
        (b) => b.textContent,
      ),
    ).toEqual(['F.Cu', 'B.Cu']);
  });

  it('selecting another row shows that zone and rebuilds the previews, destroying the old ones', async () => {
    const t = setup([
      ['a', 2, [PCB_LAYER_ID.F_Cu]],
      ['b', 1, [PCB_LAYER_ID.B_Cu]],
    ]);
    await act(async () => {});
    expect(t.asked).toEqual([{ layer: PCB_LAYER_ID.F_Cu, zone: 'a' }]);

    fireEvent.click(document.querySelectorAll('.ze-zm-grid tbody tr')[1]!);
    expect(nameInput().value).toBe('b');
    expect(selectedRow()).toBe(1);
    expect(t.asked.at(-1)).toEqual({ layer: PCB_LAYER_ID.B_Cu, zone: 'b' });
    expect(t.destroyed).toEqual([PCB_LAYER_ID.F_Cu]);
  });

  it('editing the name updates the row at once', async () => {
    setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    fireEvent.change(nameInput(), { target: { value: 'plane' } });
    expect(rowsText()[0]![0]).toBe('plane');
  });

  it('the filter narrows the rows, its clear button restores them', async () => {
    setup([
      ['gnd_top', 2, [PCB_LAYER_ID.F_Cu]],
      ['vcc', 1, [PCB_LAYER_ID.F_Cu]],
    ]);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'vcc' } });
    expect(rowsText().map((r) => r[0])).toEqual(['vcc']);
    fireEvent.click(btn('Clear filter'));
    expect(rowsText().map((r) => r[0])).toEqual(['gnd_top', 'vcc']);
  });

  it('the Name and Net boxes are both ticked, and un-ticking Name stops matching names', async () => {
    setup([['gnd_top', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    const [name, net] = Array.from(
      document.querySelectorAll('.ze-zm-search input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect([name!.checked, net!.checked]).toEqual([true, true]);
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'gnd' } });
    expect(rowsText()).toHaveLength(1);
    fireEvent.click(name!);
    // With Name off and the net empty, nothing matches.
    expect(rowsText()).toHaveLength(0);
  });

  it('the move buttons change priority: Down on the top row, then OK, writes it to the board', async () => {
    const t = setup([
      ['top', 2, [PCB_LAYER_ID.F_Cu]],
      ['bottom', 1, [PCB_LAYER_ID.F_Cu]],
    ]);
    await act(async () => {});
    fireEvent.click(btn('down'));
    expect(rowsText().map((r) => r[0])).toEqual(['bottom', 'top']);
    expect(t.zones.map((z) => z.GetAssignedPriority())).toEqual([2, 1]);

    fireEvent.click(btn('OK'));
    expect(t.onResult).toHaveBeenCalledWith(true, false);
    // ZONE_SETTINGS_BAG ranks the zones 0..n-1 from the bottom (top = 1, bottom = 0), the
    // move swaps the pair, and UpdateClonedZones writes that over the originals: top is
    // now 0 and bottom 1.
    expect(t.zones.map((z) => z.GetAssignedPriority())).toEqual([0, 1]);
  });

  it("OK writes the edited fields back over the board's zone; Cancel writes nothing", async () => {
    const t = setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    fireEvent.change(nameInput(), { target: { value: 'renamed' } });
    fireEvent.click(btn('Cancel'));
    expect(t.onResult).toHaveBeenCalledWith(false, false);
    expect(t.zones[0]!.GetZoneName()).toBe('a');
    cleanup();

    const u = setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    fireEvent.change(nameInput(), { target: { value: 'renamed' } });
    fireEvent.click(btn('OK'));
    expect(u.zones[0]!.GetZoneName()).toBe('renamed');
  });

  it('OK reports the Refill zones box (ZONE_MANAGER_REPOUR)', async () => {
    const t = setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    fireEvent.click(screen.getByLabelText('Refill zones'));
    fireEvent.click(btn('OK'));
    expect(t.onResult).toHaveBeenCalledWith(true, true);
  });

  it("Update Displayed Zones fills the clones, not the board's zones", async () => {
    const t = setup([
      ['a', 2, [PCB_LAYER_ID.F_Cu]],
      ['b', 1, [PCB_LAYER_ID.F_Cu]],
    ]);
    await act(async () => {});
    fireEvent.click(btn('Update Displayed Zones'));
    expect(t.fills).toEqual([2]);
  });

  it('Up / Down arrows move the selection, whichever control has the focus', async () => {
    setup([
      ['a', 2, [PCB_LAYER_ID.F_Cu]],
      ['b', 1, [PCB_LAYER_ID.F_Cu]],
    ]);
    await act(async () => {});
    fireEvent.keyDown(screen.getByLabelText('Filter'), { key: 'ArrowDown' });
    expect(selectedRow()).toBe(1);
    expect(nameInput().value).toBe('b');
    fireEvent.keyDown(screen.getByLabelText('Filter'), { key: 'ArrowUp' });
    expect(selectedRow()).toBe(0);
  });

  it('with one zone the move and auto-assign buttons are disabled', async () => {
    setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    for (const name of ['down', 'Auto-assign'])
      expect((btn(name) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the previews are destroyed when the dialog goes', async () => {
    const t = setup([['a', 1, [PCB_LAYER_ID.F_Cu]]]);
    await act(async () => {});
    t.view.unmount();
    expect(t.destroyed).toEqual([PCB_LAYER_ID.F_Cu]);
  });
});
