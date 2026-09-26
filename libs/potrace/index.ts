// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * KiCad's `thirdparty/potrace`: potracelib 1.15, the tracer
 * `bitmap2component` links. The library half only (`src/curve`,
 * `src/decompose`, `src/trace`, `src/potracelib`, and the headers they
 * include); the frontend files KiCad also vendors (`bitmap_io`, `greymap`,
 * `render`) belong to the potrace command-line program and nothing in KiCad
 * calls them.
 */
export * from './src/potracelib.js';
export { BM_GET, BM_PUT, bm_new, bm_free } from './include/bitmap.js';
