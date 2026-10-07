// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Library Browser's window, driven as a user would: the frame
 * registers as FRAME_FOOTPRINT_VIEWER's KIWAY player, the lists fill and
 * select as ReCreateLibraryList / ReCreateFootprintList do, a pick reaches
 * the canvas, the filters narrow the lists, and a double click inserts into
 * the board editor.
 *
 * The GAL canvas cannot be built here (no WebGL), so the draw panel host
 * answers no panel; what is under test is which footprint the frame puts on
 * its FPHOLDER board, which is what the canvas would draw.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { FootprintIndexLibrary } from '@ziroeda/pcbnew/footprint_info_impl.js';
import type { FOOTPRINT_VIEWER_JSON_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';

vi.mock('@ziroeda/pcbnew/pcb_draw_panel_gal_host.js', () => ({ usePcbDrawPanel: () => null }));

/** A real, minimal footprint file: the message panel reads its pads. */
const MOD = (
  aName: string,
): string => `(footprint "${aName}" (version 20241229) (generator "pcbnew") (layer "F.Cu")
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")))`;
const { FootprintViewerFrame } = await import('@ziroeda/pcbnew/footprint_viewer_frame_ui.js');
const { FOOTPRINT_VIEWER_FRAME } = await import('@ziroeda/pcbnew/footprint_viewer_frame.js');

afterEach(cleanup);

const INDEX: FootprintIndexLibrary[] = [
  {
    name: 'Capacitor_SMD',
    footprints: ['C_0402_1005Metric', 'C_0603_1610Metric'],
    pads: [2, 2],
    descr: ['Capacitor SMD 0402', 'Capacitor SMD 0603'],
    tags: ['capacitor', 'capacitor'],
  },
  {
    name: 'Resistor_SMD',
    footprints: ['R_0402_1005Metric', 'R_Array_Convex_4x0402'],
    pads: [2, 8],
    descr: ['Resistor SMD 0402', 'Chip Resistor Network'],
    tags: ['resistor', 'resistor array'],
  },
];

function makeApp() {
  const loaded: string[] = [];
  const cfg: FOOTPRINT_VIEWER_JSON_SETTINGS = {
    zoom: 1,
    autozoom: true,
    lib_list_width: 200,
    fp_list_width: 300,
    grid: { last_size_idx: 15 },
    cursor: { crosshair: 'small' },
  };
  const app = {
    loadFootprintIndex: () => Promise.resolve(INDEX),
    libraryIo: {
      footprintText: (aLib: string, aName: string) => {
        loaded.push(`${aLib}:${aName}`);
        return Promise.resolve(MOD(aName));
      },
      flipLeftRight: () => false,
    },
    installPgm: () => {},
    commonSettingsOf: () => ({}) as COMMON_SETTINGS_LIKE,
    libraryUri: (n: string) => `/libs/${n}.pretty`,
    pinnedFootprintLibs: () => [],
    footprintViewerSettings: () => cfg,
    updateFootprintViewerSettings: (m: (s: FOOTPRINT_VIEWER_JSON_SETTINGS) => void) => m(cfg),
    padNumbers: () => true,
    setPadNumbers: () => {},
    galGridOptions: () => ({ style: 'dots' as const, lineWidthPx: 1, minSpacingPx: 10 }),
    HomeLink: () => null,
    LibraryLoadingPanel: () => null,
    Viewer3DFrame: () => null,
  };
  return { app, loaded };
}

function makeKiway(raised: FRAME_T[] = []): KIWAY {
  return new KIWAY({
    OnKiCadExit: () => {},
    Player: (t) => {
      raised.push(t);
      return true;
    },
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
}

const rows = (testId: string): string[] =>
  Array.from(screen.getByTestId(testId).querySelectorAll('[role="option"]')).map(
    (r) => r.textContent ?? '',
  );
const selected = (testId: string): string =>
  screen.getByTestId(testId).querySelector('[aria-selected="true"]')?.textContent ?? '';

/** What the frame's board holds: the footprint the canvas would draw. */
const shownOn = (aKiway: KIWAY): string => {
  const frame = aKiway.GetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER) as InstanceType<
    typeof FOOTPRINT_VIEWER_FRAME
  > | null;
  return frame?.GetBoard()?.GetFirstFootprint()?.GetFPID().Format() ?? 'none';
};

describe('FootprintViewerFrame', () => {
  it('registers as FRAME_FOOTPRINT_VIEWER and says goodbye on close', async () => {
    const kiway = makeKiway();
    const { app } = makeApp();
    const view = render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(rows('fpviewer-lib-list').length).toBe(2));
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER)).toBeInstanceOf(
      FOOTPRINT_VIEWER_FRAME,
    );
    view.unmount();
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER)).toBeNull();
  });

  it('selects the first library and its first footprint, and shows it', async () => {
    const kiway = makeKiway();
    const { app, loaded } = makeApp();
    render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(shownOn(kiway)).toBe('Capacitor_SMD:C_0402_1005Metric'));
    expect(selected('fpviewer-lib-list')).toBe('Capacitor_SMD');
    expect(rows('fpviewer-fp-list')).toEqual(['C_0402_1005Metric', 'C_0603_1610Metric']);
    expect(selected('fpviewer-fp-list')).toBe('C_0402_1005Metric');
    expect(loaded).toContain('Capacitor_SMD:C_0402_1005Metric');
  });

  it('a click on another footprint puts that one on the canvas', async () => {
    const kiway = makeKiway();
    const { app } = makeApp();
    render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(rows('fpviewer-fp-list').length).toBe(2));
    const row = screen.getByText('C_0603_1610Metric');
    fireEvent.mouseDown(row);
    await waitFor(() => expect(shownOn(kiway)).toBe('Capacitor_SMD:C_0603_1610Metric'));
    expect(selected('fpviewer-fp-list')).toBe('C_0603_1610Metric');
  });

  it('a click on another library lists its footprints and shows the first', async () => {
    const kiway = makeKiway();
    const { app } = makeApp();
    render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(rows('fpviewer-lib-list').length).toBe(2));
    fireEvent.mouseDown(screen.getByText('Resistor_SMD'));
    await waitFor(() =>
      expect(rows('fpviewer-fp-list')).toEqual(['R_0402_1005Metric', 'R_Array_Convex_4x0402']),
    );
    await waitFor(() => expect(shownOn(kiway)).toBe('Resistor_SMD:R_0402_1005Metric'));
  });

  it('the two filters narrow their lists with KiCad semantics', async () => {
    const kiway = makeKiway();
    const { app } = makeApp();
    render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(rows('fpviewer-lib-list').length).toBe(2));
    fireEvent.change(screen.getByTestId('fpviewer-lib-filter'), { target: { value: 'res' } });
    await waitFor(() => expect(rows('fpviewer-lib-list')).toEqual(['Resistor_SMD']));
    // The only library left is selected and its list rebuilt.
    await waitFor(() => expect(rows('fpviewer-fp-list').length).toBe(2));
    // Every term must match; "8" matches the network's pad count.
    fireEvent.change(screen.getByTestId('fpviewer-fp-filter'), { target: { value: '8' } });
    await waitFor(() => expect(rows('fpviewer-fp-list')).toEqual(['R_Array_Convex_4x0402']));
    await waitFor(() => expect(shownOn(kiway)).toBe('Resistor_SMD:R_Array_Convex_4x0402'));
  });

  it('a double click on the footprint list runs AddFootprintToPCB', async () => {
    const kiway = makeKiway();
    const add = vi
      .spyOn(FOOTPRINT_VIEWER_FRAME.prototype, 'AddFootprintToPCB')
      .mockReturnValue(true);
    const { app } = makeApp();
    render(<FootprintViewerFrame app={app} kiway={kiway} onClose={() => {}} />);
    await waitFor(() => expect(shownOn(kiway)).toBe('Capacitor_SMD:C_0402_1005Metric'));
    await act(async () => {
      fireEvent.doubleClick(screen.getByTestId('fpviewer-fp-list'));
    });
    expect(add).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });
});
