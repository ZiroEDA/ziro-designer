// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The colour behind a person's initial, which is ente's.
 *
 * `web/apps/photos/src/services/avatar.ts` carries this palette
 * (`avatarBackgroundColors`, kept in sync with their mobile apps) and
 * `Avatar.tsx` picks from it with `colorSeedFromEmail`: the sum of the
 * address's code points, modulo the palette. The text is white and bold at
 * half the avatar's size. Data, not chrome: KiCad has no account and so no
 * theme colour for one, and this table is the reference's, not ours.
 *
 * One deliberate deviation: ente paints the signed-in user's OWN marker
 * black, because in a photo gallery that marker means "your file" and is
 * meant to be neutral. Here the avatar is the account button in the corner,
 * and it takes its colour like anyone else's.
 */
export const AVATAR_COLORS: readonly string[] = [
  '#76549A', // [data] ente avatar.ts
  '#DF7861', // [data] ente avatar.ts
  '#94B49F', // [data] ente avatar.ts
  '#87A2FB', // [data] ente avatar.ts
  '#C689C6', // [data] ente avatar.ts
  '#937DC2', // [data] ente avatar.ts
  '#325288', // [data] ente avatar.ts
  '#85B4E0', // [data] ente avatar.ts
  '#C1A3A3', // [data] ente avatar.ts
  '#E1A059', // [data] ente avatar.ts
  '#426165', // [data] ente avatar.ts
  '#6B77B2', // [data] ente avatar.ts
  '#957FEF', // [data] ente avatar.ts
  '#DD9DE2', // [data] ente avatar.ts
  '#82AB8B', // [data] ente avatar.ts
  '#9BBBE8', // [data] ente avatar.ts
  '#8FBEBE', // [data] ente avatar.ts
  '#8AC3A1', // [data] ente avatar.ts
  '#A8B0F2', // [data] ente avatar.ts
  '#B0C695', // [data] ente avatar.ts
  '#E99AAD', // [data] ente avatar.ts
  '#D18484', // [data] ente avatar.ts
  '#78B5A7', // [data] ente avatar.ts
];

/** ente's `avatarTextColor`. */
export const AVATAR_TEXT_COLOR = '#fff'; // [data] ente avatar.ts

/** `colorSeedFromEmail` (Avatar.tsx): the sum of the address's code points. */
export function avatarColorSeed(email: string): number {
  let seed = 0;
  for (const ch of email) seed += ch.codePointAt(0) ?? 0;
  return seed;
}

export function avatarColorFor(email: string): string {
  return AVATAR_COLORS[avatarColorSeed(email) % AVATAR_COLORS.length]!;
}
