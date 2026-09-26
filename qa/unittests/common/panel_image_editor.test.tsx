// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PANEL_IMAGE_EDITOR (common/dialogs/panel_image_editor.cpp). The messages are
 * the C++'s format strings with its arithmetic done by hand: 300 ppi, so a
 * pixel is 25.4 / 300 mm and 1000 / 300 mil.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CheckValues,
  MAX_SIZE,
  MIN_SIZE,
  PANEL_IMAGE_EDITOR,
} from '@ziroeda/common/dialogs/panel_image_editor.js';

afterEach(cleanup);

describe('PANEL_IMAGE_EDITOR::CheckValues', () => {
  it('keeps upstream’s limits: 15 px (50 mils) and 6000 px (20 inches)', () => {
    expect([MIN_SIZE, MAX_SIZE]).toEqual([15, 6000]);
  });

  it('refuses a negative scale', () => {
    expect(CheckValues(-1, { x: 100, y: 100 })).toEqual({
      error: 'Scale must be a positive number.',
    });
  });

  it('refuses an image smaller than 15 px, with its size in mm and mil', () => {
    // 100 x 0.1 = 10 px -> 25.4/300*10 = 0.85 mm, 1000/300*10 = 33.3 mil.
    expect(CheckValues(0.1, { x: 100, y: 200 })).toEqual({
      error: 'This scale results in an image which is too small (0.85 mm or 33.3 mil).',
    });
  });

  it('asks before an image larger than 6000 px, with its size in mm and inches', () => {
    // 700 x 10 = 7000 px -> 592.7 mm, 23.33 in.
    expect(CheckValues(10, { x: 700, y: 100 })).toEqual({
      confirm:
        'This scale results in an image which is very large (592.7 mm or 23.33 in). Are you sure?',
    });
  });

  it('accepts a scale in between', () => {
    expect(CheckValues(1, { x: 100, y: 100 })).toBeNull();
  });
});

describe('PANEL_IMAGE_EDITOR', () => {
  it('has Scale, PPI and Convert to Greyscale', () => {
    render(
      <PANEL_IMAGE_EDITOR
        data=""
        scaleText="1"
        onScaleText={() => {}}
        ppi={300}
        onGreyscale={() => {}}
      />,
    );
    expect((screen.getByLabelText('Scale') as HTMLInputElement).value).toBe('1');
    expect(screen.getByText('300')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Convert to Greyscale' })).toBeTruthy();
  });
});
