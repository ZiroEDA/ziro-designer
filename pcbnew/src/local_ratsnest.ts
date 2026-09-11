// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Local Ratsnest tool's state, and the per-airwire rule it feeds.
 *
 * Upstream every `BOARD_CONNECTED_ITEM` carries `m_localRatsnestVisible`
 * (`board_connected_item.h:245`, constructed `true`). "Show ratsnest" writes
 * the global flag into EVERY item — `BOARD::SetElementVisibility(
 * LAYER_RATSNEST )` walks tracks, pads and zones (`board.cpp:1057-1073`) — and
 * the Local Ratsnest tool then flips individual pads away from it
 * (`board_inspection_tool.cpp:2329-2345`). So the per-item flag is always
 * "the global flag, except for the pads the tool has toggled", and that
 * exception set is the whole of the state kept here: {@link LocalRatsnestOverrides}
 * is the pads whose flag currently DIFFERS from the global one, keyed
 * `<footprint index>:<pad index>`.
 *
 * Keeping the *differences* rather than a set of forced-on pads is what
 * makes both halves of the tool come out: with the global ratsnest hidden a
 * click turns a part's airwires on, and with it shown the same click turns
 * them off — which is what the C++ comment in `ViewDraw` means by "easy to
 * turn on" / "easy to turn off".
 */
import type { RatsnestEdge } from './ratsnest.js';

/** Pads whose `m_localRatsnestVisible` differs from the global flag. */
export type LocalRatsnestOverrides = ReadonlySet<string>;

export const localRatsnestKey = (footprint: number, pad: number): string => `${footprint}:${pad}`;

/**
 * `GetLocalRatsnestVisible()` of one airwire end.
 *
 * A pad answers the global flag flipped by its membership; bare copper — a
 * track end, a via, a zone — has no tool that toggles it, so it holds the
 * global flag `SetElementVisibility` last wrote.
 */
function endVisible(
  globalOn: boolean,
  local: LocalRatsnestOverrides,
  fp?: number,
  pad?: number,
): boolean {
  if (fp === undefined || pad === undefined) return globalOn;
  return local.has(localRatsnestKey(fp, pad)) !== globalOn;
}

/**
 * Whether an airwire is drawn, `RATSNEST_VIEW_ITEM::ViewDraw`
 * (`ratsnest_view_item.cpp:230-245`):
 *
 *     if( cfg->m_Display.m_ShowGlobalRatsnest )
 *         show = source->Parent()->GetLocalRatsnestVisible() &&
 *                target->Parent()->GetLocalRatsnestVisible();
 *     else
 *         show = source->Parent()->GetLocalRatsnestVisible() ||
 *                target->Parent()->GetLocalRatsnestVisible();
 *
 * Per EDGE, which is the answer to "how far does a clicked part's ratsnest
 * reach": to the airwires that touch its pads and no further. The rest of
 * GND stays dark. This used to collect the clicked pads' NETS and draw every
 * airwire on them, so one LED lit the whole ground net.
 *
 * The hidden-net and visible-layers tests are not here: upstream they gate
 * every airwire alike, local or not (`:177`, `:248-257`), so the caller
 * applies them after this says yes.
 */
export function airwireShown(
  e: RatsnestEdge,
  globalOn: boolean,
  local: LocalRatsnestOverrides,
): boolean {
  const a = endVisible(globalOn, local, e.aFootprint, e.aPad);
  const b = endVisible(globalOn, local, e.bFootprint, e.bPad);
  return globalOn ? a && b : a || b;
}

/** What the picker's click landed on, after PadFilter then FootprintFilter. */
export type LocalRatsnestHit =
  | { kind: 'pad'; footprint: number; pad: number }
  | { kind: 'footprint'; footprint: number; padCount: number }
  | null;

/**
 * One click of the tool, `LocalRatsnestTool`'s click handler
 * (`board_inspection_tool.cpp:2313-2346`):
 *
 *  - a pad: `pad->SetLocalRatsnestVisible( !pad->GetLocalRatsnestVisible() )`;
 *  - a footprint: `enable = !fp->Pads()[0]->GetLocalRatsnestVisible()`, then
 *    every pad is set to `enable` — so a part with some pads on and some off
 *    follows its first pad, not a majority;
 *  - nothing: every pad back to `m_ShowGlobalRatsnest`, i.e. no differences.
 */
export function toggleLocalRatsnest(
  local: LocalRatsnestOverrides,
  globalOn: boolean,
  hit: LocalRatsnestHit,
): Set<string> {
  const next = new Set(local);
  if (hit === null) {
    next.clear();
    return next;
  }
  if (hit.kind === 'pad') {
    const key = localRatsnestKey(hit.footprint, hit.pad);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }
  if (hit.padCount === 0) return next;
  const firstVisible = endVisible(globalOn, local, hit.footprint, 0);
  const enable = !firstVisible;
  for (let pad = 0; pad < hit.padCount; pad++) {
    const key = localRatsnestKey(hit.footprint, pad);
    // A pad DIFFERS from the global flag exactly when it is to be the
    // opposite of it.
    if (enable !== globalOn) next.add(key);
    else next.delete(key);
  }
  return next;
}
