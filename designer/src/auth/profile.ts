// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The picture an identity provider gave us, if it gave us one.
 *
 * Supabase copies the provider's raw claims into `user_metadata`, so what is
 * there depends entirely on how the person signed in. Google's OIDC claim is
 * `picture`; Supabase also normalises one to `avatar_url` for most providers,
 * and the two do not always both appear. Somebody who signed in with an emailed
 * code has neither, which is not a failure -- it is the common case, and the
 * caller falls back to a monogram.
 *
 * Separated from the component because it is the part with decisions in it, and
 * a component that reaches into `user_metadata` itself cannot be tested for
 * them: the type is `Record<string, unknown>` by construction, since the shape
 * is the provider's rather than ours.
 */

/**
 * A usable photo URL from a Supabase user's metadata, or null.
 *
 * The scheme is checked rather than assumed. This value comes from an external
 * identity provider and goes straight into an `img src`, and "it is only an
 * image" is how a `data:` or `javascript:` URL ends up somewhere it renders.
 * Only http(s) is let through.
 */
export function profilePhotoUrl(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const meta = metadata as Record<string, unknown>;
  // `avatar_url` first: it is the one Supabase normalises across providers, so
  // preferring it means the same field works for a provider added later.
  for (const key of ['avatar_url', 'picture']) {
    const raw = meta[key];
    if (typeof raw !== 'string' || raw === '') continue;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Not a URL at all. Nothing to fall back to within this key.
    }
  }
  return null;
}

/**
 * The monogram shown when there is no picture, which is most sign-ins.
 *
 * Guarded rather than indexed: an OAuth identity that released no email leaves
 * an empty string, and `''[0]` is undefined rather than an error, so the bug it
 * would cause is a blank circle rather than a crash.
 */
export function profileInitial(email: string): string {
  return (email.trim()[0] ?? '?').toUpperCase();
}
