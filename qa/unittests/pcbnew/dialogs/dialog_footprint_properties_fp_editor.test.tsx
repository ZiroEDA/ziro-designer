// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's Footprint Properties, 3D Models page: the same
 * PANEL_FP_PROPERTIES_3D_MODEL the board editor's dialog hosts
 * (dialog_footprint_properties_fp_editor.cpp:172-174).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import { FootprintPropertiesDialog } from '@ziroeda/pcbnew/dialogs/dialog_footprint_properties_fp_editor.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/types.js';

afterEach(cleanup);

const VIEW = { reference: 'R1', value: '10k', pads: [], models: [] } as unknown as PcbFootprint;

function open(withPage: boolean) {
  const kfp = new FOOTPRINT(null);
  const m = new FP_3DMODEL();
  m.m_Filename = '/ok/a.wrl';
  kfp.Models().push(m);
  const resolver = new FILENAME_RESOLVER();
  vi.spyOn(resolver, 'ResolvePath').mockImplementation((n) => n);
  const onOk = vi.fn();
  render(
    <FootprintPropertiesDialog
      footprint={VIEW}
      onOk={onOk}
      onCancel={() => {}}
      {...(withPage
        ? {
            model3d: {
              footprint: kfp,
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
  return { onOk, kfp };
}

const general = () => document.querySelector('.ze-modal-body') as HTMLElement;
const page = () => document.querySelector('.ze-fp3d-host') as HTMLElement;

describe('Footprint Editor Footprint Properties, 3D Models page', () => {
  it('has General and 3D Models tabs when the page is supplied, no tab bar otherwise', () => {
    open(false);
    expect(screen.queryByRole('button', { name: '3D Models' })).toBeNull();
    cleanup();
    open(true);
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '3D Models' })).toBeTruthy();
  });

  it('shows one page at a time', () => {
    open(true);
    expect(general().style.display).toBe('grid');
    expect(page().hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    expect(general().style.display).toBe('none');
    expect(page().hidden).toBe(false);
  });

  it("OK hands back the page's list with the four fields", () => {
    const { onOk } = open(true);
    fireEvent.click(screen.getByRole('button', { name: '3D Models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3D model' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const r = onOk.mock.calls[0]![0];
    expect(r.reference).toBe('R1');
    expect(r.models.map((m: FP_3DMODEL) => m.m_Filename)).toEqual(['/ok/a.wrl', '']);
  });

  it('without the page OK passes no list', () => {
    const { onOk } = open(false);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk.mock.calls[0]![0].models).toBeUndefined();
  });
});
