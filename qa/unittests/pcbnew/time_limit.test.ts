// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::TIME_LIMIT`. The one thing worth pinning is {@link TimeLimit.expired}'s
 * boundary: `>=`, not `>` — a limit of exactly the elapsed time has expired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeLimit } from '@ziroeda/pcbnew/router/time_limit.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TimeLimit', () => {
  it('a zero limit is expired immediately', () => {
    const t = new TimeLimit(0);
    expect(t.expired()).toBe(true);
  });

  it('is not expired before the limit elapses', () => {
    const t = new TimeLimit(1000);
    vi.advanceTimersByTime(999);
    expect(t.expired()).toBe(false);
  });

  it('`Expired` is >=, not >: exactly the limit counts as expired', () => {
    const t = new TimeLimit(1000);
    vi.advanceTimersByTime(1000);
    expect(t.expired()).toBe(true);
  });

  it('is expired well past the limit too', () => {
    const t = new TimeLimit(1000);
    vi.advanceTimersByTime(5000);
    expect(t.expired()).toBe(true);
  });

  it('`Restart` resets the clock, keeping the limit', () => {
    const t = new TimeLimit(1000);
    vi.advanceTimersByTime(1000);
    expect(t.expired()).toBe(true);

    t.restart();
    expect(t.expired()).toBe(false);

    vi.advanceTimersByTime(999);
    expect(t.expired()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.expired()).toBe(true);
  });

  it('`Set` changes the limit without restarting the clock', () => {
    const t = new TimeLimit(1000);
    vi.advanceTimersByTime(500);

    t.set(400);
    // 500ms have already elapsed against a 400ms limit: expired at once,
    // with no call to Restart.
    expect(t.expired()).toBe(true);
    expect(t.get()).toBe(400);
  });

  it('the constructor calls Restart, so the clock starts at construction time', () => {
    vi.setSystemTime(10_000);
    const t = new TimeLimit(1000);

    vi.setSystemTime(10_500);
    expect(t.expired()).toBe(false);

    vi.setSystemTime(11_000);
    expect(t.expired()).toBe(true);
  });

  it('defaults to a zero-millisecond limit', () => {
    const t = new TimeLimit();
    expect(t.get()).toBe(0);
    expect(t.expired()).toBe(true);
  });
});
