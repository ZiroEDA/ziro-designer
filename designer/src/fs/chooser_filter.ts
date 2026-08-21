// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One entry of the file chooser's type combo.
 *
 * It lives here rather than in `FileChooser.tsx` so that the wildcard tables -
 * which are `common/wildcards_and_files_ext.cpp`, not widget code - can name it
 * without resolving a `.tsx`. `qa`'s tsc compiles `.ts` only and has no
 * `--jsx`, so a type-only import that reaches a `.tsx` passes vitest and fails
 * the workspace typecheck. `FileChooser.tsx` re-exports it, so callers can go
 * on asking the widget for its own prop types.
 */

/** One entry of the type combo at the bottom right. */
export interface ChooserFilter {
  /** The whole string the combo shows — `KiCad project files (*.kicad_pro)`. */
  readonly label: string;
  /** Lowercase extensions without the dot. Empty means everything. */
  readonly extensions: readonly string[];
}
