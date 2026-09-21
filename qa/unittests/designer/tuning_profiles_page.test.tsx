// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Tuning Profiles: PANEL_SETUP_TUNING_PROFILES's notebook and
 * PANEL_SETUP_TUNING_PROFILE_INFO's two grids, as the base files build them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type JSX, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PanelPcbTuningProfiles,
  validateTuningProfiles,
  delayProfileNames,
} from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_tuning_profiles.js';
import type { TuningProfilesData } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';

const LAYERS = [
  { id: 'F.Cu', name: 'F.Cu' },
  { id: 'In1.Cu', name: 'GND' },
  { id: 'In2.Cu', name: 'In2.Cu' },
  { id: 'B.Cu', name: 'B.Cu' },
];

const errors: string[] = [];

function Harness({
  initial,
  onState,
}: {
  initial: TuningProfilesData;
  onState?: (v: TuningProfilesData) => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const b = new BOARD();
  b.SetCopperLayerCount(4);
  return (
    <PanelPcbTuningProfiles
      value={v}
      onChange={(next) => {
        setV(next);
        onState?.(next);
      }}
      units="mm"
      layers={LAYERS}
      stackup={b.GetStackupOrDefault()}
      onError={(m) => errors.push(m)}
    />
  );
}

afterEach(() => {
  cleanup();
  errors.length = 0;
});

function oneProfile(): TuningProfilesData {
  return {
    profiles: [
      {
        name: 'DDR',
        type: 'Single',
        targetImpedance: 50,
        enableTimeDomain: true,
        viaPropDelay: 0,
        trackEntries: [],
        viaOverrides: [],
      },
    ],
  };
}

describe('the notebook', () => {
  it('starts empty, and + adds a page named "Profile " with the type Single', () => {
    let last: TuningProfilesData | undefined;
    render(<Harness initial={{ profiles: [] }} onState={(v) => (last = v)} />);
    expect(screen.queryByText('Track Propagation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add tuning profile' }));
    expect(last!.profiles).toHaveLength(1);
    expect(last!.profiles[0]).toMatchObject({
      name: 'Profile ',
      type: 'Single',
      enableTimeDomain: true,
    });
    expect(screen.getByText('Track Propagation')).toBeTruthy();
  });

  it('the trash button removes the current page', () => {
    let last: TuningProfilesData | undefined;
    render(<Harness initial={oneProfile()} onState={(v) => (last = v)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tuning profile' }));
    expect(last!.profiles).toEqual([]);
  });

  it('the tab shows the name as it is typed (UpdateProfileName)', () => {
    render(<Harness initial={oneProfile()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'DDR4' } });
    expect(screen.getByRole('button', { name: 'DDR4' })).toBeTruthy();
  });
});

describe('the profile page', () => {
  it('has the Name / Type / Target impedance row, the checkbox and the two grids', () => {
    render(<Harness initial={oneProfile()} />);
    expect(screen.getByText('Name:')).toBeTruthy();
    expect(screen.getByText('Type:')).toBeTruthy();
    expect(screen.getByText('Target impedance:')).toBeTruthy();
    expect(screen.getByText('ohms')).toBeTruthy();
    expect(screen.getByText('Enable time domain tuning')).toBeTruthy();
    for (const c of [
      'Signal Layer',
      'Top Reference',
      'Bottom Reference',
      'Track Width',
      'Unit Delay',
    ])
      expect(screen.getByText(c)).toBeTruthy();
    expect(screen.getByText('Via Propagation')).toBeTruthy();
    expect(screen.getByText('Global unit delay:')).toBeTruthy();
    expect(screen.getByText('ps/cm')).toBeTruthy();
    expect(screen.getByText('Via delay overrides:')).toBeTruthy();
    for (const c of [
      'Signal Layer From',
      'Signal Layer To',
      'Via Layer From',
      'Via Layer To',
      'Delay',
    ])
      expect(screen.getByText(c)).toBeTruthy();
  });

  it('hides Diff Pair Gap for Single and shows it for Differential', () => {
    render(<Harness initial={oneProfile()} />);
    expect(screen.queryByText('Diff Pair Gap')).toBeNull();
    const diff = oneProfile();
    diff.profiles[0]!.type = 'Differential';
    cleanup();
    render(<Harness initial={diff} />);
    expect(screen.getByText('Diff Pair Gap')).toBeTruthy();
  });

  it('OnAddTrackRow: the first row is F.Cu over In1.Cu, the next walks down the stack', () => {
    let last: TuningProfilesData | undefined;
    render(<Harness initial={oneProfile()} onState={(v) => (last = v)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add track propagation row' }));
    expect(last!.profiles[0]!.trackEntries[0]).toMatchObject({
      signalLayer: 'F.Cu',
      topReference: '',
      bottomReference: 'In1.Cu',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add track propagation row' }));
    expect(last!.profiles[0]!.trackEntries[1]).toMatchObject({
      signalLayer: 'In1.Cu',
      topReference: 'F.Cu',
      bottomReference: 'In2.Cu',
    });
    // The row shows the board's name for In1.Cu.
    expect(screen.getAllByText('GND').length).toBeGreaterThan(0);
  });

  it('OnAddViaOverride: first layer to last on both pairs; a selected row can be removed', () => {
    let last: TuningProfilesData | undefined;
    render(<Harness initial={oneProfile()} onState={(v) => (last = v)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add via delay override' }));
    expect(last!.profiles[0]!.viaOverrides[0]).toEqual({
      signalLayerFrom: 'F.Cu',
      signalLayerTo: 'B.Cu',
      viaLayerFrom: 'F.Cu',
      viaLayerTo: 'B.Cu',
      delay: 0,
    });
    // Nothing selected: the trash button does nothing.
    expect(
      (screen.getByRole('button', { name: 'Remove via delay override' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.mouseDown(screen.getByLabelText('Via delay 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove via delay override' }));
    expect(last!.profiles[0]!.viaOverrides).toEqual([]);
  });

  it('the calculator button fills width and delay; an impossible row reports the error', () => {
    let last: TuningProfilesData | undefined;
    render(<Harness initial={oneProfile()} onState={(v) => (last = v)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add track propagation row' }));
    fireEvent.click(screen.getByTitle('Calculate width'));
    const e = last!.profiles[0]!.trackEntries[0]!;
    expect(e.widthMM).toBeGreaterThan(0);
    expect(e.delay).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it("a differential row with no gap reports the calculator's error through onError", () => {
    const diff = oneProfile();
    diff.profiles[0]!.type = 'Differential';
    render(<Harness initial={diff} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add track propagation row' }));
    fireEvent.click(screen.getByTitle('Calculate width'));
    expect(errors).toEqual(['Error: Diff pair gap must be greater than 0 to calculate width']);
  });
});

describe('Validate and GetDelayProfileNames', () => {
  it('a blank name or a repeated signal layer vetoes OK on that page', () => {
    const d = oneProfile();
    d.profiles.push({ ...oneProfile().profiles[0]!, name: '' });
    expect(validateTuningProfiles(d)).toEqual({
      message: 'Tuning profile must have a name',
      page: 1,
    });
    d.profiles[1]!.name = 'X';
    d.profiles[0]!.trackEntries = [
      {
        signalLayer: 'F.Cu',
        topReference: '',
        bottomReference: '',
        widthMM: 0,
        diffPairGapMM: 0,
        delay: 0,
      },
      {
        signalLayer: 'F.Cu',
        topReference: '',
        bottomReference: '',
        widthMM: 0,
        diffPairGapMM: 0,
        delay: 0,
      },
    ];
    expect(validateTuningProfiles(d)).toEqual({
      message: 'Duplicated signal layer configuration in tuning profile',
      page: 0,
    });
    d.profiles[0]!.trackEntries.pop();
    expect(validateTuningProfiles(d)).toBeNull();
    expect(delayProfileNames(d)).toEqual(['DDR', 'X']);
  });
});
