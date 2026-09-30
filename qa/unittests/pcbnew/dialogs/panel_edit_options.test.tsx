// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_EDIT_OPTIONS (panel_edit_options.cpp): what its controls write into
 * the settings slice. `TransferDataFromWindow` maps the H/V/45 checkbox to
 * `LEADER_MODE::DEG45` / `DIRECT` (`:189-190` PCB, `:174-175` footprint editor),
 * and the footprint editor's Magnetic pads checkbox to `CAPTURE_ALWAYS` / `NO_EFFECT`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PanelFpEditingOptions,
  PanelPcbEditingOptions,
  type PANEL_EDIT_OPTIONS_FP_SLICE,
  type PANEL_EDIT_OPTIONS_PCB_SLICE,
} from '@ziroeda/pcbnew/dialogs/panel_edit_options.js';
import { LeaderMode } from '@ziroeda/kimath/src/geometry/geometry_utils.js';

afterEach(cleanup);

const pcbSlice = (): PANEL_EDIT_OPTIONS_PCB_SLICE => ({
  editing: {
    pcb_angle_snap_mode: LeaderMode.DIRECT,
    rotation_angle: 900,
    arc_edit_mode: 0,
    track_drag_action: 0,
    flip_left_right: false,
    allow_free_pads: false,
    ctrl_click_highlight: false,
    magnetic_pads: 1,
    magnetic_tracks: 1,
    magnetic_graphics: true,
    esc_clears_net_highlight: true,
    show_courtyard_collisions: true,
    auto_fill_zones: true,
  },
  pcb_display: {
    ratsnest_footprint: false,
    ratsnest_curved: false,
    ratsnest_thickness: 0.5,
    show_page_borders: true,
  },
});

/** A working copy whose `upP` mutates a live object, as the dialog's shell does. */
function mountPcb(): PANEL_EDIT_OPTIONS_PCB_SLICE {
  const state = pcbSlice();
  const view = (): JSX.Element => (
    <PanelPcbEditingOptions
      ctx={{
        pcbnew: state,
        upP: (fn) => {
          fn(state);
          rerender(view());
        },
      }}
    />
  );
  const { rerender } = render(view());
  return state;
}

describe('PANEL_EDIT_OPTIONS, PCB Editor', () => {
  it('Constrain actions to H, V, 45 degrees writes DEG45, and DIRECT when cleared', () => {
    const state = mountPcb();
    const box = (): HTMLInputElement =>
      screen.getByLabelText('Constrain actions to H, V, 45 degrees') as HTMLInputElement;

    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(state.editing.pcb_angle_snap_mode).toBe(LeaderMode.DEG45);
    fireEvent.click(box());
    expect(state.editing.pcb_angle_snap_mode).toBe(LeaderMode.DIRECT);
  });

  it('shows DEG90 as checked: only DIRECT clears the box (m_AngleSnapMode != DIRECT)', () => {
    const state = pcbSlice();
    state.editing.pcb_angle_snap_mode = LeaderMode.DEG90;
    render(<PanelPcbEditingOptions ctx={{ pcbnew: state, upP: () => {} }} />);
    expect(
      (screen.getByLabelText('Constrain actions to H, V, 45 degrees') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('the rotate step is held in TENTHS of a degree, and 0 is refused', () => {
    const state = mountPcb();
    const holder = screen.getByTitle(
      'Set increment (in degrees) for context menu and hotkey rotation.',
    );
    const step = (
      holder instanceof HTMLInputElement ? holder : holder.querySelector('input')
    ) as HTMLInputElement;

    expect(step.value).toBe('90');
    fireEvent.change(step, { target: { value: '15' } });
    expect(state.editing.rotation_angle).toBe(150);
    fireEvent.change(step, { target: { value: '0' } });
    expect(state.editing.rotation_angle).toBe(150);
  });

  it('the ratsnest and page-limit checkboxes write pcb_display, not editing', () => {
    const state = mountPcb();
    fireEvent.click(screen.getByLabelText('Always show selected ratsnest'));
    expect(state.pcb_display.ratsnest_footprint).toBe(true);
    fireEvent.click(screen.getByLabelText('Show page limits'));
    expect(state.pcb_display.show_page_borders).toBe(false);
    expect(state.editing.esc_clears_net_highlight).toBe(true);
  });
});

describe('PANEL_EDIT_OPTIONS, Footprint Editor', () => {
  it('Magnetic pads is CAPTURE_ALWAYS (2) when checked and NO_EFFECT (0) when clear', () => {
    const state: PANEL_EDIT_OPTIONS_FP_SLICE = {
      editing: {
        fp_angle_snap_mode: LeaderMode.DIRECT,
        rotation_angle: 900,
        magnetic_pads: 0,
        magnetic_graphics: false,
      },
    };
    const view = (): JSX.Element => (
      <PanelFpEditingOptions
        ctx={{
          fpEdit: state,
          upFp: (fn) => {
            fn(state);
            rerender(view());
          },
        }}
      />
    );
    const { rerender } = render(view());
    const pads = (): HTMLInputElement => screen.getByLabelText('Magnetic pads') as HTMLInputElement;

    fireEvent.click(pads());
    expect(state.editing.magnetic_pads).toBe(2);
    fireEvent.click(pads());
    expect(state.editing.magnetic_pads).toBe(0);

    fireEvent.click(screen.getByLabelText('Constrain actions to H, V, 45 degrees'));
    expect(state.editing.fp_angle_snap_mode).toBe(LeaderMode.DEG45);
  });
});
