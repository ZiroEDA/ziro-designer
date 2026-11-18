// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The account's projects that are not on this device yet - listed at once, fetched when opened.
 *
 * Reported: opening the app on a new device (or after the browser cleared its storage) showed no
 * projects for minutes, because the list was the device's store and every project had to download
 * whole before it appeared in it; EasyEDA lists every project the moment it opens and downloads
 * one when you open it. The rows already carry what a list needs - a name, sealed or not, and when
 * it last changed - so the list is read from them (cloudCatalog) and a project is pulled on open
 * (sync.pullProjectNow), while the background sync goes on filling the device as before.
 */
import { cloudCatalog, cloudMemberships } from './cloudStore.js';
import { listSyncMeta } from '../home/projectStore.js';

export type CloudRole = 'owner' | 'editor' | 'viewer';

/** A project of the account that this device does not hold. */
export interface CloudOnlyProject {
  /** The key it will be filed under here, as the sync files it (pullOne's `localId`). */
  localId: string;
  /** The row's own id. */
  remoteId: string;
  uid?: string;
  ownerId?: string;
  role: CloudRole;
  name: string;
  updatedAt: number | null;
}

/**
 * The rows no local project stands for, matched exactly as syncAllProjects matches them: by
 * `uid` when a local copy knows it, else - for the user's own rows - by id. Filed the same way
 * too: an own project under its row id, one shared with the user under its `uid`.
 */
export function cloudOnlyFrom(
  aUserId: string,
  aRows: readonly {
    id: string;
    uid?: string;
    ownerId?: string;
    name: string;
    updatedAt: number | null;
  }[],
  aRoles: ReadonlyMap<string, CloudRole>,
  aLocal: readonly { id: string; cloudUid?: string }[],
): CloudOnlyProject[] {
  const localUids = new Set(aLocal.map((l) => l.cloudUid).filter((u): u is string => !!u));
  const localIds = new Set(aLocal.map((l) => l.id));
  const out: CloudOnlyProject[] = [];

  for (const r of aRows) {
    const mine = !r.ownerId || r.ownerId === aUserId;
    if (r.uid && localUids.has(r.uid)) continue;
    if (mine && localIds.has(r.id)) continue;

    const role: CloudRole = mine ? 'owner' : ((r.uid ? aRoles.get(r.uid) : undefined) ?? 'viewer');
    const localId = role === 'owner' ? r.id : (r.uid ?? r.id);
    // A shared copy filed under its uid that is already here (sync's other index).
    if (localIds.has(localId)) continue;

    out.push({
      localId,
      remoteId: r.id,
      ...(r.uid ? { uid: r.uid } : {}),
      ...(r.ownerId ? { ownerId: r.ownerId } : {}),
      role,
      name: r.name,
      updatedAt: r.updatedAt,
    });
  }

  return out;
}

/** {@link cloudOnlyFrom} over the account's rows and this device's store. */
export async function cloudOnlyProjects(aUserId: string): Promise<CloudOnlyProject[]> {
  const [rows, roles, local] = await Promise.all([
    cloudCatalog(),
    cloudMemberships(),
    listSyncMeta(),
  ]);
  return cloudOnlyFrom(aUserId, rows, roles, local);
}
