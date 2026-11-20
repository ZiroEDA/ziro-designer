// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The anonymous usage counts beyond page views. usage.ts says what is sent and when
 * nothing is (no key, privacy.usage_stats off, Global Privacy Control); these are the
 * extra events it sends through the same door:
 *
 *  - `first_edit`: the first edit in each kind of editor after the page loads, with the
 *    seconds since load - how long a visitor takes to do something real. The frame kind
 *    only (`FRAME_PCB_EDITOR`), never what was edited;
 *  - `edits` on each `active_minute`: how many edits landed since the last one;
 *  - `load_timing`: once per page load, how long the page took and what it ran on
 *    (cores, memory class, connection type, whether WebGL 2 works);
 *  - `phone_gate`: the small-screen card was shown, and which of its two buttons
 *    (copy the link, email it) was used.
 *
 * Kept apart from usage.ts, which reads the build's key and the browser at load, so this
 * logic can be tested with a fake sender and clock.
 */

export type SendUsage = (aEvent: string, aProps: Record<string, unknown>) => void;

export class UsageEvents {
  private readonly firstEditSeen = new Set<string>();
  private edits = 0;
  private gateShown = false;

  constructor(
    private readonly send: SendUsage,
    /** Milliseconds since the page started loading (`performance.now()`). */
    private readonly sinceLoadMs: () => number,
  ) {}

  /** The listener common/usage_hooks.ts calls. */
  onCommonEvent(aEvent: string, aProps: Record<string, string | number | boolean>): void {
    if (aEvent === 'edit') this.onEdit(String(aProps.frame ?? 'unknown'));
    else if (aEvent === 'phone_gate') this.onGate(String(aProps.action ?? 'shown'));
  }

  onEdit(aFrame: string): void {
    this.edits++;
    if (this.firstEditSeen.has(aFrame)) return;
    this.firstEditSeen.add(aFrame);
    this.send('first_edit', { frame: aFrame, s_since_load: Math.round(this.sinceLoadMs() / 1000) });
  }

  /** The edits since the last call, for `active_minute`. */
  takeEdits(): number {
    const n = this.edits;
    this.edits = 0;
    return n;
  }

  /** `shown` once per page load; each use of a button every time. */
  onGate(aAction: string): void {
    if (aAction === 'shown') {
      if (this.gateShown) return;
      this.gateShown = true;
    }
    this.send('phone_gate', { action: aAction });
  }
}

/** The fields of a `PerformanceNavigationTiming` that `load_timing` reads. */
export interface NavTiming {
  responseStart: number;
  domContentLoadedEventEnd: number;
  loadEventEnd: number;
  transferSize: number;
  decodedBodySize: number;
  type: string;
}

/** What the device tells us; every field may be missing in some browsers. */
export interface DeviceInfo {
  cores?: number;
  memoryGb?: number;
  connection?: string;
  webgl2: boolean;
  dpr?: number;
}

/** `load_timing`'s properties. Times are whole milliseconds since navigation started. */
export function loadTiming(
  aNav: NavTiming | undefined,
  aDevice: DeviceInfo,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = { webgl2: aDevice.webgl2 };
  if (aNav) {
    out.ttfb_ms = Math.round(aNav.responseStart);
    out.dom_ready_ms = Math.round(aNav.domContentLoadedEventEnd);
    out.load_ms = Math.round(aNav.loadEventEnd);
    // Nothing came over the network for the page itself: the service worker or the HTTP
    // cache answered, which is what a returning visit should look like.
    out.from_cache = aNav.transferSize === 0 && aNav.decodedBodySize > 0;
    out.nav_type = aNav.type;
  }
  if (aDevice.cores !== undefined) out.cores = aDevice.cores;
  if (aDevice.memoryGb !== undefined) out.memory_gb = aDevice.memoryGb;
  if (aDevice.connection !== undefined) out.connection = aDevice.connection;
  if (aDevice.dpr !== undefined) out.dpr = aDevice.dpr;
  return out;
}
