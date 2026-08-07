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

import type { MoveSpec } from '@ziroeda/eeschema';

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
