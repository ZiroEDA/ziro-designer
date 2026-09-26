// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxASSERT` / `wxASSERT_MSG`: a check that costs a boolean test when it
 * passes. `console.assert` is a native call whose arguments are evaluated
 * and marshalled every time, which the vertex and view hot paths call per
 * vertex and per visit; in a release wx build the assert compiles away.
 */

/** `wxASSERT( cond )` / `wxASSERT_MSG( cond, msg )`. */
export function wxASSERT(aCondition: boolean, aMessage?: string): void {
  if (!aCondition) console.assert(false, aMessage ?? 'wxASSERT failed');
}
