// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** The module build.sh makes from imagjpeg_wasm.c: wxJPEGHandler's libjpeg calls, in WebAssembly. */

export interface IMAGJPEG_MODULE {
  HEAPU8: Uint8Array;
  /** wxJPEGHandler::LoadFile on \a aLen bytes at \a aPtr: 1 when decoded. */
  _wxjpeg_load(aPtr: number, aLen: number): number;
  /** wxJPEGHandler::SaveFile on RGB at \a aRgb: 1 when encoded. aQuality < 0: no quality option. */
  _wxjpeg_save(
    aRgb: number,
    aWidth: number,
    aHeight: number,
    aQuality: number,
    aResUnit: number,
    aResX: number,
    aResY: number,
  ): number;
  /** The last call's output: the RGB plane after a load, the JPEG stream after a save. */
  _wxjpeg_data(): number;
  _wxjpeg_size(): number;
  _wxjpeg_width(): number;
  _wxjpeg_height(): number;
  _wxjpeg_saw_jfif(): number;
  _wxjpeg_x_density(): number;
  _wxjpeg_y_density(): number;
  _wxjpeg_density_unit(): number;
  /** Free the last call's output. */
  _wxjpeg_release(): void;
  _wxjpeg_alloc(aSize: number): number;
  _wxjpeg_free(aPtr: number): void;
}

declare const createImagJpeg: () => Promise<IMAGJPEG_MODULE>;
export default createImagJpeg;
