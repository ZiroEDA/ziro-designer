// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chooser's *data* types, split out of `FileChooser.tsx` for the same
 * reason `toolbar_types.ts` was split out of `Toolbar.tsx` and `menu_types.ts`
 * out of `MenuBar.tsx`: a plain data module that imports a type from a `.tsx`
 * is outside `qa`'s tsconfig, which compiles `.ts` only. Vitest resolves it and
 * passes; CI's `tsc` does not, and reports `--jsx is not set`.
 *
 * `wildcards.ts` is exactly that kind of module — it is nothing but filter
 * data — and it took this import down with it the moment a test reached it.
 *
 * `FileChooser.tsx` re-exports these, so existing importers are unaffected.
 */

/** One entry of the type combo at the bottom right. */
export interface ChooserFilter {
  /** The whole string the combo shows — `KiCad project files (*.kicad_pro)`. */
  readonly label: string;
  /** Lowercase extensions without the dot. Empty means everything. */
  readonly extensions: readonly string[];
}
