// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The avatar colour is ente's: their palette, their seed (the sum of the
 * address's code points), their modulus. Pinned against values computed by
 * hand from `web/apps/photos/src/components/Avatar.tsx` and `services/avatar.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  avatarColorFor,
  avatarColorSeed,
} from '@ziroeda/designer/src/auth/avatar_color.js';

describe('avatarColorFor', () => {
  it("carries ente's 23-colour palette in its order", () => {
    expect(AVATAR_COLORS).toHaveLength(23);
    expect(AVATAR_COLORS[0]).toBe('#76549A');
    expect(AVATAR_COLORS[22]).toBe('#78B5A7');
  });

  it('seeds with the sum of code points, as colorSeedFromEmail does', () => {
    // 'a' = 97, '@' = 64, 'b' = 98: 259.
    expect(avatarColorSeed('a@b')).toBe(259);
    // 259 % 23 = 6.
    expect(avatarColorFor('a@b')).toBe(AVATAR_COLORS[6]);
  });

  it('is stable for an address and differs between addresses', () => {
    expect(avatarColorFor('x@y.test')).toBe(avatarColorFor('x@y.test'));
    // Same length, different letters: the seed, not the length, decides.
    expect(avatarColorFor('a@b')).not.toBe(avatarColorFor('b@b'));
  });
});
