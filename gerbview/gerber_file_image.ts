// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GERBER_FILE_IMAGE, the parsed state and graphic contents of a single Gerber
 * layer, mirroring `gerbview/gerber_file_image.h/.cpp`. It owns the format
 * parameters (FS/MO/OF/MI/SF/IP/IR/AS), the aperture table (D_CODE) and macro
 * table (APERTURE_MACRO), and the resulting GERBER_DRAW_ITEM list. The RS-274X
 * directive handling (`ExecuteRS274XCommand`) and the RS-274D coordinate/draw
 * command interpreter (`Execute_G_Command` / `Execute_DCODE_Command`) live in
 * gerber_file_image_parse.ts and drive this object.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { GERBER_FORMAT, IU_PER_MM, IU_PER_MILS } from './types.js';
import { D_CODE } from './dcode.js';
import type { ApertureMacro } from './aperture_macro.js';
import type { GERBER_DRAW_ITEM, BBox } from './gerber_draw_item.js';

/** Coordinate format from the FS command. */
export interface CoordFormat {
  xInt: number;
  xFrac: number;
  yInt: number;
  yFrac: number;
  /** true = leading zeros omitted (FS L, default), false = trailing omitted (FS T). */
  leadingZerosOmitted: boolean;
  /** true = absolute coordinates (FS A / G90), false = incremental (FS I / G91). */
  absolute: boolean;
}

export class GERBER_FILE_IMAGE {
  fileName = '';
  /** The original file text, kept so the layer can be reloaded/re-parsed. */
  rawText = '';
  format: GERBER_FORMAT = GERBER_FORMAT.RS274X;

  /** Coordinate format (FS). Sensible modern default: 4.6 leading-omitted abs. */
  coordFormat: CoordFormat = {
    xInt: 4,
    xFrac: 6,
    yInt: 4,
    yFrac: 6,
    leadingZerosOmitted: true,
    absolute: true,
  };

  /** File unit ('mm' or 'in') and IU-per-unit scale. */
  unit: 'mm' | 'in' = 'in';
  iuScale = IU_PER_MILS * 1000; // IU per inch until MO seen

  /** IP: image is negative (whole layer inverted). */
  imageNegative = false;
  /** IR: image rotation in degrees (0/90/180/270). */
  imageRotation = 0;
  /** MI: image mirror per axis. */
  mirror: { x: boolean; y: boolean } = { x: false, y: false };
  /** OF/IO: image offset in file units. */
  offset: Vec2 = { x: 0, y: 0 };
  /** SF: image scale factor per axis. */
  scaleFactor: { x: number; y: number } = { x: 1, y: 1 };
  /** AS: axis select swaps X/Y when 'AYBX'. */
  swapAxis = false;

  /**
   * IJ (image justify), whose three fields are reset together by the command
   * and default to no justification (`gerbview/rs274x.cpp:594-597`).
   *
   * The offset is in **IU**, not file units, because upstream reads it as
   * `KiROUND( ReadDouble( aText ) * conv_scale )` (`:619,:639`) where
   * conv_scale is IU-per-file-unit — the same `iuScale` above. `m_Offset` and
   * `m_ImageOffset` are read the same way; ours are still in file units, which
   * is a separate divergence and not touched here.
   */
  imageJustifyXCenter = false;
  imageJustifyYCenter = false;
  imageJustifyOffset: Vec2 = { x: 0, y: 0 };

  /** Aperture table by D-code number. */
  apertures = new Map<number, D_CODE>();
  /** Aperture macro table by name. */
  macros = new Map<string, ApertureMacro>();

  /** The graphic items of this image. */
  items: GERBER_DRAW_ITEM[] = [];

  /** Image / layer names and X2 file attributes (for the layer manager). */
  imageName = '';
  /**
   * `GERBER_LAYER::m_LayerName` (`gerbview/gerber_file_image.h:90`), reached
   * through `GetLayerParams()` and shown in status field 0.
   *
   * [data] `"no name"` is KiCad's own string, written by
   * `GERBER_LAYER::ResetDefaultValues` (`gerber_file_image.cpp:75`) — and that
   * is the ONLY assignment to `m_LayerName` in 10.0.5. The `%LN` command the
   * comment there refers to no longer fills it: `rs274x.cpp:676-681` skips
   * `%LN` as "a (deprecated) equivalent to G04: a comment". So this field reads
   * `no name` for every file, which is what a real GerbView shows.
   */
  layerName = 'no name';
  fileFunction: string | null = null; // %TF.FileFunction,...
  filePolarity: string | null = null; // %TF.FilePolarity,Positive/Negative
  generatedBy: string | null = null; // %TF.GenerationSoftware / .CreationDate
  md5: string | null = null;

  /** True once at least one graphic item was produced. */
  hasContent(): boolean {
    return this.items.length > 0;
  }

  /** Create/get a D_CODE by number, allocating with the current scale. */
  getOrCreateDcode(num: number): D_CODE {
    let d = this.apertures.get(num);
    if (!d) {
      d = new D_CODE(num, this.iuScale);
      this.apertures.set(num, d);
    }
    return d;
  }

  getDcode(num: number): D_CODE | undefined {
    return this.apertures.get(num);
  }

  /** Set the file unit and update the IU scale (MO / G70 / G71). */
  setUnit(unit: 'mm' | 'in'): void {
    this.unit = unit;
    this.iuScale = unit === 'mm' ? IU_PER_MM : IU_PER_MILS * 1000;
  }

  /** Bounding box over all items in IU (empty box when there are none). */
  computeBoundingBox(): BBox {
    if (this.items.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const it of this.items) {
      const b = it.getBoundingBox();
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Distinct D-codes actually used by items (for the DCode list "used" flag). */
  usedDcodes(): Set<number> {
    const s = new Set<number>();
    for (const it of this.items) if (it.dcodeNum) s.add(it.dcodeNum);
    return s;
  }
}
