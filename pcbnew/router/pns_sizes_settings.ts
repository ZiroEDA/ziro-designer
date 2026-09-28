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

/**
 * The plain-object spelling of the same settings, as `PnsRouter` stores them.
 *
 * Structural rather than an import of `PnsRouterSizes`, which would be a cycle:
 * `pns_router.ts` reaches this module through the line placer. `PnsRouterSizes`
 * is a superset, so it satisfies this.
 */
export interface PnsPlainSizes {
  trackWidth: number;
  trackWidthIsExplicit: boolean;
  viaDiameter: number;
  viaDrill: number;
  viaType: PnsViaTypeSetting;
  layerTop: number;
  layerBottom: number;
}

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

  /**
   * The same settings, as `ROUTER` stores them.
   *
   * Upstream has exactly one `SIZES_SETTINGS`, and `ROUTER::UpdateSizes` hands
   * `m_sizes` straight to whichever placer is running. This port grew two
   * spellings of it independently — a plain object shaped for
   * `DIFF_PAIR_PLACER` (`PnsRouterSizes`, a superset that also carries the
   * diff-pair gaps and the board minimums) and this class, ported later for
   * `LINE_PLACER`. Nothing had ever driven the line placer *through* the
   * router, so the two never met, and when they finally did the placer got a
   * plain object and died on `this.mSizes.trackWidth is not a function`.
   *
   * Rather than rewrite one of the two, this is the conversion, in one place,
   * on the one edge where a plain settings object reaches this class. Every
   * field here exists in the plain shape, so nothing is lost.
   */
  static fromRouterSizes(aSizes: PnsPlainSizes): PnsSizesSettings {
    const s = new PnsSizesSettings();
    s.mTrackWidth = aSizes.trackWidth;
    s.mTrackWidthIsExplicit = aSizes.trackWidthIsExplicit;
    s.mViaDiameter = aSizes.viaDiameter;
    s.mViaDrill = aSizes.viaDrill;
    s.mViaType = aSizes.viaType;
    s.mLayerTop = aSizes.layerTop;
    s.mLayerBottom = aSizes.layerBottom;
    return s;
  }

  /**
   * Normalise either spelling to this one. A no-op on an instance, so a caller
   * that already holds one pays nothing and keeps its identity.
   */
  static from(aSizes: PnsPlainSizes | PnsSizesSettings): PnsSizesSettings {
    return aSizes instanceof PnsSizesSettings ? aSizes : PnsSizesSettings.fromRouterSizes(aSizes);
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
