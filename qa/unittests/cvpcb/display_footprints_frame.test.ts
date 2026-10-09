// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DISPLAY_FOOTPRINTS_FRAME` (cvpcb/display_footprints_frame.cpp): the frame
 * View Selected Footprint opens — its FPHOLDER board, its tools, and what
 * `InitDisplay` shows, titles, reports and writes in status pane 0.
 */
import { describe, expect, it } from 'vitest';
import { DISPLAY_FOOTPRINTS_FRAME } from '@ziroeda/cvpcb/display_footprints_frame.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { PCB_VIEWER_TOOLS } from '@ziroeda/pcbnew/tools/pcb_viewer_tools.js';
import { MAGNETIC_OPTIONS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { CVPCB_SETTINGS } from '@ziroeda/cvpcb/cvpcb_settings.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';

/** DISPLAY_FOOTPRINTS_FRAME on a one-library adapter, recording its title, infobar and pane 0. */
function displayFrame(): {
  frame: DISPLAY_FOOTPRINTS_FRAME;
  title: string[];
  infobar: string[];
  pane0: string[];
} {
  const title: string[] = [];
  const infobar: string[] = [];
  const pane0: string[] = [];
  const frame = new DISPLAY_FOOTPRINTS_FRAME({
    setTitle: (t) => title.push(t),
    showInfoBar: (m) => infobar.push(m),
  });
  frame.SetStatusTextSink((aText, aField) => {
    if (aField === 0) pane0.push(aText);
  });
  const store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: () => Promise.reject(new Error('none')),
    flipLeftRight: () => false,
  });
  store.AddProjectLibrary('Capacitor_THT', 'Capacitor_THT.pretty', [
    {
      fileName: 'C_Radial_D8.0mm.kicad_mod',
      text: `(footprint "C_Radial_D8.0mm" (layer "F.Cu") (at 3 4)
        (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu")))`,
    },
  ]);
  frame.SetFootprintLibAdapter(store);
  return { frame, title, infobar, pane0 };
}

describe('InitDisplay', () => {
  it('titles itself Footprint: <fpid>, writes pane 0 as Lib: <nickname>, shows it at the origin', async () => {
    // SetTitle( wxString::Format( _( "Footprint: %s" ), footprintName ) )
    //                                     display_footprints_frame.cpp:365
    const { frame, title, pane0 } = displayFrame();
    await frame.InitDisplay({
      footprintName: 'Capacitor_THT:C_Radial_D8.0mm',
      libNickname: 'Capacitor_THT',
    });
    expect(title.at(-1)).toBe('Footprint: Capacitor_THT:C_Radial_D8.0mm');
    expect(pane0.at(-1)).toBe('Lib: Capacitor_THT');
    const fp = frame.GetBoard()!.GetFirstFootprint()!;
    expect(fp.GetFPID().Format()).toBe('Capacitor_THT:C_Radial_D8.0mm');
    expect(fp.GetPosition()).toEqual({ x: 0, y: 0 });
  });

  it('keeps its title and leaves pane 0 EMPTY when the selection is cleared', async () => {
    //     if( fpInfo ) SetStatusText( Format( _( "Lib: %s" ), … ), 0 );
    //     else         SetStatusText( wxEmptyString, 0 );
    //                                     display_footprints_frame.cpp:392-395
    const { frame, title, pane0 } = displayFrame();
    await frame.InitDisplay({
      footprintName: 'Capacitor_THT:C_Radial_D8.0mm',
      libNickname: 'Capacitor_THT',
    });
    // The selection cleared: `m_currentFootprint` differs, so the board empties,
    // and SetTitle is only inside `if( !footprintName.IsEmpty() )`.
    await frame.InitDisplay({ footprintName: '', libNickname: null });
    expect(title).toHaveLength(1);
    expect(pane0.at(-1)).toBe('');
    expect(frame.GetBoard()!.Footprints()).toEqual([]);
  });

  it('reports what GetFootprint could not find on the infobar', async () => {
    const { frame, infobar } = displayFrame();
    await frame.InitDisplay({ footprintName: 'Nope:X', libNickname: null });
    expect(infobar.at(-1)).toBe("Library 'Nope' is not in the footprint library table.");
    await frame.InitDisplay({ footprintName: 'Capacitor_THT:X', libNickname: null });
    expect(infobar.at(-1)).toBe("Footprint 'Capacitor_THT:X' not found.");
    expect(frame.GetBoard()!.Footprints()).toEqual([]);
  });

  it('does nothing when asked for the footprint already shown', async () => {
    const { frame, title } = displayFrame();
    const parent = { footprintName: 'Capacitor_THT:C_Radial_D8.0mm', libNickname: 'Capacitor_THT' };
    await frame.InitDisplay(parent);
    const shown = frame.GetBoard()!.GetFirstFootprint();
    await frame.InitDisplay(parent);
    expect(frame.GetBoard()!.GetFirstFootprint()).toBe(shown);
    expect(title).toHaveLength(1);
  });

  it('is a footprint frame to PCB_VIEWER_TOOLS, as SetFootprintFrame( true ) makes it', () => {
    const { frame } = displayFrame();
    expect(frame.GetToolManager()!.GetTool(PCB_VIEWER_TOOLS)!.IsFootprintFrame()).toBe(true);
    expect(frame.GetBoard()!.GetBoardUse()).toBe(BOARD_USE.FPHOLDER);
    expect(frame.GetBoard()!.GetDesignSettings().m_SolderMaskExpansion).toBe(0);
  });

  it('reads its window, viewer and magnetic settings from cvpcb.json', () => {
    const { frame } = displayFrame();
    const cfg = frame.config();
    expect(cfg).toBeInstanceOf(CVPCB_SETTINGS);
    // GetWindowSettings: `&cfg->m_FootprintViewer`, `footprint_viewer.*`.
    expect(frame.GetWindowSettings(cfg)).toBe(cfg.m_FootprintViewer);
    expect(frame.GetViewerSettingsBase()).toBe(cfg);
    // "We always snap and don't let the user configure it."
    expect(frame.GetMagneticItemsSettings()).toBe(cfg.m_FootprintViewerMagneticSettings);
    expect(cfg.m_FootprintViewerMagneticSettings.pads).toBe(MAGNETIC_OPTIONS.CAPTURE_ALWAYS);
    expect(cfg.m_FootprintViewerMagneticSettings.tracks).toBe(MAGNETIC_OPTIONS.CAPTURE_ALWAYS);
    expect(cfg.m_FootprintViewerMagneticSettings.graphics).toBe(true);
    expect(cfg.m_ViewersDisplay.m_AngleSnapMode).toBe(LEADER_MODE.DEG45);
    expect(cfg.m_FootprintViewer.grid.grids.length).toBeGreaterThan(0);
  });

  it('the message panel is the shown footprint’s, and empty with none', async () => {
    const { frame } = displayFrame();
    const panels: number[] = [];
    frame.SetMsgPanelSink((aItems) => panels.push(aItems.length));
    await frame.InitDisplay({
      footprintName: 'Capacitor_THT:C_Radial_D8.0mm',
      libNickname: 'Capacitor_THT',
    });
    expect(panels.at(-1)).toBeGreaterThan(0);
    await frame.InitDisplay({ footprintName: '', libNickname: null });
    expect(panels.at(-1)).toBe(0);
  });
});
