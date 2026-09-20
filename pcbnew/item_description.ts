// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_ITEM::GetItemDescription` for board items — the one-line sentence the
 * disambiguation menu, the status bar and the undo strings all read from.
 *
 * These are sentences, not labels. `Zone [GND] on B.Cu, priority 0` says which
 * of three overlapping pours you are about to pick in a way that `Zone · GND`
 * cannot: on a four-layer board the net is the part they *share*, and the layer
 * and the priority are the only things that tell them apart.
 */
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import { GetLayerName } from './layer_ids.js';
import type { Board, PcbZone } from './types.js';

/**
 * `BOARD::GetLayerName`: the user's name for a layer if they renamed it,
 * otherwise the standard English one.
 *
 * Delegates rather than reimplementing. This used to fall back to the raw
 * token, so a board that had not renamed `F.SilkS` described items as being on
 * `F.SilkS` where KiCad says `F.Silkscreen` — the fallback is
 * `GetStandardLayerName()`, i.e. `LayerName()`, not the file's spelling.
 */
export function boardLayerName(board: Board, layer: string): string {
  return GetLayerName(board.layers, layer);
}

/**
 * `BOARD_CONNECTED_ITEM::GetNetnameMsg`: the net in brackets, or the bracketed
 * placeholder upstream prints when there is no net at all.
 *
 * The name is unescaped, as upstream's is. `{slash}` is how a `/` inside a
 * label's own name survives a file whose `/` already means hierarchy — a
 * *file* encoding, never something to put in a sentence shown to the person who
 * named the net (issue #626). Note this is the FULL net name, not the short one
 * `displayNetname` gives the painters: a description names the whole path.
 */
export function netnameMsg(board: Board, netCode: number, netName?: string): string {
  const name = netName ?? board.nets.get(netCode) ?? '';
  if (name.length === 0) return '[<no net>]';
  // A negative code is a net the board names but the net list does not have —
  // what a netlist update leaves behind when a net is removed from the
  // schematic while copper still references it. Upstream says so rather than
  // showing a name that resolves to nothing.
  if (netCode < 0) return `[${unescapeString(name)}](Not Found)`;
  return `[${unescapeString(name)}]`;
}

/**
 * The layer clause of a zone's description, which counts rather than lists:
 * one, two or three layers are named, and past that it says how many more.
 * A zone on ten layers otherwise produces a menu row too wide to read.
 */
function zoneLayerDesc(board: Board, layers: readonly string[]): string {
  const n = layers.map((l) => boardLayerName(board, l));
  if (n.length === 1) return `on ${n[0]}`;
  if (n.length === 2) return `on ${n[0]} and ${n[1]}`;
  if (n.length === 3) return `on ${n[0]}, ${n[1]} and ${n[2]}`;
  if (n.length > 3) return `on ${n[0]}, ${n[1]} and ${n.length - 2} more`;
  return '';
}

/**
 * `ZONE::GetItemDescription` (zone.cpp), all four of its shapes: a rule area,
 * a teardrop, a named zone and a plain one. The priority is on the end because
 * it is what decides which pour wins where two overlap, so it is exactly what
 * you need when the menu is offering you both.
 */
export function zoneItemDescription(board: Board, z: PcbZone): string {
  const layerDesc = zoneLayerDesc(board, z.layers);
  const name = z.name ?? '';
  if (z.ruleArea || z.placementArea)
    return name === '' ? `Rule Area ${layerDesc}` : `Rule area '${name}' ${layerDesc}`;
  const net = netnameMsg(board, z.net, z.netName);
  if (z.teardropType) return `Teardrop ${net} ${layerDesc}`;
  const priority = z.priority ?? 0;
  return name === ''
    ? `Zone ${net} ${layerDesc}, priority ${priority}`
    : `Zone '${name}' ${net} ${layerDesc}, priority ${priority}`;
}
