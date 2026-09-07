// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two dialogs behind the router size menus' "Use Custom Values..." rows:
 * `DIALOG_TRACK_VIA_SIZE` and `DIALOG_PNS_DIFF_PAIR_DIMENSIONS`
 * (`pcbnew/dialogs/`).
 *
 * They look like the same dialog and are not, in four ways that all come from
 * upstream and that these cases exist to keep apart:
 *
 *   - the Track/Via one writes `BOARD_DESIGN_SETTINGS`' stored custom values;
 *     the diff-pair one writes the LIVE route's `PNS::SIZES_SETTINGS`;
 *   - the Track/Via one floors every field at `0.01 mm` (its `UNIT_BINDER`'s
 *     `minSize`); the diff-pair one floors nothing;
 *   - the Track/Via one refuses with `PCB_VIA::ValidateViaParameters` — the
 *     same function Board Setup > Pre-defined Sizes uses, so the two refuse
 *     the same values in the same words; the diff-pair one refuses only a gap
 *     of zero, and accepts a width of zero;
 *   - the diff-pair one's checkbox GREYS the via-gap row and starts TICKED.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DialogTrackViaSize,
  type CustomTrackViaSize,
} from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_track_via_size.js';
import {
  DialogPnsDiffPairDimensions,
  type DiffPairDimensionsValue,
} from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_pns_diff_pair_dimensions.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

afterEach(cleanup);

const MM = (n: number): number => mmToIU(n);
const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const type = (id: string, value: string): void => {
  fireEvent.change(field(id), { target: { value } });
};
const ok = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
};

// ---------------------------------------------------------------------------

function openTrackVia(
  value: CustomTrackViaSize = {
    trackWidth: MM(0.25),
    via: { diameter: MM(0.8), drill: MM(0.4) },
  },
): { out: () => CustomTrackViaSize | null } {
  let out: CustomTrackViaSize | null = null;
  render(
    <DialogTrackViaSize
      value={value}
      units="mm"
      onOk={(next) => {
        out = next;
      }}
      onClose={() => {}}
    />,
  );
  return { out: () => out };
}

describe('DIALOG_TRACK_VIA_SIZE', () => {
  it('loads the stored custom values into its three fields', () => {
    openTrackVia();

    expect(field('ze-ctv-track').value).toBe('0.25');
    expect(field('ze-ctv-diameter').value).toBe('0.8');
    expect(field('ze-ctv-drill').value).toBe('0.4');
  });

  it('stores all three on OK', () => {
    const { out } = openTrackVia();

    type('ze-ctv-track', '0.3');
    type('ze-ctv-diameter', '1');
    type('ze-ctv-drill', '0.5');
    ok();

    expect(out()).toEqual({ trackWidth: MM(0.3), via: { diameter: MM(1), drill: MM(0.5) } });
  });

  it('floors every field at the binder’s minSize', () => {
    // [data] `const int minSize = (int)( 0.01 * pcbIUScale.IU_PER_MM )`. It is
    // the UNIT_BINDER's lower bound, so a smaller number is raised rather than
    // refused.
    const { out } = openTrackVia();

    type('ze-ctv-track', '0.001');
    ok();

    expect(out()!.trackWidth).toBe(MM(0.01));
  });

  it('refuses a hole that is not smaller than the diameter, and says so', () => {
    const { out } = openTrackVia();

    type('ze-ctv-diameter', '0.4');
    type('ze-ctv-drill', '0.4');
    ok();

    expect(out()).toBeNull();
    // The wording is `PCB_VIA::ValidateViaParameters`', shared with the
    // Pre-defined Sizes grid.
    expect(screen.getByText(/Via hole size must be smaller than via diameter/)).toBeTruthy();
  });

  it('puts the caret in the field the error names', () => {
    // `if( error->m_Field == …::DRILL ) m_viaDrillText->SetFocus();`
    openTrackVia();

    type('ze-ctv-diameter', '0.4');
    type('ze-ctv-drill', '0.4');
    ok();

    expect(document.activeElement).toBe(field('ze-ctv-drill'));
  });

  it('reads the frame’s units', () => {
    let out: CustomTrackViaSize | null = null;
    render(
      <DialogTrackViaSize
        value={{ trackWidth: MM(0.508), via: { diameter: MM(0.8), drill: MM(0.4) } }}
        units="mils"
        onOk={(next) => {
          out = next;
        }}
        onClose={() => {}}
      />,
    );

    expect(field('ze-ctv-track').value).toBe('20');
    type('ze-ctv-track', '20');
    ok();
    expect(out!.trackWidth).toBe(MM(0.508));
  });
});

// ---------------------------------------------------------------------------

function openDiffPair(
  value: DiffPairDimensionsValue = {
    width: MM(0.2),
    gap: MM(0.25),
    viaGap: MM(0.5),
    viaGapSameAsTraceGap: true,
  },
): { out: () => DiffPairDimensionsValue | null } {
  let out: DiffPairDimensionsValue | null = null;
  render(
    <DialogPnsDiffPairDimensions
      value={value}
      units="mm"
      onOk={(next) => {
        out = next;
      }}
      onClose={() => {}}
    />,
  );
  return { out: () => out };
}

describe('DIALOG_PNS_DIFF_PAIR_DIMENSIONS', () => {
  it('loads all three dimensions and the checkbox', () => {
    openDiffPair();

    expect(field('ze-dpd-width').value).toBe('0.2');
    expect(field('ze-dpd-gap').value).toBe('0.25');
    expect(field('ze-dpd-via-gap').value).toBe('0.5');
  });

  it('greys the via gap while it follows the track gap, rather than hiding it', () => {
    // `updateCheckbox()` calls `Enable( false )` on the field, its label and
    // its unit — the value stays readable while it is not being used.
    openDiffPair();

    expect(field('ze-dpd-via-gap').disabled).toBe(true);
    expect(field('ze-dpd-via-gap').value).toBe('0.5');
  });

  it('enables the via gap when the box is unticked', () => {
    openDiffPair();

    fireEvent.click(screen.getByLabelText('Via gap same as track gap'));

    expect(field('ze-dpd-via-gap').disabled).toBe(false);
  });

  it('stores the three dimensions and the flag', () => {
    const { out } = openDiffPair();

    fireEvent.click(screen.getByLabelText('Via gap same as track gap'));
    type('ze-dpd-width', '0.15');
    type('ze-dpd-gap', '0.2');
    type('ze-dpd-via-gap', '0.4');
    ok();

    expect(out()).toEqual({
      width: MM(0.15),
      gap: MM(0.2),
      viaGap: MM(0.4),
      viaGapSameAsTraceGap: false,
    });
  });

  it('refuses a gap of zero with its own message', () => {
    const { out } = openDiffPair();

    type('ze-dpd-gap', '0');
    ok();

    expect(out()).toBeNull();
    expect(screen.getByText('Track gap must be greater than 0.')).toBeTruthy();
    expect(document.activeElement).toBe(field('ze-dpd-gap'));
  });

  it('accepts a WIDTH of zero, which it does not check at all', () => {
    // `TransferDataFromWindow` tests only `m_traceGap.GetValue() <= 0`. The
    // width is stored as typed, and the placer is what deals with it.
    const { out } = openDiffPair();

    type('ze-dpd-width', '0');
    ok();

    expect(out()!.width).toBe(0);
  });

  it('floors nothing, unlike its Track/Via sibling', () => {
    // No `minSize` on any of its three binders.
    const { out } = openDiffPair();

    type('ze-dpd-width', '0.001');
    ok();

    expect(out()!.width).toBe(MM(0.001));
  });
});
