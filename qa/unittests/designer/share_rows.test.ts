// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { describe, expect, it } from 'vitest';
import { invitationsStillWaiting } from '@ziroeda/designer/src/home/share_rows.js';

describe('invitationsStillWaiting', () => {
  const a = { token: 't1', email: 'A@X.test', role: 'editor' };
  const b = { token: 't2', email: 'b@x.test', role: 'viewer' };

  it('drops an invitation for somebody who is already on the roster, whatever the case', () => {
    // The bug: 24f joined by the public link, and the invitation addressed to
    // the same address kept showing "Invited - not signed in yet" beneath
    // their membership row.
    const roster = [{ email: 'a@x.test' }];
    expect(invitationsStillWaiting([a, b], roster)).toEqual([b]);
  });

  it('keeps every invitation nobody on the roster answers to', () => {
    expect(invitationsStillWaiting([a, b], [{ email: 'c@x.test' }, { email: null }])).toEqual([
      a,
      b,
    ]);
  });
});
