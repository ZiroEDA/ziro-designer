// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Resolves each toolbar tool id to KiCad's own icon (the dark-theme SVGs
 * vendored under assets/toolbar). The id-to-bitmap table lives in
 * `toolbar_bitmaps.ts`; only the file lookup is here, because `import.meta.glob`
 * is Vite-only and would make the table untestable.
 */
import { BITMAP } from './toolbar_bitmaps.js';

const URLS = import.meta.glob('../assets/toolbar/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** KiCad icon URL for a toolbar tool id, or undefined if none is mapped. */
export function toolbarIconUrl(id: string): string | undefined {
  const name = BITMAP[id];
  return name ? URLS[`../assets/toolbar/${name}.svg`] : undefined;
}

/**
 * A KiCad bitmap by NAME, for the call sites that are not toolbars.
 *
 * `BITMAPS::text_align_left` and friends are set directly on controls all over
 * KiCad — `properties_frame.cpp:100-120` gives the drawing sheet's eight
 * format buttons theirs this way — and those call sites have no tool id to go
 * through `BITMAP`. Same vendored files, same glob, one lookup.
 */
export function bitmapUrl(name: string): string | undefined {
  return URLS[`../assets/toolbar/${name}.svg`];
}
