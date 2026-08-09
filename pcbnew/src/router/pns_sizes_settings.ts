// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::SIZES_SETTINGS` — the track width, via geometry and via layer span the
 * placer stamps onto everything it creates.
 *
 * Counterpart: `pcbnew/router/pns_sizes_settings.{h,cpp}`.
 *
 * Ported to the surface `LINE_PLACER` reads. `trackWidthIsExplicit` is the one
 * that carries real behaviour: `UpdateSizes` (`pns_line_placer.cpp:2015-2021`)
 * refuses to change the width of a track already being continued *unless* the
 * user has explicitly picked a width, so that dragging out of an existing 0.5 mm
 * track does not silently narrow it to the netclass default.
 *
 * Not ported: the board-minimum clamp, the diff-pair gap, the hole-to-hole and
 * annular-ring derivations, and `Init( BOARD*, ... )` — all of which read a
 * `BOARD` and belong with the router's board interface rather than here.
 */

import type { PcbVia } from '../types.js';

/** `VIATYPE`, spelled as this repo already spells it on a board via. */
export type PnsViaTypeSetting = PcbVia['kind'];

export class PnsSizesSettings {
  private mTrackWidth = 0;
  private mTrackWidthIsExplicit = true;
  private mViaDiameter = 0;
  private mViaDrill = 0;
  private mViaType: PnsViaTypeSetting = 'through';
  private mLayerTop = 0;
  private mLayerBottom = 0;

  trackWidth(): number {
    return this.mTrackWidth;
  }

  setTrackWidth(aWidth: number): void {
    this.mTrackWidth = aWidth;
  }

  trackWidthIsExplicit(): boolean {
    return this.mTrackWidthIsExplicit;
  }

  setTrackWidthIsExplicit(aIsExplicit: boolean): void {
    this.mTrackWidthIsExplicit = aIsExplicit;
  }

  viaDiameter(): number {
    return this.mViaDiameter;
  }

  setViaDiameter(aDiameter: number): void {
    this.mViaDiameter = aDiameter;
  }

  viaDrill(): number {
    return this.mViaDrill;
  }

  setViaDrill(aDrill: number): void {
    this.mViaDrill = aDrill;
  }

  viaType(): PnsViaTypeSetting {
    return this.mViaType;
  }

  setViaType(aViaType: PnsViaTypeSetting): void {
    this.mViaType = aViaType;
  }

  /** `GetLayerTop()` — the PNS layer a non-through via starts on. */
  getLayerTop(): number {
    return this.mLayerTop;
  }

  setLayerTop(aLayer: number): void {
    this.mLayerTop = aLayer;
  }

  /** `GetLayerBottom()`. */
  getLayerBottom(): number {
    return this.mLayerBottom;
  }

  setLayerBottom(aLayer: number): void {
    this.mLayerBottom = aLayer;
  }

  clone(): PnsSizesSettings {
    const s = new PnsSizesSettings();
    s.mTrackWidth = this.mTrackWidth;
    s.mTrackWidthIsExplicit = this.mTrackWidthIsExplicit;
    s.mViaDiameter = this.mViaDiameter;
    s.mViaDrill = this.mViaDrill;
    s.mViaType = this.mViaType;
    s.mLayerTop = this.mLayerTop;
    s.mLayerBottom = this.mLayerBottom;
    return s;
  }
}
