// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Which schematic sheets may cross between tabs of one project (project_sync_transport.ts).
 *
 * Every tab of a project mounts a schematic frame, shown or not, and a frame that has not opened
 * the project holds the editor's blank placeholder sheet. Its publish effect sent that placeholder
 * as "sheet / changed"; a tab with the project open applied it to its ROOT sheet as a remote
 * update, and that tab's autosave wrote it over the root - in the store and to the account. A
 * second tab on the same project was enough (reproduced 11-19; signed in, over Supabase Realtime,
 * the same messages reach other devices).
 *
 * So a sheet is published only by a frame that has the project open, and carries the file it is
 * a sheet OF (the hierarchy's root); a frame applies a remote sheet only when it has a project
 * open itself and the root matches. A message without a root - an older tab still running a
 * build from before this - is not applied: losing a live edit is recoverable, losing a sheet is not.
 */

/** Whether a frame whose open file is \a aCurrentFile may publish its sheet. */
export function mayPublishSheet(aCurrentFile: string, aPlaceholder: string): boolean {
  return aCurrentFile !== '' && aCurrentFile !== aPlaceholder;
}

/** Whether a remote sheet for root \a aSenderRoot may be applied in a frame on root \a aMyRoot. */
export function mayApplyRemoteSheet(
  aSenderRoot: string | undefined,
  aMyRoot: string,
  aMyCurrentFile: string,
  aPlaceholder: string,
): boolean {
  if (!aSenderRoot || aSenderRoot === aPlaceholder) return false;
  if (!mayPublishSheet(aMyCurrentFile, aPlaceholder) || aMyRoot === aPlaceholder) return false;
  return aSenderRoot === aMyRoot;
}
