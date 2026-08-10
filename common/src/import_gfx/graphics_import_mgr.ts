// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Picking a plugin for a file. Counterpart: `GRAPHICS_IMPORT_MGR`
 * (common/import_gfx/graphics_import_mgr.{h,cpp}).
 *
 * Small, and worth having anyway: it is the one place that knows which formats
 * can be imported, so a dialog asks it rather than sniffing extensions itself,
 * and the file-picker's filter and the "which plugin?" decision cannot drift
 * apart. Adding a third format is a line here and nothing in either dialog.
 */

import type { GRAPHICS_IMPORTER } from './graphics_importer.js';
import { DXF_IMPORT_PLUGIN } from './dxf_import_plugin.js';
import { SVG_IMPORT_PLUGIN } from './svg_import_plugin.js';

/** `GFX_FILE_T`. */
export enum GFX_FILE_T {
  DXF = 0,
  SVG = 1,
}

/**
 * `GRAPHICS_IMPORT_PLUGIN`, the surface every plugin offers.
 *
 * The C++ header is an abstract class both plugins inherit; ours is structural,
 * because both already have these methods and neither needs to be told so.
 */
export interface GRAPHICS_IMPORT_PLUGIN {
  GetName(): string;
  GetFileExtensions(): string[];
  SetImporter(aImporter: GRAPHICS_IMPORTER): void;
  /** Parse the file's text. Reading it is the caller's job, as in the browser. */
  Load(aContents: string): boolean;
  /** Replay what was parsed into the importer set by `SetImporter`. */
  Import(): boolean;
  GetImageWidth(): number;
  GetImageHeight(): number;
  /** What the file held that the import could not carry; each line ends in \n. */
  GetMessages(): string;
}

/** `GetImportableFileTypes`, in the order a file dialog should offer them. */
export function getImportableFileTypes(): GFX_FILE_T[] {
  return [GFX_FILE_T.DXF, GFX_FILE_T.SVG];
}

/** `GetPlugin`. */
export function getPlugin(aType: GFX_FILE_T): GRAPHICS_IMPORT_PLUGIN {
  switch (aType) {
    case GFX_FILE_T.DXF:
      return new DXF_IMPORT_PLUGIN();
    case GFX_FILE_T.SVG:
      return new SVG_IMPORT_PLUGIN();
    default:
      throw new Error('Unhandled graphics format');
  }
}

/**
 * `GetPluginByExt`. Returns null when nothing handles the extension, which is
 * upstream's empty `unique_ptr`.
 *
 * The extension is matched without its dot and without regard to case, which is
 * what `compareFileExtensions` does with `wxRegEx` and `wxRE_ICASE`.
 */
export function getPluginByExt(aExtension: string): GRAPHICS_IMPORT_PLUGIN | null {
  const ext = aExtension.replace(/^\./, '').toLowerCase();

  for (const type of getImportableFileTypes()) {
    const plugin = getPlugin(type);
    if (plugin.GetFileExtensions().some((e) => e.toLowerCase() === ext)) return plugin;
  }

  return null;
}

/** The extension of a filename, without its dot. Empty when it has none. */
export function fileExtension(aFileName: string): string {
  const dot = aFileName.lastIndexOf('.');
  return dot < 0 ? '' : aFileName.slice(dot + 1);
}
