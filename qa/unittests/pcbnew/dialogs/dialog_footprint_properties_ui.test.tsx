// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** The 3D Models page of Footprint Properties (dialog_footprint_properties.cpp:73-75). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import { DialogFootprintProperties } from '@ziroeda/pcbnew/dialogs/dialog_footprint_properties_ui.js';
import type { FootprintValues } from '@ziroeda/pcbnew/dialogs/dialog_footprint_properties.js';

afterEach(cleanup);

function open(withPage: boolean) {
  const fp = new FOOTPRINT(new BOARD());
  const m = new FP_3DMODEL();
  m.m_Filename = '/ok/a.wrl';
  fp.Models().push(m);
  const onApply = vi.fn();
  const resolver = new FILENAME_RESOLVER();
  vi.spyOn(resolver, 'ResolvePath').mockImplementation((n) => n);
  const initial = { reference: 'R1', value: '10k' } as FootprintValues;
  render(
    <DialogFootprintProperties
      units="mm"
      initial={initial}
      libId="Lib:R"
      onApply={onApply}
      onClose={() => {}}
      {...(withPage
        ? {
            model3d: {
              footprint: fp,
              host: {
                resolver: () => resolver,
                footprintBasePath: () => '',
                embeddedFilesStack: () => [],
                addEmbeddedFile: () => null,
                removeEmbeddedFile: () => {},
                isFileReadable: () => true,
                onModify: () => {},
              },
              renderPreview: () => <div data-testid="preview" />,
              pickModel: async () => null,
            },
          }
        : {})}
    />,
  );
  return { onApply };
}

describe('Footprint Properties, 3D Models page', () => {
  it('is the third tab when the page is supplied, and absent otherwise', () => {
    open(false);
    expect(screen.queryByRole('button', { name: '3D Models' })).toBeNull();
    cleanup();
    open(true);
    expect(screen.getByRole('button', { name: '3D Models' })).toBeTruthy();
  });

  it('is only shown on its own tab', () => {
    open(true);
    const host = () => document.querySelector('.ze-fp3d-host') as HTMLElement;
    expect(host().hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    expect(host().hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(host().hidden).toBe(true);
  });

  it('keeps its list when you leave the page and come back', () => {
    open(true);
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3D model' }));
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    expect(document.querySelectorAll('.ze-fp3d-grid tbody tr')).toHaveLength(2);
  });

  it("OK hands the page's list to onApply", () => {
    const { onApply } = open(true);
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3D model' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const v = onApply.mock.calls[0]![0] as FootprintValues;
    expect(v.models).toHaveLength(2);
    expect(v.models![0]!.m_Filename).toBe('/ok/a.wrl');
  });

  it('without the page OK passes no list, so the footprint keeps its models', () => {
    const { onApply } = open(false);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect((onApply.mock.calls[0]![0] as FootprintValues).models).toBeUndefined();
  });
});
