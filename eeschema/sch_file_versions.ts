// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_file_versions.h`: the current s-expression file format versions (the
 * history of each bump is in the C++ header).
 */

/** Symbol library file version: updated properties formatting (do_not_autoplace, show_name). */
export const SEXPR_SYMBOL_LIB_FILE_VERSION = 20251024;

/** Schematic file version: variant in_bom semantics corrected. */
export const SEXPR_SCHEMATIC_FILE_VERSION = 20260306;
