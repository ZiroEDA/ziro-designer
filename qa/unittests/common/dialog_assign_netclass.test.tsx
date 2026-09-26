// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** DIALOG_ASSIGN_NETCLASS (common/dialogs/dialog_assign_netclass.cpp). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DialogAssignNetclass,
  GetNetclassPatternForSet,
  matchingNets,
  UpgradeGlobStarToRegex,
} from '@ziroeda/common/dialogs/dialog_assign_netclass.js';
import { connectedItemIdsOnNets } from '@ziroeda/pcbnew/edit-board.js';

afterEach(cleanup);

describe('GetNetclassPatternForSet', () => {
  it('one net is itself', () => {
    expect(GetNetclassPatternForSet(new Set(['/USB_D+']))).toBe('/USB_D+');
  });

  it('several share their common prefix as prefix(a|b), natural-sorted', () => {
    expect(GetNetclassPatternForSet(new Set(['/SDA10', '/SDA2', '/SCL']))).toBe('/S(CL|DA2|DA10)');
  });

  it('a bare "/" prefix is not factored out', () => {
    expect(GetNetclassPatternForSet(new Set(['/A', '/B']))).toBe('/A|/B');
  });

  it('a glob star not after a dot becomes a regex star', () => {
    expect(UpgradeGlobStarToRegex('D*')).toBe('D.*');
    expect(UpgradeGlobStarToRegex('D.*')).toBe('D.*');
  });
});

describe('the matching report', () => {
  it('lists the candidates the pattern matches, anchored at both ends', () => {
    expect(matchingNets('GND', ['GND', 'AGND', 'GND2'])).toEqual(['GND']);
    expect(matchingNets('', ['GND'])).toEqual([]);
  });
});

describe('DialogAssignNetclass', () => {
  const dlg = (onOk = vi.fn(), frame: 'pcb' | 'schematic' = 'pcb') =>
    render(
      <DialogAssignNetclass
        frame={frame}
        netNames={new Set(['GND'])}
        candidateNetNames={['GND', 'VCC']}
        netClasses={['Power', 'Signal']}
        onOk={onOk}
        onCancel={() => {}}
      />,
    );

  it('proposes the pattern, picks the first non-Default class, and reports the matches', () => {
    const onOk = vi.fn();
    dlg(onOk);
    expect((screen.getByLabelText('Pattern') as HTMLInputElement).value).toBe('GND');
    expect(document.body.innerHTML).toContain('Currently matching nets:');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).toHaveBeenCalledWith('GND', 'Power');
  });

  it('names the frame’s own Setup dialog in the note', () => {
    dlg(vi.fn(), 'pcb');
    expect(screen.getByText(/Board Setup > Project\./)).toBeTruthy();
    cleanup();
    dlg(vi.fn(), 'schematic');
    expect(screen.getByText(/Schematic Setup > Project\./)).toBeTruthy();
  });

  it('an empty pattern assigns nothing', () => {
    const onOk = vi.fn();
    dlg(onOk);
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).not.toHaveBeenCalled();
  });
});

describe('the board editor runs BOARD_EDITOR_CONTROL::AssignNetclass', () => {
  it('SelectAllItemsOnNet walks every connected item', () => {
    const board = {
      tracks: [{ net: 1 }, { net: 2 }],
      arcs: [{ net: 1 }],
      vias: [{ net: 2 }],
      footprints: [{ pads: [{ net: 1 }, {}] }],
      zones: [{ net: 1 }],
    } as unknown as Parameters<typeof connectedItemIdsOnNets>[0];
    expect(connectedItemIdsOnNets(board, new Set([1]))).toEqual([
      'track:0',
      'arc:0',
      'pad:0:0',
      'zone:0',
    ]);
  });

  it('is wired, with upstream’s refusal', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
      'utf8',
    );
    expect(src).toContain("{ label: 'Assign Netclass...', action: () => assignNetclass() }");
    expect(src).toContain("setInfoBarError('Selection contains no items with labeled nets.')");
    expect(src).toContain('<DialogAssignNetclass');
  });
});
