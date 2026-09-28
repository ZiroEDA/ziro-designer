// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `VIA_PROTECTION_UI_MIXIN` (pcbnew/via_protection_ui_mixin.h): the IPC-4761
 * via protection presets the Track & Via Properties and Edit Track & Via
 * dialogs offer in `m_protectionFeatures`, and the two directions between a
 * preset and a via's PADSTACK flags.
 *
 * The presets are KiCad's own table, mirrored [data].
 */

import type { PCB_VIA } from './pcb_track.js';

export enum IPC4761_SURFACE {
  FROM_BOARD = 0,
  NONE = 1,
  FRONT = 2,
  BACK = 3,
  BOTH = 4,
  CUSTOM = 5,
}

export enum IPC4761_DRILL {
  FROM_BOARD = 0,
  NOT_SET = 1,
  SET = 2,
}

/** The row index of `m_protectionFeatures` is the enum value. */
export enum IPC4761_PRESET {
  FROM_BOARD = 0,
  NONE = 1,
  IA = 2,
  IB = 3,
  IA_INVERTED = 4,
  IIA = 5,
  IIB = 6,
  IIA_INVERTED = 7,
  IIIA = 8,
  IIIB = 9,
  IIIA_INVERTED = 10,
  IVA = 11,
  IVB = 12,
  IVA_INVERTED = 13,
  V = 14,
  VIA = 15,
  VIB = 16,
  VIA_INVERTED = 17,
  VII = 18,
  CUSTOM = 19,
  END = 20,
}

export interface IPC4761_CONFIGURATION {
  tent: IPC4761_SURFACE;
  cover: IPC4761_SURFACE;
  plug: IPC4761_SURFACE;
  fill: IPC4761_DRILL;
  cap: IPC4761_DRILL;
}

/** `IPC4761_CONFIGURATION`'s member defaults. */
const config = (c: Partial<IPC4761_CONFIGURATION>): IPC4761_CONFIGURATION => ({
  tent: IPC4761_SURFACE.NONE,
  cover: IPC4761_SURFACE.NONE,
  plug: IPC4761_SURFACE.NONE,
  fill: IPC4761_DRILL.NOT_SET,
  cap: IPC4761_DRILL.NOT_SET,
  ...c,
});

const configEq = (a: IPC4761_CONFIGURATION, b: IPC4761_CONFIGURATION): boolean =>
  a.tent === b.tent &&
  a.plug === b.plug &&
  a.cover === b.cover &&
  a.cap === b.cap &&
  a.fill === b.fill;

const S = IPC4761_SURFACE;
const D = IPC4761_DRILL;
const P = IPC4761_PRESET;

/** `m_IPC4761Presets`, in `std::map` (key) order. [data] */
export const IPC4761_PRESETS: ReadonlyMap<IPC4761_PRESET, IPC4761_CONFIGURATION> = new Map([
  [
    P.FROM_BOARD,
    config({
      tent: S.FROM_BOARD,
      cover: S.FROM_BOARD,
      plug: S.FROM_BOARD,
      fill: D.FROM_BOARD,
      cap: D.FROM_BOARD,
    }),
  ],
  [P.NONE, config({})],
  [P.IA, config({ tent: S.FRONT })],
  [P.IB, config({ tent: S.BOTH })],
  [P.IA_INVERTED, config({ tent: S.BACK })],
  [P.IIA, config({ tent: S.FRONT, cover: S.FRONT })],
  [P.IIB, config({ tent: S.BOTH, cover: S.BOTH })],
  [P.IIA_INVERTED, config({ tent: S.BACK, cover: S.BACK })],
  [P.IIIA, config({ plug: S.FRONT })],
  [P.IIIB, config({ plug: S.BOTH })],
  [P.IIIA_INVERTED, config({ plug: S.BACK })],
  [P.IVA, config({ tent: S.FRONT, plug: S.FRONT })],
  [P.IVB, config({ tent: S.BOTH, plug: S.BOTH })],
  [P.IVA_INVERTED, config({ tent: S.BACK, plug: S.BACK })],
  [P.V, config({ fill: D.SET })],
  [P.VIA, config({ tent: S.FRONT, fill: D.SET })],
  [P.VIB, config({ tent: S.BOTH, fill: D.SET })],
  [P.VIA_INVERTED, config({ tent: S.BACK, fill: D.SET })],
  [P.VII, config({ fill: D.SET, cap: D.SET })],
  [P.CUSTOM, config({})],
  [P.END, config({})],
]);

/** `m_IPC4761Names`. [data] */
export const IPC4761_NAMES: ReadonlyMap<IPC4761_PRESET, string> = new Map([
  [P.FROM_BOARD, 'From rules'],
  [P.NONE, 'None'],
  [P.IA, 'Type I-a (tented top)'],
  [P.IB, 'Type I-b (tented both sides)'],
  [P.IA_INVERTED, 'Type I-a (tented bottom)'],
  [P.IIA, 'Type II-a (covered and tented top)'],
  [P.IIB, 'Type II-b (covered and tented both sides)'],
  [P.IIA_INVERTED, 'Type II-a (covered and tented bottom)'],
  [P.IIIA, 'Type III-a (plugged top)'],
  [P.IIIB, 'Type III-b (plugged both sides)'],
  [P.IIIA_INVERTED, 'Type III-a (plugged bottom)'],
  [P.IVA, 'Type IV-a (plugged and tented top)'],
  [P.IVB, 'Type IV-b (plugged and tented both sides)'],
  [P.IVA_INVERTED, 'Type IV-a (plugged and tented bottom)'],
  [P.V, 'Type V (filled )'],
  [P.VIA, 'Type VI-a (filled and tented top)'],
  [P.VIB, 'Type VI-b (filled and tented both sides)'],
  [P.VIA_INVERTED, 'Type VI-a (filled and tented bottom)'],
  [P.VII, 'Type VII (filled and capped)'],
  [P.CUSTOM, 'Custom'],
  [P.END, 'End'],
]);

/** A front/back pair of PADSTACK optional flags, as the setters write them. */
interface OptPair {
  front: boolean | undefined;
  back: boolean | undefined;
}

export class VIA_PROTECTION_UI_MIXIN {
  protected getProtectionSurface(
    front: boolean | undefined,
    back: boolean | undefined,
  ): IPC4761_SURFACE {
    let value: IPC4761_SURFACE;

    if (front === undefined) value = S.FROM_BOARD;
    else if (front) value = S.FRONT;
    else value = S.NONE;

    if (back === undefined) {
      if (value === S.FROM_BOARD) return S.FROM_BOARD;
    } else if (back) {
      if (value === S.FRONT) return S.BOTH;
      else if (value === S.NONE) return S.BACK;
    } else {
      if (value === S.FRONT) return S.FRONT;
      else if (value === S.NONE) return S.NONE;
    }

    return S.CUSTOM;
  }

  protected getProtectionDrill(drill: boolean | undefined): IPC4761_DRILL {
    if (drill === undefined) return D.FROM_BOARD;
    if (drill) return D.SET;

    return D.NOT_SET;
  }

  getViaConfiguration(aVia: PCB_VIA): IPC4761_PRESET {
    const ps = aVia.Padstack();
    const cfg: IPC4761_CONFIGURATION = {
      tent: this.getProtectionSurface(
        ps.FrontOuterLayers().has_solder_mask,
        ps.BackOuterLayers().has_solder_mask,
      ),
      cover: this.getProtectionSurface(
        ps.FrontOuterLayers().has_covering,
        ps.BackOuterLayers().has_covering,
      ),
      plug: this.getProtectionSurface(
        ps.FrontOuterLayers().has_plugging,
        ps.BackOuterLayers().has_plugging,
      ),
      cap: this.getProtectionDrill(ps.Drill().is_capped),
      fill: this.getProtectionDrill(ps.Drill().is_filled),
    };

    for (const [preset, configuration] of IPC4761_PRESETS) {
      if (configEq(configuration, cfg)) return preset;
    }

    return P.CUSTOM;
  }

  protected setSurfaceProtection(aPair: OptPair, aProtection: IPC4761_SURFACE): void {
    switch (aProtection) {
      case S.FROM_BOARD:
        aPair.front = undefined;
        aPair.back = undefined;
        break;
      case S.NONE:
        aPair.front = false;
        aPair.back = false;
        break;
      case S.FRONT:
        aPair.front = true;
        aPair.back = false;
        break;
      case S.BACK:
        aPair.front = false;
        aPair.back = true;
        break;
      case S.BOTH:
        aPair.front = true;
        aPair.back = true;
        break;
      case S.CUSTOM:
        return;
    }
  }

  protected setDrillProtection(aProtection: IPC4761_DRILL): boolean | undefined {
    switch (aProtection) {
      case D.FROM_BOARD:
        return undefined;
      case D.NOT_SET:
        return false;
      case D.SET:
        return true;
    }
  }

  setViaConfiguration(aVia: PCB_VIA, aPreset: IPC4761_PRESET): void {
    // Do not change custom feaure list.
    if (aPreset >= P.CUSTOM) return;

    const cfg = IPC4761_PRESETS.get(aPreset)!;
    const ps = aVia.Padstack();
    const front = ps.FrontOuterLayers();
    const back = ps.BackOuterLayers();

    const apply = (
      key: 'has_solder_mask' | 'has_plugging' | 'has_covering',
      aProtection: IPC4761_SURFACE,
    ): void => {
      const pair: OptPair = { front: front[key], back: back[key] };
      this.setSurfaceProtection(pair, aProtection);
      front[key] = pair.front;
      back[key] = pair.back;
    };

    apply('has_solder_mask', cfg.tent);
    apply('has_plugging', cfg.plug);
    apply('has_covering', cfg.cover);

    ps.Drill().is_filled = this.setDrillProtection(cfg.fill);
    ps.Drill().is_capped = this.setDrillProtection(cfg.cap);
  }
}
