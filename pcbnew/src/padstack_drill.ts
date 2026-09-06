// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A PADSTACK's secondary drills — backdrills — and its post-machining.
 * Counterpart: `pcbnew/padstack.{h,cpp}` (DRILL_PROPS, POST_MACHINING_PROPS,
 * :513-611) and the four tokens `pcb_io_kicad_sexpr.cpp` writes for a pad
 * (:1744-1784) and a via (:2657-2694).
 *
 *     (backdrill (size s) (layers "start" "end"))       the secondary drill
 *     (tertiary_drill (size s) (layers "start" "end"))  the third slot
 *     (front_post_machining counterbore (size s) (depth d) (angle a))
 *     (back_post_machining countersink …)
 *
 * A backdrill has no side of its own in the file: the SIDE is which copper
 * layer it starts on, F.Cu for the top and B.Cu for the bottom
 * (`findBackdrillDrill`, padstack.cpp:523-536). That is why KiCad 10.0 layouts,
 * which put the top backdrill in the tertiary slot, still read correctly — the
 * slot number means nothing and the start layer means everything.
 */

import { atom, list, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';

/** `PADSTACK::DRILL_PROPS`, as a `.kicad_pcb` carries one. */
export interface PcbDrillSlot {
  /** `(size …)`, IU; a backdrill is round, so x and y are the same number. */
  size: number;
  /** The copper layer it is drilled FROM: F.Cu is the top side, B.Cu the bottom. */
  start: string;
  /** `must-cut`: the deepest layer the backdrill has to reach. */
  end: string;
}

/** `PAD_DRILL_POST_MACHINING_MODE` plus its three optional measurements. */
export interface PcbPostMachining {
  mode: 'counterbore' | 'countersink';
  /** `(size …)`, IU. */
  size?: number;
  /** `(depth …)`, IU — a counterbore's. */
  depth?: number;
  /** `(angle …)` in TENTHS of a degree, as PROPERTY_DISPLAY::PT_DECIDEGREE and
   *  the parser's `KiROUND( parseDouble( … ) * 10.0 )` both store it. */
  angle?: number;
}

/** An item that can carry the two backdrill slots. */
export interface WithBackdrills {
  backdrill?: PcbDrillSlot;
  tertiaryDrill?: PcbDrillSlot;
}

/** `BACKDRILL_MODE` (padstack.h:83-89). */
export type BackdrillMode = 'none' | 'bottom' | 'top' | 'both';

/** `findBackdrillDrill( aTop )`: the slot drilled from that side, or undefined. */
export function backdrillSlot(item: WithBackdrills, top: boolean): PcbDrillSlot | undefined {
  const want = top ? 'F.Cu' : 'B.Cu';
  return [item.backdrill, item.tertiaryDrill].find((d) => d && d.start === want && d.size > 0);
}

/** `PADSTACK::GetBackdrillMode()`. */
export function backdrillMode(item: WithBackdrills): BackdrillMode {
  const top = !!backdrillSlot(item, true);
  const bottom = !!backdrillSlot(item, false);
  if (top && bottom) return 'both';
  if (top) return 'top';
  return bottom ? 'bottom' : 'none';
}

/**
 * `backdrillWriteSlot( aTop )` / `clearBackdrillSide( aTop )`: write one side,
 * or clear it. The side already in a slot keeps that slot; a new one takes the
 * first free slot, secondary before tertiary.
 */
export function setBackdrillSlot(
  item: WithBackdrills,
  top: boolean,
  slot: PcbDrillSlot | undefined,
): WithBackdrills {
  const want = top ? 'F.Cu' : 'B.Cu';
  const isSide = (d: PcbDrillSlot | undefined): boolean => !!d && d.start === want && d.size > 0;
  const next: WithBackdrills = { backdrill: item.backdrill, tertiaryDrill: item.tertiaryDrill };

  if (isSide(next.backdrill)) next.backdrill = slot;
  else if (isSide(next.tertiaryDrill)) next.tertiaryDrill = slot;
  else if (slot) {
    if (!next.backdrill) next.backdrill = slot;
    else next.tertiaryDrill = slot;
  }

  return next;
}

/**
 * `PADSTACK::SetBackdrillMode`: turning a side ON gives it a drill 10% wider
 * than the main hole when it has no size yet (padstack.cpp:539-560); turning it
 * off clears the side outright.
 */
export function applyBackdrillMode(
  item: WithBackdrills,
  mode: BackdrillMode,
  mainDrill: number,
  defaultEnd: (top: boolean) => string,
): WithBackdrills {
  let next: WithBackdrills = { ...item };

  for (const top of [true, false]) {
    const want = mode === 'both' || mode === (top ? 'top' : 'bottom');
    if (!want) {
      next = setBackdrillSlot(next, top, undefined);
      continue;
    }
    const have = backdrillSlot(next, top);
    next = setBackdrillSlot(next, top, {
      size: have?.size && have.size > 0 ? have.size : Math.round(mainDrill * 1.1),
      start: top ? 'F.Cu' : 'B.Cu',
      end: have?.end ?? defaultEnd(top),
    });
  }

  return next;
}

/** `(backdrill …)` / `(tertiary_drill …)`, or undefined when the node is absent. */
export function readDrillSlot(
  parent: SList,
  token: 'backdrill' | 'tertiary_drill',
  mm: (n: number) => number,
): PcbDrillSlot | undefined {
  const node = childNamed(parent, token);
  if (!node) return undefined;
  const size = childNamed(node, 'size');
  const layers = childNamed(node, 'layers');
  // `items[0]` is the token itself, so the arguments start at 1.
  // `items[0]` is the token itself, so the arguments start at 1 — and a layer
  // name is a quoted STRING while a size is a bare atom, so both node kinds
  // count as an argument here.
  const arg = (n: SNode): string[] => (n.kind === 'list' ? [] : [n.value]);
  const nums = (size?.items.slice(1) ?? []).flatMap(arg).map(Number);
  const names = (layers?.items.slice(1) ?? []).flatMap(arg);
  return {
    size: mm(nums[0] ?? 0),
    start: names[0] ?? '',
    end: names[1] ?? '',
  };
}

/** The node a drill slot writes, in the writer's own shape. */
export const drillSlotNode = (
  token: 'backdrill' | 'tertiary_drill',
  d: PcbDrillSlot,
  mm: (n: number) => string,
): SList => ({
  kind: 'list',
  items: [
    atom(token),
    list(atom('size'), atom(mm(d.size))),
    { kind: 'list', items: [atom('layers'), str(d.start), str(d.end)] },
  ],
});

/** `(front_post_machining counterbore (size …) (depth …) (angle …))`. */
export function readPostMachining(
  parent: SList,
  token: 'front_post_machining' | 'back_post_machining',
  mm: (n: number) => number,
): PcbPostMachining | undefined {
  const node = childNamed(parent, token);
  if (!node) return undefined;
  // The MODE is a bare word right after the token, not a child.
  const word = node.items.find(
    (i, idx) =>
      idx > 0 && i.kind !== 'list' && (i.value === 'counterbore' || i.value === 'countersink'),
  );
  if (!word || word.kind === 'list') return undefined;

  const num = (name: string): number | undefined => {
    const c = childNamed(node, name);
    const a = c?.items[1];
    return a && a.kind !== 'list' ? Number(a.value) : undefined;
  };
  const sizeRaw = num('size');
  const depthRaw = num('depth');
  const angleRaw = num('angle');

  return {
    mode: word.value as PcbPostMachining['mode'],
    ...(sizeRaw !== undefined ? { size: mm(sizeRaw) } : {}),
    ...(depthRaw !== undefined ? { depth: mm(depthRaw) } : {}),
    // `KiROUND( parseDouble( … ) * 10.0 )` — the model holds tenths of a degree.
    ...(angleRaw !== undefined ? { angle: Math.round(angleRaw * 10) } : {}),
  };
}

/**
 * The node post-machining writes. `formatPostMachining` emits nothing at all
 * for a mode that is absent or NOT_POST_MACHINED, and skips each measurement
 * that is not positive.
 */
export function postMachiningNode(
  token: 'front_post_machining' | 'back_post_machining',
  p: PcbPostMachining,
  mm: (n: number) => string,
  num: (n: number) => string,
): SList {
  const items: SNode[] = [atom(token), atom(p.mode)];
  if ((p.size ?? 0) > 0) items.push(list(atom('size'), atom(mm(p.size as number))));
  if ((p.depth ?? 0) > 0) items.push(list(atom('depth'), atom(mm(p.depth as number))));
  // Written back in DEGREES: `FormatDouble2Str( aProps.angle / 10.0 )`.
  if ((p.angle ?? 0) > 0) items.push(list(atom('angle'), atom(num((p.angle as number) / 10))));
  return { kind: 'list', items };
}
