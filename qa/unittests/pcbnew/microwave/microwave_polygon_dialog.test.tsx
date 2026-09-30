// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MWAVE_POLYGONAL_SHAPE_DLG (microwave_polygon.cpp:60-243): what its window
 * transfers into the statics `createPolygonShape` then reads.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { MwavePolygonalShapeDlg } from '@ziroeda/pcbnew/microwave/microwave_polygon_ui.js';
import {
  g_MwaveShape,
  g_PolyEdges,
  g_ShapeSize,
  MWAVE_POLY_SHAPE_TYPE,
} from '@ziroeda/pcbnew/microwave/microwave_polygon.js';

const FILE = ['Unit=MM', 'XScale=10', 'YScale=2', '$COORD', '0 0.5', '1 1', '$ENDCOORD', ''].join(
  '\n',
);

beforeEach(() => {
  g_PolyEdges.length = 0;
  g_MwaveShape.type = MWAVE_POLY_SHAPE_TYPE.NORMAL;
  g_ShapeSize.x = 0;
  g_ShapeSize.y = 0;
});
afterEach(cleanup);

const show = (onResult = vi.fn()) => {
  render(<MwavePolygonalShapeDlg units="mm" iuScale={pcbIUScale} onResult={onResult} />);
  return onResult;
};
const radio = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const entry = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

const chooseFile = (text: string): void => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], 'shape.txt');
  // happy-dom's File has text(); a FileList is not constructible, so the
  // property the handler reads is defined directly.
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
};

describe('MWAVE_POLYGONAL_SHAPE_DLG', () => {
  it('has the wxRadioBox Normal / Symmetrical / Mirrored and X / Y size entries', () => {
    show();
    expect(screen.getByText('Complex Shape')).toBeTruthy();
    expect(['Normal', 'Symmetrical', 'Mirrored'].map((l) => radio(l).checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(entry('X:').value).toBe('');
    expect(entry('Y:').value).toBe('');
    expect(screen.getAllByText('mm')).toHaveLength(2);
    expect(screen.getByText('Read Shape Description File...')).toBeTruthy();
  });

  it('OK transfers the radio selection into g_PolyShapeType and the sizes into g_ShapeSize', () => {
    const onResult = show();
    fireEvent.click(radio('Mirrored'));
    fireEvent.change(entry('X:'), { target: { value: '2' } });
    fireEvent.change(entry('Y:'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(g_MwaveShape.type).toBe(MWAVE_POLY_SHAPE_TYPE.MIRRORED);
    expect(g_ShapeSize).toEqual({ x: 2000000, y: 500000 });
  });

  it('Cancel clears the point list and returns false, changing no static', () => {
    g_PolyEdges.push({ x: 1, y: 1 });
    const onResult = show();
    // The constructor cleared it; a file re-fills it, and Cancel clears again.
    chooseFile(FILE);
    fireEvent.click(radio('Symmetrical'));
    return waitFor(() => expect(g_PolyEdges).toHaveLength(2)).then(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onResult).toHaveBeenCalledWith(false);
      expect(g_PolyEdges).toHaveLength(0);
      expect(g_MwaveShape.type).toBe(MWAVE_POLY_SHAPE_TYPE.NORMAL);
    });
  });

  it('opening the dialog clears g_PolyEdges, as its constructor does', () => {
    g_PolyEdges.push({ x: 1, y: 1 }, { x: 2, y: 2 });
    show();
    expect(g_PolyEdges).toHaveLength(0);
  });

  it('reading a description file fills both size entries with (int) the scale, in the frame units', async () => {
    show();
    chooseFile(FILE);
    // XScale 10 mm, YScale 2 mm.
    await waitFor(() => expect(entry('X:').value).toBe('10'));
    expect(entry('Y:').value).toBe('2');
    expect(g_PolyEdges).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    expect(g_MwaveShape.scaleX).toBe(10000000);
    expect(g_MwaveShape.scaleY).toBe(2000000);
  });
});
