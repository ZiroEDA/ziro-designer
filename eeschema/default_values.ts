// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/default_values.h`: the default values of eeschema's draw items, all in mils
 * unless noted. Data, mirrored from KiCad's header.
 */

/** The size of the rectangle indicating an unconnected wire or label. */
export const DANGLING_SYMBOL_SIZE = 12;

/** The size of the rectangle indicating the anchor of a text object (including fields). */
export const UNSELECTED_END_SIZE = 4;

/** The size of the rectangle indicating the anchor of a text object (including fields). */
export const TEXT_ANCHOR_SIZE = 8;

/** The default pin len value when creating pins(can be changed in preference menu). */
export const DEFAULT_PIN_LENGTH = 100;

/** The default pin number size when creating pins(can be changed in preference menu). */
export const DEFAULT_PINNUM_SIZE = 50;

/** The default pin name size when creating pins(can be changed in preference menu). */
export const DEFAULT_PINNAME_SIZE = 50;

/** The default selection highlight thickness (can be changed in preference menu). */
export const DEFAULTSELECTIONTHICKNESS = 3;

/** The default line width in mils. (can be changed in preference menu). */
export const DEFAULT_LINE_WIDTH_MILS = 6;

/** The default wire width in mils. (can be changed in preference menu). */
export const DEFAULT_WIRE_WIDTH_MILS = 6;

/** The default bus width in mils. (can be changed in preference menu). */
export const DEFAULT_BUS_WIDTH_MILS = 12;

/** The default noconnect size in mils. */
export const DEFAULT_NOCONNECT_SIZE = 48;

/** The default junction diameter in mils. (can be changed in preference menu). */
export const DEFAULT_JUNCTION_DIAM = 36;

/** The default bus and wire entry size in mils. */
export const DEFAULT_SCH_ENTRY_SIZE = 100;

/** The default text size in mils. (can be changed in preference menu). */
export const DEFAULT_TEXT_SIZE = 50;

/** Ratio of the font height to the baseline of the text above the wire. */
export const DEFAULT_TEXT_OFFSET_RATIO = 0.15;

/** Ratio of the font height to space around global labels. */
export const DEFAULT_LABEL_SIZE_RATIO = 0.375;

/** The offset of the pin name string from the end of the pin in mils. */
export const DEFAULT_PIN_NAME_OFFSET = 20;

/** The intersheets references prefix string. */
export const DEFAULT_IREF_PREFIX = '[';

/** The intersheets references suffix string. */
export const DEFAULT_IREF_SUFFIX = ']';

/** The thickness of the line... used for snapping to objects. */
export const SNAP_RANGE = 55;
