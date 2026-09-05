// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The picture an identity provider gave us.
 *
 * Supabase copies the provider's raw claims into `user_metadata`, so the shape
 * is the provider's and not ours — `Record<string, unknown>` by construction.
 * That is exactly why the reading of it is a function rather than something a
 * component does inline: there is nothing to lean on but the checks here.
 */
import { describe, expect, it } from 'vitest';
import { profileInitial, profilePhotoUrl } from '@ziroeda/designer/src/auth/profile.js';

describe('a profile picture', () => {
  it('prefers the field Supabase normalises over the provider raw claim', () => {
    // `avatar_url` is the one Supabase writes across providers, so preferring
    // it means a provider added later works without touching this.
    expect(
      profilePhotoUrl({
        avatar_url: 'https://lh3.googleusercontent.com/a/normalised',
        picture: 'https://lh3.googleusercontent.com/a/raw',
      }),
    ).toBe('https://lh3.googleusercontent.com/a/normalised');
    // Google's OIDC claim on its own.
    expect(profilePhotoUrl({ picture: 'https://lh3.googleusercontent.com/a/raw' })).toBe(
      'https://lh3.googleusercontent.com/a/raw',
    );
  });

  it('lets through only http and https', () => {
    // This value comes from an external identity provider and goes straight
    // into an `img src`. "It is only an image" is how a `data:` URL ends up
    // somewhere it renders.
    expect(profilePhotoUrl({ avatar_url: 'javascript:alert(1)' })).toBeNull();
    expect(profilePhotoUrl({ avatar_url: 'data:image/svg+xml,<svg/>' })).toBeNull();
    expect(profilePhotoUrl({ avatar_url: 'not a url' })).toBeNull();
  });

  it('falls through a bad value to the next field rather than giving up', () => {
    expect(profilePhotoUrl({ avatar_url: '', picture: 'https://example.test/p.png' })).toBe(
      'https://example.test/p.png',
    );
    expect(
      profilePhotoUrl({ avatar_url: 'javascript:alert(1)', picture: 'https://example.test/p.png' }),
    ).toBe('https://example.test/p.png');
  });

  it('has nothing to offer for a sign-in that carried no picture', () => {
    // The common case, not a failure: somebody who signed in with an emailed
    // code has neither field, and the caller draws a monogram.
    expect(profilePhotoUrl({})).toBeNull();
    expect(profilePhotoUrl(null)).toBeNull();
    expect(profilePhotoUrl(undefined)).toBeNull();
    expect(profilePhotoUrl('nonsense')).toBeNull();
  });
});

describe('the monogram that stands in for it', () => {
  it('is the first letter of the address, upper-cased', () => {
    expect(profileInitial('akshay@example.test')).toBe('A');
    expect(profileInitial('  bob@example.test')).toBe('B');
  });

  it('does not crash on an identity that released no email', () => {
    // `''[0]` is undefined rather than an error, so the bug this guards is a
    // blank circle rather than a white screen — which is worse to diagnose.
    expect(profileInitial('')).toBe('?');
    expect(profileInitial('   ')).toBe('?');
  });
});
