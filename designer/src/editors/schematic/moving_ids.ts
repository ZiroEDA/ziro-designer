// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which items a move changes the look of, and the promise that the answer keeps
 * its identity for the whole gesture.
 *
 * Its own module rather than a helper inside the canvas component, because the
 * test package cannot import a `.tsx`: `tsc` runs there without `--jsx`. What
 * is worth testing here is the identity guarantee, whose failure mode is
 * silent, so it has to be somewhere a test can reach.
 */

import { refId, type MoveSpec, type Schematic, type Vec2 } from '@ziroeda/eeschema';

/**
 * Cached per move spec, which is stable for the whole gesture.
 *
 * A fresh `Set` each frame would be a new identity, which is enough on its own
 * to defeat the content comparison in `SchematicGl` and re-record the sheet on
 * every pointer move.
 */
const movingIdsCache = new WeakMap<MoveSpec, ReadonlySet<string>>();

export function movingIds(spec: MoveSpec): ReadonlySet<string> {
  const hit = movingIdsCache.get(spec);
  if (hit) return hit;
  const built = buildMovingIds(spec);
  movingIdsCache.set(spec, built);
  return built;
}

function buildMovingIds(spec: MoveSpec): ReadonlySet<string> {
  const ids = new Set<string>([...spec.fullIds, ...spec.wireStart, ...spec.wireEnd]);
  for (const ride of spec.labelRides) ids.add(ride.id);
  for (const split of spec.splits) {
    ids.add(split.lineUuid); // the wire being cut redraws as its near half
    ids.add(split.newUuid);
    ids.add(split.junctionUuid);
  }
  for (const stub of spec.newWires) if (stub.uuid) ids.add(stub.uuid);
  return ids;
}

/** The two halves of a drag, which must be exact complements. */
export interface DragSplit {
  /**
   * What the *base* is recorded without. Only ids the base actually contains:
   * the moving set plus any existing item the ghost reshaped.
   *
   * Deliberately excludes the items the move *created*, and that is what keeps
   * its contents stable from frame to frame — `orthoLineDrag` mints a fresh
   * uuid for every bend on every rebuild, so including them would change this
   * set on every pointer move and re-record the whole sheet, which is the one
   * cost the base/preview split exists to avoid. The base has never seen a
   * created item, so it has nothing to hide.
   */
  hidden: ReadonlySet<string>;
  /** What the *preview* draws: `hidden`, plus everything the move created. */
  preview: ReadonlySet<string>;
}

/**
 * The exact set of items a drag has changed the look of, taken from the result
 * rather than from the plan.
 *
 * The plan does not know everything the move will do:
 *
 *  - `orthoLineDrag` invents its 90-degree bends inside the command, with fresh
 *    uuids, every time the command is rebuilt. Those were in neither half, so a
 *    drag round a corner showed no corner until the drop.
 *  - the same function *lengthens or shortens an unselected neighbour* when one
 *    runs along the drag, instead of adding a bend. That wire is nowhere in the
 *    plan, so the base kept drawing it at its old length: it looked frozen for
 *    the whole gesture and jumped on release. On the coldfire demo, dragging
 *    U102 leaves two wires stale that way.
 *
 * Diffing the ghost against the base closes the whole family rather than the
 * symptoms that happened to be noticed, and stays correct for anything a future
 * move path invents.
 */
export function dragSplit(moving: ReadonlySet<string>, base: Schematic, doc: Schematic): DragSplit {
  const hidden = new Set(moving);
  const created = new Set<string>();
  const geom = (a: { start: Vec2; end: Vec2 }): string =>
    `${a.start.x},${a.start.y},${a.end.x},${a.end.y}`;

  const baseLines = new Map<string, string>();
  for (const l of base.lines) if (l.uuid !== undefined) baseLines.set(l.uuid, geom(l));
  doc.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    const was = l.uuid === undefined ? undefined : baseLines.get(l.uuid);
    if (was === undefined) created.add(id);
    else if (was !== geom(l)) hidden.add(id);
  });

  const baseJunctions = new Map<string, string>();
  for (const j of base.junctions)
    if (j.uuid !== undefined) baseJunctions.set(j.uuid, `${j.at.x},${j.at.y}`);
  doc.junctions.forEach((j, i) => {
    const id = refId('junction', j.uuid, i);
    const was = j.uuid === undefined ? undefined : baseJunctions.get(j.uuid);
    if (was === undefined) created.add(id);
    else if (was !== `${j.at.x},${j.at.y}`) hidden.add(id);
  });

  return { hidden, preview: new Set([...hidden, ...created]) };
}

/** Do two sets hold the same ids? Used to keep a stable identity across frames. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
