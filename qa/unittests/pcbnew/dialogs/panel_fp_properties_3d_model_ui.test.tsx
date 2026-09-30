// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** The controls of PANEL_FP_PROPERTIES_3D_MODEL (panel_fp_properties_3d_model_base.cpp). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import type { PANEL_3D_MODEL_HOST } from '@ziroeda/pcbnew/dialogs/panel_fp_properties_3d_model.js';
import {
  PanelFpProperties3dModel,
  type PANEL_3D_MODEL_API,
} from '@ziroeda/pcbnew/dialogs/panel_fp_properties_3d_model_ui.js';

afterEach(cleanup);

const model = (name: string): FP_3DMODEL => {
  const m = new FP_3DMODEL();
  m.m_Filename = name;
  return m;
};

let modified: number;
let host: PANEL_3D_MODEL_HOST;
let fp: FOOTPRINT;

beforeEach(() => {
  modified = 0;
  const resolver = new FILENAME_RESOLVER();
  vi.spyOn(resolver, 'ResolvePath').mockImplementation((n) => (n.startsWith('/ok') ? n : ''));
  host = {
    resolver: () => resolver,
    footprintBasePath: () => '',
    embeddedFilesStack: () => [],
    addEmbeddedFile: () => null,
    removeEmbeddedFile: () => {},
    isFileReadable: () => true,
    onModify: () => modified++,
  };
  fp = new FOOTPRINT(new BOARD());
  fp.Models().push(model('/ok/a.wrl'), model('/gone/b.wrl'));
});

const rowsOf = (): string[] =>
  Array.from(document.querySelectorAll('.ze-fp3d-grid tbody tr')).map(
    (r) => r.querySelector('td[data-col="1"]')?.textContent ?? '',
  );

function mount(pick = async () => null as null | { filename: string; embedded: boolean }) {
  const apiRef: { current: PANEL_3D_MODEL_API | null } = { current: null };
  const renderPreview = vi.fn(() => <div data-testid="preview" />);
  render(
    <PanelFpProperties3dModel
      footprint={fp}
      host={host}
      renderPreview={renderPreview}
      pickModel={pick}
      apiRef={apiRef}
    />,
  );
  return { apiRef, renderPreview };
}

describe('PanelFpProperties3dModel', () => {
  it('draws one grid row per model, with the column headers the base file states', () => {
    mount();
    expect(rowsOf()).toEqual(['/ok/a.wrl', '/gone/b.wrl']);
    expect(screen.getByText('3D Model(s)')).toBeTruthy();
    expect(screen.getByText('Show')).toBeTruthy();
  });

  it('a model that does not resolve shows the error icon with its reason as the tooltip', () => {
    mount();
    expect(document.querySelectorAll('.ze-fp3d-status')).toHaveLength(1);
    expect(document.querySelector('.ze-fp3d-status')?.getAttribute('title')).toBe('File not found');
  });

  it('hands the preview the models and the selected one', () => {
    const { renderPreview } = mount();
    const last = renderPreview.mock.calls.at(-1)!;
    expect(last[0]).toHaveLength(2);
    expect(last[1]).toBe(0);
    expect(screen.getByTestId('preview')).toBeTruthy();
  });

  it('Add appends an empty row with the warning and tells the dialog it was modified', () => {
    const { apiRef } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add 3D model' }));
    expect(rowsOf()).toHaveLength(3);
    expect(apiRef.current!.GetModelList()).toHaveLength(3);
    expect(modified).toBeGreaterThan(0);
  });

  it('Browse appends the chosen file, selected', async () => {
    const pick = vi.fn(async () => ({ filename: '/ok/c.wrl', embedded: false }));
    const { apiRef, renderPreview } = mount(pick);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Browse for 3D model' })),
    );
    expect(rowsOf().at(-1)).toBe('/ok/c.wrl');
    expect(apiRef.current!.GetModelList().at(-1)!.m_Filename).toBe('/ok/c.wrl');
    expect(renderPreview.mock.calls.at(-1)![1]).toBe(2);
  });

  it('Browse cancelled adds nothing', async () => {
    mount();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Browse for 3D model' })),
    );
    expect(rowsOf()).toHaveLength(2);
  });

  it('Remove deletes the cursor row; with no models the button is disabled', () => {
    const { apiRef } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove 3D model' }));
    expect(apiRef.current!.GetModelList().map((m) => m.m_Filename)).toEqual(['/gone/b.wrl']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 3D model' }));
    expect(rowsOf()).toEqual([]);
    expect(
      (screen.getByRole('button', { name: 'Remove 3D model' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('draws no Configure Paths button: a browser has no paths to configure', () => {
    mount();
    expect(screen.queryByText('Configure Paths...')).toBeNull();
  });
});
