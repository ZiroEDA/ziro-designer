// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `#define`s at the head of `include/board_design_settings.h`: the
 * defaults (mm unless said otherwise) `BOARD_DESIGN_SETTINGS` starts from.
 * [data] KiCad's own numbers; the class itself comes with BOARD (#636).
 */

export const DEFAULT_SILK_LINE_WIDTH = 0.1;
export const DEFAULT_COPPER_LINE_WIDTH = 0.2;
export const DEFAULT_EDGE_WIDTH = 0.05;
export const DEFAULT_COURTYARD_WIDTH = 0.05;
export const DEFAULT_LINE_WIDTH = 0.1;

export const DEFAULT_SILK_TEXT_SIZE = 1.0;
export const DEFAULT_COPPER_TEXT_SIZE = 1.5;
export const DEFAULT_TEXT_SIZE = 1.0;

export const DEFAULT_SILK_TEXT_WIDTH = 0.1;
export const DEFAULT_COPPER_TEXT_WIDTH = 0.3;
export const DEFAULT_TEXT_WIDTH = 0.15;

export const DEFAULT_DIMENSION_ARROW_LENGTH = 50; // mils, for legacy purposes
export const DEFAULT_DIMENSION_EXTENSION_OFFSET = 0.5;

// Board thickness, mainly for 3D view:
export const DEFAULT_BOARD_THICKNESS_MM = 1.6;

export const DEFAULT_PCB_EDGE_THICKNESS = 0.15;

// soldermask to pad clearance. The default is 0 because usually board houses
// create a clearance depending on their fab process: mask material, color, price, etc.
export const DEFAULT_SOLDERMASK_EXPANSION = 0.0;

export const DEFAULT_SOLDERMASK_TO_COPPER_CLEARANCE = 0.0;

export const DEFAULT_SOLDERMASK_MIN_WIDTH = 0.0;

export const DEFAULT_SOLDERPASTE_CLEARANCE = 0.0;
export const DEFAULT_SOLDERPASTE_RATIO = 0.0;

export const DEFAULT_CUSTOMTRACKWIDTH = 0.2;
export const DEFAULT_CUSTOMDPAIRWIDTH = 0.125;
export const DEFAULT_CUSTOMDPAIRGAP = 0.18;
export const DEFAULT_CUSTOMDPAIRVIAGAP = 0.18;

export const DEFAULT_MEANDER_SPACING = 0.6;
export const DEFAULT_DP_MEANDER_SPACING = 1.0;

export const DEFAULT_MINCLEARANCE = 0.0; // overall min clearance
export const DEFAULT_MINCONNECTION = 0.0; // overall min connection width
export const DEFAULT_TRACKMINWIDTH = 0.2; // track width min value (mm)
export const DEFAULT_VIASMINSIZE = 0.5; // vias (not micro vias) min diameter
export const DEFAULT_MINTHROUGHDRILL = 0.3; // through holes (not micro vias) min drill diameter
export const DEFAULT_MICROVIASMINSIZE = 0.2; // micro vias (not vias) min diameter
export const DEFAULT_MICROVIASMINDRILL = 0.1; // micro vias (not vias) min drill diameter
export const DEFAULT_HOLETOHOLEMIN = 0.25; // minimum web thickness between two drilled holes
export const DEFAULT_HOLECLEARANCE = 0.25; // copper-to-hole clearance (from IPC level A)

export const DEFAULT_COPPEREDGECLEARANCE = 0.5; // clearance between copper items and edge cuts
export const LEGACY_COPPEREDGECLEARANCE = -0.01; // A flag to indicate the legacy method (based
// on edge cut line thicknesses) should be used.
export const DEFAULT_SILKCLEARANCE = 0.0;
export const DEFAULT_MINGROOVEWIDTH = 0.0;

export const DEFAULT_MINRESOLVEDSPOKES = 2; // Fewer resolved spokes indicates a starved thermal

export const MINIMUM_ERROR_SIZE_MM = 0.001; // For arc approximation
export const MAXIMUM_ERROR_SIZE_MM = 0.1; // For arc approximation

/** `pcbIUScale.mmToIU( 500 )`, to prevent int-overflows. */
export const MAXIMUM_CLEARANCE = 500 * 1e6;

// Min/max values used in dialogs to validate settings
export const MINIMUM_LINE_WIDTH_MM = 0.005; // minimal line width entered in a dialog
export const MAXIMUM_LINE_WIDTH_MM = 100.0; // max line width entered in a dialog

// Default pad properties
export const DEFAULT_PAD_WIDTH_MM = 2.54;
export const DEFAULT_PAD_HEIGTH_MM = 1.27;
export const DEFAULT_PAD_DRILL_DIAMETER_MM = 0.8;
export const DEFAULT_PAD_RR_RADIUS_RATIO = 0.15;
