// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `import.meta.glob`, declared locally instead of pulling in `vite/client`.
 *
 * `qa`'s tsconfig compiles `.tsx` now (so that a test can render a React
 * panel), which drags in panels that call Vite's `import.meta.glob` — and
 * without a declaration `tsc` rejects them. The obvious fix, adding
 * `"vite/client"` to `types`, makes `vite` a hard dependency of typechecking
 * `qa`: a checkout where it has not been installed fails with TS2688 and no
 * hint as to why. That is not hypothetical — it broke the typecheck in every
 * agent worktree, because a worktree keeps the `node_modules` it was created
 * with and does not pick up a dependency added to `qa` afterwards.
 *
 * One ambient declaration costs nothing and cannot go missing.
 */
interface ImportMeta {
  glob(
    pattern: string,
    options?: { eager?: boolean; query?: string; import?: string },
  ): Record<string, unknown>;
}
