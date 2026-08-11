// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the app tells the user about where their work is.
 *
 * The wording is the feature. The app used to read "Saved in browser · cloud
 * sync on" while an editing session had reached neither the account nor,
 * if storage was refusing writes, anywhere at all. So each state is pinned to
 * the claim it makes: nothing may say "saved" about a copy that does not exist,
 * and nothing may stay quiet about a write that is failing.
 */
import { describe, it, expect } from 'vitest';
import {
  describeSaveState,
  emptySnapshot,
  STALE_AFTER_MS,
  type SaveSnapshot,
} from '@ziroeda/designer/src/home/save_state.js';

const NOW = 1_700_000_000_000;
const snap = (over: Partial<SaveSnapshot> = {}): SaveSnapshot => ({
  ...emptySnapshot,
  signedIn: true,
  ...over,
});

describe('what the save state says', () => {
  it('is silent once everything has landed', () => {
    expect(describeSaveState(snap({ cloudOkAt: NOW - 1000 }), NOW).kind).toBe('saved');
  });

  it('does not claim an account copy when signed out', () => {
    // The old status bar said "cloud sync on" regardless. Signed out is a
    // complete state, it is just a different one.
    const d = describeSaveState(snap({ signedIn: false }), NOW);
    expect(d.kind).toBe('local-only');
    expect(d.text).toBe('Saved on this device');
  });

  it('says nothing about the cloud while signed out, even mid-write', () => {
    const d = describeSaveState(snap({ signedIn: false, cloudPending: true }), NOW);
    expect(d.kind).toBe('local-only');
  });

  it('shows a write in progress', () => {
    expect(describeSaveState(snap({ localPending: true }), NOW).kind).toBe('saving');
    expect(describeSaveState(snap({ cloudPending: true }), NOW).kind).toBe('saving');
  });

  it('reports a short run of cloud failures as reconnecting, and says where the work is', () => {
    const d = describeSaveState(snap({ cloudFailingSince: NOW - 5_000 }), NOW);
    expect(d.kind).toBe('retrying');
    expect(d.text).toContain('saved on this device');
    // Not yet worth a download button: this resolves itself most of the time.
    expect(d.offerDownload).toBe(false);
  });

  it('escalates with a timestamp once the run passes a minute', () => {
    const okAt = NOW - 10 * 60_000;
    const d = describeSaveState(
      snap({ cloudFailingSince: NOW - STALE_AFTER_MS, cloudOkAt: okAt }),
      NOW,
    );
    expect(d.kind).toBe('stale');
    // The time of the last save that landed, which is the fact the user needs.
    expect(d.text).toMatch(/Not saved to the cloud since \d{1,2}[:.]\d{2}/);
    expect(d.offerDownload).toBe(true);
  });

  it('escalates without a timestamp when nothing has ever landed', () => {
    const d = describeSaveState(snap({ cloudFailingSince: NOW - STALE_AFTER_MS }), NOW);
    expect(d.kind).toBe('stale');
    expect(d.text).not.toContain('since');
    expect(d.offerDownload).toBe(true);
  });

  it('puts a local storage failure ahead of everything else', () => {
    // Local storage is where the work lives. A cloud spinner over the top of a
    // browser that is refusing to store anything would be the wrong sentence.
    const d = describeSaveState(
      snap({ localFailed: true, cloudPending: true, localPending: true }),
      NOW,
    );
    expect(d.kind).toBe('failed');
    expect(d.offerDownload).toBe(true);
  });

  it('never reports saving while a failure is outstanding', () => {
    // The ordering that matters: a retry in flight sets cloudPending, and
    // showing "Saving…" then would hide the failure behind a spinner.
    const d = describeSaveState(snap({ cloudPending: true, cloudFailingSince: NOW - 2_000 }), NOW);
    expect(d.kind).toBe('retrying');
  });

  it('recovers to silence when the cloud accepts a write again', () => {
    const failing = snap({ cloudFailingSince: NOW - 90_000, cloudOkAt: NOW - 120_000 });
    expect(describeSaveState(failing, NOW).kind).toBe('stale');
    // reportCloudOk clears the run and stamps the time.
    const recovered = { ...failing, cloudFailingSince: 0, cloudOkAt: NOW };
    expect(describeSaveState(recovered, NOW).kind).toBe('saved');
  });
});
