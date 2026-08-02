// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Create Array dialog's settings, and how they become an array spec.
 * Counterpart: `DIALOG_CREATE_ARRAY::TransferDataFromWindow`.
 *
 * Kept out of the .tsx so qa can typecheck and test it — the dialog is layout,
 * this is the part with decisions in it.
 *
 * Numbering is deliberately not offered. `ARRAY_OPTIONS::GetItemNumber` is
 * ported and tested, but nothing here renumbers anything yet: applying it means
 * rewriting pad numbers or reference designators, which is the footprint
 * editor's job (`ARRAY_PAD_NUMBER_PROVIDER`). A control that quietly did
 * nothing would be worse than its absence.
 */
import type { ArraySpec } from '@ziroeda/pcbnew';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

export type ArrayMode = 'grid' | 'circular';

export interface ArraySettings {
  mode: ArrayMode;

  // Grid
  nx: number;
  ny: number;
  dxIU: number;
  dyIU: number;
  offsetXIU: number;
  offsetYIU: number;
  stagger: number;
  staggerRows: boolean;
  centred: boolean;

  // Circular
  count: number;
  centreXIU: number;
  centreYIU: number;
  /** Degrees between copies; 0 divides a full turn evenly. */
  angle: number;
  angleOffset: number;
  clockwise: boolean;
  rotateItems: boolean;
}

export const DEFAULT_ARRAY_SETTINGS: ArraySettings = {
  mode: 'grid',
  nx: 5,
  ny: 5,
  dxIU: mmToIU(2.54),
  dyIU: mmToIU(2.54),
  offsetXIU: 0,
  offsetYIU: 0,
  stagger: 1,
  staggerRows: true,
  centred: false,
  count: 4,
  centreXIU: 0,
  centreYIU: 0,
  angle: 0,
  angleOffset: 0,
  clockwise: false,
  rotateItems: false,
};

/** How many items the settings describe, the original included. */
export function arrayItemCount(s: ArraySettings): number {
  return s.mode === 'grid' ? s.nx * s.ny : s.count;
}

/**
 * Whether the settings describe an array that can be built.
 *
 * A count of zero is the one that matters: a zero-point circular array has no
 * angle to divide, and a grid with a zero dimension has no items. Upstream
 * validates each count field and refuses the dialog rather than producing
 * nothing silently.
 */
export function arraySettingsValid(s: ArraySettings): boolean {
  if (s.mode === 'grid') return s.nx >= 1 && s.ny >= 1;
  return s.count >= 1;
}

/** `TransferDataFromWindow`: the settings as the engine wants them. */
export function arraySpecFrom(s: ArraySettings): ArraySpec {
  if (s.mode === 'grid') {
    return {
      kind: 'grid',
      options: {
        nx: s.nx,
        ny: s.ny,
        delta: { x: s.dxIU, y: s.dyIU },
        offset: { x: s.offsetXIU, y: s.offsetYIU },
        stagger: s.stagger,
        staggerRows: s.staggerRows,
        centred: s.centred,
      },
    };
  }

  return {
    kind: 'circular',
    options: {
      nPts: s.count,
      centre: { x: s.centreXIU, y: s.centreYIU },
      angle: s.angle,
      angleOffset: s.angleOffset,
      clockwise: s.clockwise,
      rotateItems: s.rotateItems,
    },
  };
}
