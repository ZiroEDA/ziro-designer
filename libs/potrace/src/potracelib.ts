// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/src/potracelib.cpp` + `include/potracelib.h`: the
 * public API KiCad's `BITMAPCONV_INFO::ConvertBitmap` calls —
 * `potrace_param_default`, `potrace_trace`, `potrace_state_free`,
 * `potrace_param_free`.
 *
 * The progress callback (`progress.h`) is not ported: KiCad never sets one,
 * so every `progress_update` in the library is a no-op for its only caller.
 * The `progress` member of the parameters is kept so the struct reads as the
 * header's.
 */
import { bm_to_pathlist } from './decompose.js';
import type { privpath_t } from './curve.js';
import { process_path } from './trace.js';

export const POTRACE_TURNPOLICY_BLACK = 0;
export const POTRACE_TURNPOLICY_WHITE = 1;
export const POTRACE_TURNPOLICY_LEFT = 2;
export const POTRACE_TURNPOLICY_RIGHT = 3;
export const POTRACE_TURNPOLICY_MINORITY = 4;
export const POTRACE_TURNPOLICY_MAJORITY = 5;
export const POTRACE_TURNPOLICY_RANDOM = 6;

/** `potrace_progress_t`. */
export interface potrace_progress_t {
  callback: ((progress: number, privdata: unknown) => void) | null;
  data: unknown;
  min: number;
  max: number;
  epsilon: number;
}

/** `potrace_param_t`. */
export interface potrace_param_t {
  /** area of largest path to be ignored */
  turdsize: number;
  /** resolves ambiguous turns in path decomposition */
  turnpolicy: number;
  /** corner threshold */
  alphamax: number;
  /** use curve optimization? */
  opticurve: number;
  /** curve optimization tolerance */
  opttolerance: number;
  /** progress callback function */
  progress: potrace_progress_t;
}

/**
 * `potrace_bitmap_t`: `w` x `h` pixels, `dy` units per scanline. See
 * `include/bitmap.ts` for why `map` holds a byte per pixel, not packed words.
 */
export interface potrace_bitmap_t {
  w: number;
  h: number;
  dy: number;
  map: Uint8Array;
}

/** `potrace_dpoint_t`. */
export interface potrace_dpoint_t {
  x: number;
  y: number;
}

export const POTRACE_CURVETO = 1;
export const POTRACE_CORNER = 2;

/** `potrace_curve_t`. */
export interface potrace_curve_t {
  /** number of segments */
  n: number;
  /** tag[n]: POTRACE_CURVETO or POTRACE_CORNER */
  tag: number[];
  /** c[n][3]: control points. c[n][0] is unused for tag[n]=POTRACE_CORNER */
  c: potrace_dpoint_t[][];
}

/** `potrace_path_t`. */
export interface potrace_path_t {
  /** area of the bitmap path */
  area: number;
  /** '+' or '-', depending on orientation */
  sign: string;
  /** this path's vector data */
  curve: potrace_curve_t;
  /** linked list structure */
  next: potrace_path_t | null;
  /** tree structure */
  childlist: potrace_path_t | null;
  /** tree structure */
  sibling: potrace_path_t | null;
  /** private state */
  priv: privpath_t;
}

export const POTRACE_STATUS_OK = 0;
export const POTRACE_STATUS_INCOMPLETE = 1;

/** `potrace_state_t`. */
export interface potrace_state_t {
  status: number;
  /** vector data */
  plist: potrace_path_t | null;
  /** private state (currently unused) */
  priv: null;
}

/** `param_default`. [data] */
const param_default: potrace_param_t = {
  turdsize: 2,
  turnpolicy: POTRACE_TURNPOLICY_MINORITY,
  alphamax: 1.0,
  opticurve: 1,
  opttolerance: 0.2,
  progress: { callback: null, data: null, min: 0.0, max: 1.0, epsilon: 0.0 },
};

/** `potrace_param_default()`: a fresh copy of the defaults. */
export function potrace_param_default(): potrace_param_t | null {
  return { ...param_default, progress: { ...param_default.progress } };
}

/**
 * `potrace_trace( param, bm )`: decompose the bitmap into paths, then turn
 * each path into curves. Null when the decomposition fails; a state with
 * `POTRACE_STATUS_INCOMPLETE` when a path could not be processed.
 */
export function potrace_trace(
  param: potrace_param_t,
  bm: potrace_bitmap_t,
): potrace_state_t | null {
  const plist = bm_to_pathlist(bm, param);

  if (plist === undefined) return null;

  const st: potrace_state_t = { status: POTRACE_STATUS_OK, plist, priv: null };

  if (process_path(plist, param)) st.status = POTRACE_STATUS_INCOMPLETE;

  return st;
}

/** `potrace_state_free( st )`: the garbage collector's. */
export function potrace_state_free(_st: potrace_state_t | null): void {}

/** `potrace_param_free( p )`: the garbage collector's. */
export function potrace_param_free(_p: potrace_param_t | null): void {}

/** `potrace_version()`: `POTRACELIB_VERSION` (`potrace_version.h`). [data] */
export function potrace_version(): string {
  return 'potracelib 1.15';
}
