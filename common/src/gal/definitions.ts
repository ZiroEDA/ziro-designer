// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `gal/definitions.h`. */

/**
 * Rendering targets: buffers the drawing is composited from.
 */
export enum RENDER_TARGET {
  TARGET_CACHED = 0, ///< Main rendering target (cached)
  TARGET_NONCACHED, ///< Auxiliary rendering target (noncached)
  TARGET_OVERLAY, ///< Items that may change while the view stays the same (noncached)
  TARGET_TEMP, ///< Temporary target for drawing in separate layer
  TARGETS_NUMBER, ///< Number of available rendering targets
}

// Used in view.h to initialize VIEW_MAX_LAYERS and graphic_abstraction_layer.cpp
export const MAX_LAYERS_FOR_VIEW = 2048;
