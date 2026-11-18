// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A failed cloud push is tried again by itself (uartbridge, U-12): it used to wait for the next
 * edit, so a blip with no edit after it left the work on this device alone under the red banner.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloudRetryDelay } from '@ziroeda/designer/src/cloud/push_retry.js';

describe('cloudRetryDelay', () => {
  it('waits 15 s, then doubles, and never more than five minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(cloudRetryDelay)).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
    expect(cloudRetryDelay(0)).toBe(0);
  });
});

describe("App's push", () => {
  const APP = readFileSync(join(__dirname, '../../../designer/src/App.tsx'), 'utf8');
  const start = APP.indexOf('const pushNow = useCallback(');
  const push = APP.slice(start, APP.indexOf('const scheduleCloudPush', start));

  it('schedules a retry on failure, with the backoff, unless a newer push is already owed', () => {
    expect(start).toBeGreaterThan(0);
    const failed = push.slice(push.indexOf('reportCloudFailed()'));
    expect(failed).toMatch(/cloudFailures\.current \+= 1;/);
    expect(failed).toMatch(/if \(cloudTarget\.current === null\) \{\s*cloudTarget\.current = id;/);
    expect(failed).toMatch(/setTimeout\(pushNow, cloudRetryDelay\(cloudFailures\.current\)\)/);
  });

  it('resets the backoff on success, and pushes at once when the browser is back online', () => {
    expect(push).toMatch(/cloudFailures\.current = 0;\s*reportCloudOk\(\);/);
    expect(push).toMatch(/addEventListener\('online', onOnline\)/);
  });
});
