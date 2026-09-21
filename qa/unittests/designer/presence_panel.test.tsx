// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PresencePanel.tsx, rendered rather than read as source text — a row that
 * is actually colored and one that just imports `peerColor` and never
 * calls it read the same to a grep.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PresencePanel } from '@ziroeda/designer/src/ui/PresencePanel.js';
import { peerColor } from '@ziroeda/designer/src/sync/peerColor.js';
import type { PresenceInfo } from '@ziroeda/designer/src/sync/ProjectSyncTransport.js';

afterEach(cleanup);

const peer = (over: Partial<PresenceInfo>): PresenceInfo => ({
  peerId: 'peer-a',
  view: 'pcb',
  sheetPath: null,
  role: 'editor',
  displayName: null,
  ...over,
});

describe('PresencePanel colors every row from peerColor, not one shared color', () => {
  it("gives self and each peer their own row's dot the color peerColor(peerId) computes for it", () => {
    render(
      <PresencePanel
        me={{ peerId: 'peer-me', role: 'owner', displayName: null }}
        peers={[peer({ peerId: 'peer-a' }), peer({ peerId: 'peer-b' })]}
        onSetRole={() => {}}
        onClose={() => {}}
      />,
    );
    const rows = screen.getByTestId('presence-panel').querySelectorAll('.ze-presence-row');
    expect(rows).toHaveLength(3);
    const dotColor = (row: Element): string | null =>
      (row.querySelector('.ze-presence-dot') as HTMLElement | null)?.style.background ?? null;

    expect(dotColor(rows[0]!)).toBe(peerColor('peer-me'));
    expect(dotColor(rows[1]!)).toBe(peerColor('peer-a'));
    expect(dotColor(rows[2]!)).toBe(peerColor('peer-b'));
  });

  it('two different peerIds that happen to need different colors get visibly different dots', () => {
    // Picked for a real, asserted-in-advance difference rather than hoping
    // two arbitrary ids collide or not: peerColor is deterministic, so this
    // pair's colors are known before the render, not read back from it.
    const a = 'peer-0';
    const b = 'peer-7';
    expect(peerColor(a)).not.toBe(peerColor(b)); // the pair this test relies on
    render(
      <PresencePanel
        me={{ peerId: 'peer-me', role: 'editor', displayName: null }}
        peers={[peer({ peerId: a }), peer({ peerId: b })]}
        onSetRole={() => {}}
        onClose={() => {}}
      />,
    );
    const rows = screen.getByTestId('presence-panel').querySelectorAll('.ze-presence-row');
    const dotColor = (row: Element): string | null =>
      (row.querySelector('.ze-presence-dot') as HTMLElement | null)?.style.background ?? null;
    expect(dotColor(rows[1]!)).not.toBe(dotColor(rows[2]!));
  });
});
