// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_POSITION_RELATIVE`'s own state: which of the four ways the
 * reference point was picked. The move math itself is
 * `tools/position_relative_tool.ts`.
 */

/** `DIALOG_POSITION_RELATIVE::ANCHOR_TYPE`. */
export type PositionAnchorType = 'gridOrigin' | 'userOrigin' | 'item' | 'point';
