// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule Area Properties — `DIALOG_RULE_AREA_PROPERTIES` over its two notebook
 * panels.
 *
 * The decision logic is `pcbnew/src/rule_area_properties.ts` and is pinned by
 * `unittests/pcbnew/rule_area_properties.test.ts`; what this file asserts is
 * the wiring, which is where a dialog that "looks right" usually differs:
 * which page opens, which controls sit OUTSIDE the notebook, when a placement
 * combo is live, and what OK actually hands back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogRuleAreaProperties } from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_rule_area_properties.js';
import type { PlacementSources, RuleAreaValues } from '@ziroeda/pcbnew/src/rule_area_properties.js';

afterEach(cleanup);

/** pcbnew's internal units per millimetre. */
const IU = 1e6;

/** `createNewZone`'s seed: `ZONE_SETTINGS`'s own keepout defaults. */
const NEW_AREA: RuleAreaValues = {
  doNotAllowTracks: true,
  doNotAllowVias: true,
  doNotAllowPads: true,
  doNotAllowCopperPour: false,
  doNotAllowFootprints: false,
  placementEnabled: false,
  placementSourceType: 'sheetname',
  placementSource: '',
  name: '',
  locked: false,
  layers: ['F.Cu'],
  hatchStyle: 'edge',
  hatchPitch: 0.5 * IU,
};

const LAYERS = [
  { name: 'F.Cu', color: 'rgb(200, 52, 52)' },
  { name: 'B.Cu', color: 'rgb(77, 127, 196)' },
  { name: 'F.SilkS', color: 'rgb(242, 237, 161)' },
];

const SOURCES: PlacementSources = {
  sheetNames: ['/power/', '/mcu/'],
  componentClassNames: ['RF'],
  groupNames: ['guard'],
};

function open(
  over: Partial<RuleAreaValues> = {},
  onApply: (v: RuleAreaValues) => void = () => {},
): void {
  render(
    <DialogRuleAreaProperties
      units="mm"
      initial={{ ...NEW_AREA, ...over }}
      layers={LAYERS}
      sources={SOURCES}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
}

const cb = (label: string): HTMLInputElement =>
  screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;

/**
 * The placement page's own combos.
 *
 * Scoped to the page rather than to the document because the Outline display
 * combo is a `.ze-combo` too — and it is NOT on a page, which is the point of
 * the block above. A document-wide query counts four and quietly turns this
 * into a test of the wrong thing.
 */
const placementCombos = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.ze-rule-area-placement .ze-combo'));

describe('the two notebook pages', () => {
  it('opens on Keepouts for a new area', () => {
    // `m_areaPropertiesNb->SetSelection( 0 )` — a new area forbids tracks,
    // vias and pads, so `HasKeepoutParametersSet` is true.
    open();
    expect(screen.getByRole('button', { name: 'Keepouts' }).className).toContain('active');
    expect(screen.getByText('Keep out tracks')).toBeTruthy();
  });

  it('opens on Placement for an area that only places', () => {
    // "Placement only wins when the area forbids nothing at all."
    open({
      doNotAllowTracks: false,
      doNotAllowVias: false,
      doNotAllowPads: false,
      placementEnabled: true,
    });
    expect(screen.getByRole('button', { name: 'Placement' }).className).toContain('active');
    expect(screen.getByText('No placement')).toBeTruthy();
  });

  it('carries the five keepout checkboxes, defaulted from ZONE_SETTINGS', () => {
    open();
    expect(cb('Keep out tracks').checked).toBe(true);
    expect(cb('Keep out vias').checked).toBe(true);
    expect(cb('Keep out pads').checked).toBe(true);
    expect(cb('Keep out zone fills').checked).toBe(false);
    expect(cb('Keep out footprints').checked).toBe(false);
  });
});

describe('Outline display and hatch pitch are NOT on a page', () => {
  it('are visible while the Keepouts page is showing', () => {
    // `gbSizer1` is added to `bSizerRight`, below the notebook — they read
    // like page content and are not.
    open();
    expect(screen.getByText('Outline display:')).toBeTruthy();
    expect(screen.getByText('Outline hatch pitch:')).toBeTruthy();
  });

  it('and stay visible on the Placement page', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Placement' }));
    expect(screen.getByText('Outline display:')).toBeTruthy();
    expect(screen.getByText('Outline hatch pitch:')).toBeTruthy();
  });
});

describe('the placement page', () => {
  it('leaves every combo dead until its own radio is ticked', () => {
    open({
      doNotAllowTracks: false,
      doNotAllowVias: false,
      doNotAllowPads: false,
      placementEnabled: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Placement' }));

    const combos = placementCombos();
    expect(combos).toHaveLength(3);
    // The area opened on `sheetname`, so only that one is live.
    expect(combos.filter((c) => !c.disabled)).toHaveLength(1);
  });

  it('moves which combo is live when another radio is clicked', () => {
    open({
      doNotAllowTracks: false,
      doNotAllowVias: false,
      doNotAllowPads: false,
      placementEnabled: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Placement' }));
    fireEvent.click(screen.getByLabelText('Place items in group:', { selector: 'input' }));

    expect(placementCombos().map((c) => !c.disabled)).toEqual([false, false, true]);
  });
});

describe('TransferDataFromWindow', () => {
  it('refuses an area with no layers, and says so', () => {
    const onApply = vi.fn();
    open({}, onApply);
    // Untick the only layer.
    fireEvent.click(cb('F.Cu'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onApply).not.toHaveBeenCalled();
    // `DisplayError( this, _( "No layers selected." ) )` — the layer check
    // comes FIRST, before the hatch pitch.
    expect(screen.getByText('No layers selected.')).toBeTruthy();
  });

  it('refuses a hatch pitch outside ZONE_BORDER_HATCH_{MIN,MAX}DIST_MM', () => {
    const onApply = vi.fn();
    open({}, onApply);
    // 0.05 mm, below the 0.1 mm floor.
    fireEvent.change(screen.getByDisplayValue('0.5'), { target: { value: '0.05' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('hands back the keepout flags and the layers as edited', () => {
    const onApply = vi.fn();
    open({}, onApply);
    fireEvent.click(cb('Keep out zone fills'));
    fireEvent.click(cb('B.Cu'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const v = onApply.mock.calls[0]![0] as RuleAreaValues;
    expect(v.doNotAllowCopperPour).toBe(true);
    expect(v.layers).toEqual(['F.Cu', 'B.Cu']);
  });

  it('records the placement source type even when nothing is placed', () => {
    // "the source type and name are read back even when no radio is ticked",
    // so a disabled area still remembers where it would have pointed.
    const onApply = vi.fn();
    open({}, onApply);
    fireEvent.click(screen.getByRole('button', { name: 'Placement' }));
    fireEvent.click(screen.getByLabelText('Place items from sheet:', { selector: 'input' }));
    fireEvent.click(screen.getByLabelText('No placement', { selector: 'input' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    const v = onApply.mock.calls[0]![0] as RuleAreaValues;
    expect(v.placementEnabled).toBe(false);
    expect(v.placementSourceType).toBe('sheetname');
  });
});
