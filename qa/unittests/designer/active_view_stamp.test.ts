// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `stampActiveView`: the visible frame, on the body, for the frames' key handlers - and nothing,
 * rather than a throw, when the page has no `<body>` at that moment (Sentry 1Z).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stampActiveView } from '@ziroeda/designer/src/nav/active_view.js';

let removed: HTMLElement | null = null;
afterEach(() => {
  if (removed) document.documentElement.appendChild(removed);
  removed = null;
});

describe('stampActiveView', () => {
  it('names the visible frame on the body', () => {
    stampActiveView('pcb');
    expect(document.body.dataset.activeView).toBe('pcb');
  });

  it('does nothing when the page has no body, instead of throwing out of the effect', () => {
    removed = document.body;
    removed.remove();
    expect(document.body).toBeNull();
    expect(() => stampActiveView('home')).not.toThrow();
  });
});
