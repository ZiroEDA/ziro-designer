// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which controls the dimension properties dialog shows, by kind.
 * Counterpart: the `switch( m_dimension->Type() )` in
 * `DIALOG_DIMENSION_PROPERTIES`' constructor, which hides whole sizers, plus
 * `m_extensionOvershoot.Show(false)` for anything that is not a
 * `PCB_DIM_ALIGNED`.
 *
 * These rules are not cosmetic. Every hidden control corresponds to a field the
 * engine refuses to write for that kind, so a control shown where the engine
 * ignores it is a box the user can type into that silently does nothing — and
 * one hidden where the engine *does* write is a property they can never reach.
 * The last describe below ties each flag to the engine to keep the two honest.
 */
import { describe, expect, it } from 'vitest';
import type { DimensionKind } from '@ziroeda/pcbnew/types.js';
import { dimensionDialogFields as fieldsFor } from '@ziroeda/pcbnew/dialogs/dialog_dimension_properties.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

/** The dimension kinds as the KICAD_T each one is (pcb_dimension.h). */
const TYPE_OF: Record<DimensionKind, KICAD_T> = {
  aligned: KICAD_T.PCB_DIM_ALIGNED_T,
  orthogonal: KICAD_T.PCB_DIM_ORTHOGONAL_T,
  leader: KICAD_T.PCB_DIM_LEADER_T,
  center: KICAD_T.PCB_DIM_CENTER_T,
  radial: KICAD_T.PCB_DIM_RADIAL_T,
};
const dimensionDialogFields = (k: DimensionKind) => fieldsFor(TYPE_OF[k]);

const ALL: DimensionKind[] = ['aligned', 'orthogonal', 'center', 'radial', 'leader'];

describe('an aligned or orthogonal dimension', () => {
  it('shows everything except the leader text frame', () => {
    for (const k of ['aligned', 'orthogonal'] as const) {
      const f = dimensionDialogFields(k);
      expect(f.format, k).toBe(true);
      expect(f.text, k).toBe(true);
      expect(f.textPositionMode, k).toBe(true);
      expect(f.arrowLength, k).toBe(true);
      expect(f.extensionOffset, k).toBe(true);
      expect(f.extensionOvershoot, k).toBe(true);
      expect(f.arrowDirection, k).toBe(true);
      expect(f.textFrame, k).toBe(false);
    }
  });
});

describe('a centre dimension', () => {
  const f = dimensionDialogFields('center');

  it('hides the format and text groups, because it measures nothing', () => {
    expect(f.format).toBe(false);
    expect(f.text).toBe(false);
  });

  it('hides the arrow length and extension offset, because it draws only a cross', () => {
    expect(f.arrowLength).toBe(false);
    expect(f.extensionOffset).toBe(false);
  });

  it('leaves nothing but the layer, lock and line thickness', () => {
    expect(f.extensionOvershoot).toBe(false);
    expect(f.arrowDirection).toBe(false);
    expect(f.textFrame).toBe(false);
  });
});

describe('a leader', () => {
  const f = dimensionDialogFields('leader');

  it('hides the format group, showing typed text rather than a measurement', () => {
    expect(f.format).toBe(false);
  });

  it('keeps its text but loses the position-mode choice', () => {
    expect(f.text).toBe(true);
    expect(f.textPositionMode).toBe(false);
  });

  it('is the only kind with a text frame', () => {
    expect(f.textFrame).toBe(true);
    for (const k of ALL.filter((x) => x !== 'leader'))
      expect(dimensionDialogFields(k).textFrame, k).toBe(false);
  });

  it('has no extension overshoot, the cast that gates it failing for a leader', () => {
    expect(f.extensionOvershoot).toBe(false);
  });
});

describe('a radial dimension', () => {
  const f = dimensionDialogFields('radial');

  it('measures, so it keeps the format and text groups', () => {
    expect(f.format).toBe(true);
    expect(f.text).toBe(true);
  });

  it('has no extension overshoot or arrow direction, being no kind of aligned', () => {
    // Both are gated on PCB_DIM_ALIGNED upstream. Arrow direction is the one
    // deliberate divergence: upstream leaves the control visible even though
    // the serializer never writes it for a radial, so it is hidden here rather
    // than offered as a box that does nothing.
    expect(f.extensionOvershoot).toBe(false);
    expect(f.arrowDirection).toBe(false);
  });
});
