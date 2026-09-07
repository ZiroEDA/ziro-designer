// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_DISPLAY_ORIGIN` (`pcbnew/dialogs/panel_pcbnew_display_origin.cpp`
 * and its `_base.cpp`) — ONE class both pcbnew frames build, told apart by the
 * `FRAME_T` it is handed:
 *
 *     new PANEL_PCBNEW_DISPLAY_ORIGIN( aParent, cfg, FRAME_PCB_EDITOR )
 *     new PANEL_PCBNEW_DISPLAY_ORIGIN( aParent, cfg, FRAME_FOOTPRINT_EDITOR )
 *     (`pcbnew/pcbnew.cpp:421-423` and `:326-328`)
 *
 * and the constructor's only statement:
 *
 *     m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR );
 *
 * `m_displayOrigin` is the sizer holding the Display Origin heading, its rule
 * and all three radio buttons (`_base.cpp:22-46`). Page origin / Drill-place
 * file origin / Grid origin choose where the *coordinate readout* is measured
 * from, and a footprint has no page and no drill-place origin — so the group is
 * the board editor's alone and the footprint editor's page is X Axis and Y Axis
 * by themselves.
 *
 * Written once here for that reason, with the two pages as call sites: the two
 * frames read different settings objects, and that is the only difference
 * between them that is not this flag.
 *
 * Note which button each group's *first* is, because it decides what an unset
 * setting looks like: X defaults to Increases **right** and Y to Increases
 * **up**, and the loader picks the second only when the stored flag is set
 * (`panel_pcbnew_display_origin.cpp:44-77`). So `origin_invert_y_axis` false
 * means "Increases down" — the panel writes `m_DisplayInvertYAxis =
 * m_yIncreasesUp->GetValue()`, the button ABOVE the default one.
 */
import type { JSX } from 'react';
import { Group, Radio } from './widgets.js';

/**
 * `m_pageOrigin` / `m_drillPlaceOrigin` / `m_gridOrigin`
 * (`panel_pcbnew_display_origin_base.cpp:34-42`) against `PCB_DISPLAY_ORIGIN`
 * (`pcbnew/pcbnew_settings.h:95-100`).
 *
 * The loader is not a table lookup and its `else` matters: PAGE and GRID are
 * tested by name and **everything else** lands on Drill/place file origin
 * (`panel_pcbnew_display_origin.cpp:59-64`), so a file holding a value outside
 * the enum opens on the middle button rather than the first.
 */
export const DISPLAY_ORIGIN_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Page origin'],
  [1, 'Drill/place file origin'],
  [2, 'Grid origin'],
];

/** `m_xIncreasesRight` / `m_xIncreasesLeft`, in the base file's order. */
const X_AXIS_CHOICES = [
  [0, 'Increases right'],
  [1, 'Increases left'],
] as const;

/** `m_yIncreasesUp` / `m_yIncreasesDown`, in the base file's order. */
const Y_AXIS_CHOICES = [
  [1, 'Increases up'],
  [0, 'Increases down'],
] as const;

/** The three values this panel edits, whichever settings object holds them. */
export interface DisplayOriginValue {
  /** `PCB_DISPLAY_ORIGIN`. Absent for the footprint editor, which has no group. */
  origin_mode?: number;
  origin_invert_x_axis: boolean;
  origin_invert_y_axis: boolean;
}

export function PanelDisplayOrigin({
  value,
  onChange,
  /** The radio groups' `name`; two panels must not share one. */
  idPrefix,
  /** `m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR )`. */
  showDisplayOrigin,
}: {
  value: DisplayOriginValue;
  onChange: (patch: Partial<DisplayOriginValue>) => void;
  idPrefix: string;
  showDisplayOrigin?: boolean;
}): JSX.Element {
  return (
    <div>
      {showDisplayOrigin && (
        <Group title="Display Origin">
          {/* `wxGridSizer( 0, 1, 4, 0 )` — a 4 px vgap, `wxEXPAND|wxALL, 10`
              around the run. */}
          <Radio
            name={`${idPrefix}-display-origin`}
            value={value.origin_mode ?? 0}
            options={DISPLAY_ORIGIN_CHOICES.map((c) => [c[0], c[1]] as const)}
            onChange={(v) => onChange({ origin_mode: v })}
          />
        </Group>
      )}
      <Group title="X Axis">
        <Radio
          name={`${idPrefix}-x-axis`}
          value={value.origin_invert_x_axis ? 1 : 0}
          options={X_AXIS_CHOICES}
          onChange={(v) => onChange({ origin_invert_x_axis: v === 1 })}
        />
      </Group>
      <Group title="Y Axis">
        <Radio
          name={`${idPrefix}-y-axis`}
          value={value.origin_invert_y_axis ? 1 : 0}
          options={Y_AXIS_CHOICES}
          onChange={(v) => onChange({ origin_invert_y_axis: v === 1 })}
        />
      </Group>
    </div>
  );
}
