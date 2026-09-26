// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/local_history.h`: what a document hands the local-history
 * snapshot. The snapshot store itself (a git repo under the project) is the
 * app's; the savers only fill these.
 */
import type { FORMAT_MODE } from './io/kicad/kicad_io_utils.js';

export interface HISTORY_FILE_DATA {
  relativePath: string; ///< Destination path relative to the project root
  content: string; ///< Serialized content (mutually exclusive with sourcePath)
  sourcePath: string; ///< For file-copy savers (small files like .kicad_pro)
  prettify: boolean;
  formatMode: FORMAT_MODE;
}
