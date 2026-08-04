// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The leave-with-unsaved-work prompt.
 *
 * The gap: the drawing-sheet editor has no autosave — a sheet reaches the
 * project only when Save is pressed — so closing the tab discarded everything
 * since the last save, with nothing asked and nothing said.
 *
 * This is the *other* half of the pair. `flush_on_hide` is for an editor that
 * autosaves and wants `visibilitychange`; this is for one that cannot save
 * without permission and needs `beforeunload`, the only event that can stop a
 * navigation.
 */
import { describe, it, expect } from 'vitest';
import { installUnsavedGuard } from '@ziroeda/designer/src/ui/useUnsavedGuard.js';

function fakeWindow() {
  const listeners = new Map<string, Set<(e: BeforeUnloadEvent) => void>>();
  return {
    addEventListener(type: string, fn: (e: BeforeUnloadEvent) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: BeforeUnloadEvent) => void) {
      listeners.get(type)?.delete(fn);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    fire(type: string) {
      let prevented = false;
      const e = {
        preventDefault() {
          prevented = true;
        },
        returnValue: undefined as unknown,
      } as unknown as BeforeUnloadEvent;
      for (const fn of listeners.get(type) ?? []) fn(e);
      return { prevented, returnValue: (e as { returnValue: unknown }).returnValue };
    },
  };
}

describe('the guard', () => {
  it('listens once installed', () => {
    const w = fakeWindow();
    installUnsavedGuard(w);
    expect(w.count('beforeunload')).toBe(1);
  });

  it('cancels the navigation, both ways browsers ask for', () => {
    // preventDefault is the modern signal; returnValue is the legacy one some
    // engines still require before they will show the prompt at all.
    const w = fakeWindow();
    installUnsavedGuard(w);
    const { prevented, returnValue } = w.fire('beforeunload');
    expect(prevented).toBe(true);
    expect(returnValue).toBe('');
  });

  it('leaves nothing behind when disposed', () => {
    // The hook installs only while the work is unsaved and disposes the moment
    // it is saved, so a page with nothing to lose carries no listener — one
    // that always has a beforeunload handler can be kept out of the
    // back/forward cache.
    const w = fakeWindow();
    const dispose = installUnsavedGuard(w);
    dispose();
    expect(w.count('beforeunload')).toBe(0);
    expect(w.fire('beforeunload').prevented).toBe(false);
  });

  it('is a no-op with no target at all', () => {
    // Server-side or a test with no window: installing must not throw, and the
    // disposer must still be callable.
    expect(() => installUnsavedGuard(null)()).not.toThrow();
  });
});
