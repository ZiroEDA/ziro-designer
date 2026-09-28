// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Test helpers: a Gerber or an Excellon file read into its image, the way
 * `Read_GERBER_File` / `Read_EXCELLON_File` read one (graphic layer 0).
 */
import { EXCELLON_DEFAULTS, EXCELLON_IMAGE, GERBER_FILE_IMAGE } from '@ziroeda/gerbview';

export function parseGerber(text: string, name: string, layer = 0): GERBER_FILE_IMAGE {
  const img = new GERBER_FILE_IMAGE(layer);
  img.LoadGerberFile(name, text);
  return img;
}

export function parseExcellon(
  text: string,
  name: string,
  defaults: EXCELLON_DEFAULTS = new EXCELLON_DEFAULTS(),
  layer = 0,
): EXCELLON_IMAGE {
  const img = new EXCELLON_IMAGE(layer);
  img.LoadFile(name, defaults, text);
  return img;
}
