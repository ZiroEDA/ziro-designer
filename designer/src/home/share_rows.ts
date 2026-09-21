// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Which invitations the Share panel still shows as waiting.
 *
 * An invitation addressed to somebody who is on the roster already is moot:
 * they came in another way, by the link or by a second invitation, and showing
 * "Invited - not signed in yet" beside their membership row reads as two
 * people. Case does not matter in an address; the server compares invitations
 * to accounts the same way (`redeem_project_invite`: `lower(inv.email)`).
 */
export function invitationsStillWaiting<I extends { email: string }>(
  invites: readonly I[],
  roster: readonly { email: string | null }[],
): I[] {
  const members = new Set(roster.map((p) => (p.email ?? '').toLowerCase()).filter(Boolean));
  return invites.filter((i) => !members.has(i.email.toLowerCase()));
}
