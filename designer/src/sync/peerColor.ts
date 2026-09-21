// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A stable color per connected peer, so two or more remote cursors,
 * selection boxes and presence-panel rows read as distinct people rather
 * than the same indistinguishable orange repeated. No upstream KiCad
 * counterpart to cite a COLOR4D from — KiCad has no notion of another
 * viewer on the same document, the same reason `REMOTE_CURSOR_COLOR`
 * itself (the single color every peer used before this) was already a
 * bare literal. Chosen for visibility against both the PCB and schematic
 * canvas backgrounds, not carried over from an unrelated KiCad table (the
 * built-in copper/gerbview layer-cycling palettes exist for layer colors,
 * a different job, and reusing them here would be borrowing data for a
 * purpose it was never chosen for).
 */

/** [0] is the exact color every remote peer used before this existed —
 *  which peerId lands on which entry is a hash, not a promise, but the
 *  common one-other-peer case has a real chance of looking unchanged
 *  rather than the palette dropping that color outright. The rest are
 *  spaced around the wheel from it for separation at a glance. */
const PEER_COLOR_PALETTE = [
  '#e95420', // orange — was REMOTE_CURSOR_COLOR
  '#5bc3eb', // sky blue
  '#f76f8e', // pink
  '#2accd9', // teal
  '#9b8afb', // violet
  '#8fd14f', // green
  '#f2c94c', // yellow
  '#c2986f', // tan
] as const;

/**
 * FNV-1a: cheap, deterministic, and stable across platforms — this only
 * needs to land the same peerId on the same palette entry every time, not
 * to resist collisions the way a real hash would need to.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The color this peer's cursor, selection box and presence-row dot should
 * all use — call sites never pick their own, so the three never disagree
 * about which peer is which.
 */
export function peerColor(peerId: string): string {
  return PEER_COLOR_PALETTE[hashString(peerId) % PEER_COLOR_PALETTE.length]!;
}
