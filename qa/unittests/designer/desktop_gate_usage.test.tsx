// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The small-screen card (designer/src/mobile/DesktopGate.tsx) tells the anonymous usage
 * counts that it was shown, and which way out its visitor took: copy the link, or email
 * it. A desktop sees the app and reports nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesktopGate } from '@ziroeda/designer/src/mobile/DesktopGate.js';
import { SetUsageListener, type UsageProps } from '@ziroeda/common/usage_hooks.js';

let got: [string, UsageProps][] = [];
let phone = true;

beforeEach(() => {
  got = [];
  SetUsageListener((e, p) => got.push([e, p]));
  window.matchMedia = ((q: string) => ({
    matches: phone
      ? /max-width|pointer: coarse/.test(q) && !q.includes('any-pointer: fine')
      : q.includes('any-pointer: fine'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  SetUsageListener(null);
  phone = true;
});

describe('the phone card and the usage counts', () => {
  it('reports the card once, then each button used', () => {
    render(
      <DesktopGate>
        <p>app</p>
      </DesktopGate>,
    );
    expect(screen.queryByText('app')).toBeNull();
    expect(got).toEqual([['phone_gate', { action: 'shown' }]]);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const email = screen.getByRole('link', { name: 'Email me the link' });
    email.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(email);
    expect(got.map(([, p]) => p.action)).toEqual(['shown', 'copy', 'email']);
  });

  it('a desktop gets the app, and nothing is reported', () => {
    phone = false;
    render(
      <DesktopGate>
        <p>app</p>
      </DesktopGate>,
    );
    expect(screen.getByText('app')).toBeTruthy();
    expect(got).toEqual([]);
  });
});
