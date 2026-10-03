// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Reference Image Properties dialog.
 * Counterparts: `DIALOG_REFERENCE_IMAGE_PROPERTIES` and the scale half of
 * `PANEL_IMAGE_EDITOR`.
 *
 * The dialog shows width, height and scale, but the item stores only a scale —
 * so all three are one number wearing three hats, and typing in any of them has
 * to move the other two. That three-way binding is what most of this file is
 * about; the rest is the usual round-trip contract, where a scale of exactly 1
 * has to go back to being *absent* rather than written out.
 */
import { imageSizeIU } from '@ziroeda/pcbnew/pcb_reference_image.js';
import { describe, expect, it } from 'vitest';
import { U, writtenItems } from './support/written_node.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { parse } from '@ziroeda/sexpr/index.js';
import {
  scaleForHeight,
  scaleForWidth,
  sizeForScale,
  type ImageValues,
} from '@ziroeda/pcbnew/dialogs/dialog_reference_image_properties.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board, PcbImage } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

/** A 1x1 PNG: real header, so the pixel size and PPI are read rather than faked. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const image = (over: Partial<PcbImage> = {}): PcbImage => ({
  at: { x: MM(10), y: MM(20) },
  layer: 'F.SilkS',
  data: PNG,
  ...over,
});

const board = (images: PcbImage[]): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images,
  points: [],
  barcodes: [],
  groups: [],
});

describe('the three-way binding', () => {
  const img = image();
  // TransferDataToWindow's fields for that image: its size at its scale.
  const size = imageSizeIU(img);
  const start: ImageValues = {
    x: img.at.x,
    y: img.at.y,
    layer: img.layer,
    locked: false,
    scale: img.scale ?? 1,
    width: size.w,
    height: size.h,
  };

  it('turns a typed width into a scale', () => {
    const next = scaleForWidth(img, start, start.width * 3);

    expect(next.scale).toBeCloseTo(3, 6);
  });

  it('moves the height when the width is typed, since one scale drives both', () => {
    // There is no independent stretch: the aspect ratio is a property of the
    // model, which holds a single scale factor.
    const next = scaleForWidth(img, start, start.width * 3);

    expect(next.height).toBeGreaterThan(start.height);
    expect(next.height / next.width).toBeCloseTo(start.height / start.width, 3);
  });

  it('turns a typed height into a scale the same way', () => {
    const next = scaleForHeight(img, start, start.height * 3);

    expect(next.scale).toBeCloseTo(3, 6);
    expect(next.width).toBeGreaterThan(start.width);
  });

  it('round-trips: a width typed in comes back out', () => {
    const target = start.width * 5;

    expect(scaleForWidth(img, start, target).width).toBeCloseTo(target, -2);
  });

  it('ignores a width of zero rather than collapsing the image', () => {
    // What you see mid-typing, right after clearing the field.
    expect(scaleForWidth(img, start, 0)).toBe(start);
    expect(scaleForWidth(img, start, -5)).toBe(start);
  });

  it('ignores a height of zero for the same reason', () => {
    expect(scaleForHeight(img, start, 0)).toBe(start);
  });

  it('ignores a scale of zero or less', () => {
    expect(sizeForScale(img, start, 0)).toBe(start);
    expect(sizeForScale(img, start, -1)).toBe(start);
  });
});
