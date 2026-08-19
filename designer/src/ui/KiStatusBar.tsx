// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KISTATUSBAR` (common/widgets/kistatusbar.cpp) and the eight local panes
 * `EDA_DRAW_FRAME` gives it (`updateStatusBarWidths`,
 * common/eda_draw_frame.cpp:792).
 *
 * KiCad builds this ONCE and every draw frame instantiates it, which is why
 * eeschema, pcbnew, the symbol and footprint editors, GerbView and pl_editor
 * all show the same fields in the same order at the same widths. It is written
 * once here for the same reason: a per-editor copy drifts, and the drift is
 * invisible until someone opens two editors side by side.
 *
 * Pane order and width, verbatim from `updateStatusBarWidths`:
 *
 *   0  message      -3  (stretch)   whatever the frame wants to say
 *   1  zoom             "Z 762000"  `GetZoomLevelIndicator`
 *   2  coords           "X 1234.1234  Y 1234.1234"
 *   3  deltas           "dx 1234.1234  dy 1234.1234  dist 1234.1234"
 *   4  grid             "grid 1234.1234 x 1234.1234"   `DisplayGridMsg`
 *   5  units            "Inches"                       `DisplayUnitsMsg`
 *   6  tool         -2  (stretch)   `DisplayToolMsg`
 *   7  constraint   -2  (stretch)   `DisplayConstraintsMsg`
 *
 * Each fixed pane is its template's width plus one 'M' of spacer, so a value
 * changing under the pointer can never shift its neighbours — see
 * {@link StatusField}.
 *
 * A frame that is not an `EDA_DRAW_FRAME` has its own field list
 * (`KICAD_MANAGER_FRAME` has two, `BM2CMP_FRAME` one); those pass `children`
 * instead of `fields` and get the same bar chrome with their own panes.
 *
 * ## Height is a property of the frame, not of this component
 *
 * There are exactly four `CreateStatusBar` call sites in KiCad and only two
 * override `OnCreateStatusBar`, so the app has two kinds of status bar and they
 * do not measure the same:
 *
 *  - `KISTATUSBAR` — every `EDA_DRAW_FRAME` (`eda_draw_frame.cpp:136`) and
 *    `KICAD_MANAGER_FRAME` (`kicad_manager_frame.cpp:176`). **23 px**, measured
 *    on the project manager.
 *  - a plain `wxStatusBar` — `BITMAP2CMP_FRAME` (`bitmap2cmp_frame.cpp:181`)
 *    and `EDA_3D_VIEWER_FRAME` (`eda_3d_viewer_frame.cpp:118`), which is a
 *    `KIWAY_PLAYER` rather than a draw frame. **33 px**, measured on
 *    bitmap2component.
 *
 * So the frame sets `--statusbar-height`; the default in `ui/shell.css`'s
 * `:root` is the `KISTATUSBAR` 23 px, and `.imgc-frame` overrides it to 33.
 * Both measurements, and the explanations already disproved, are recorded on
 * the token. A frame that has not been measured stays on the default.
 *
 * NOT YET MEASURED: our 3D viewer pane. Upstream it is the *other* kind of bar
 * — `EDA_3D_VIEWER_FRAME` takes the same plain `wxStatusBar` as
 * bitmap2component, so it is likely 33 px rather than the default 23 — but no
 * screenshot of a real 3D viewer was available to measure, so it is left on the
 * default rather than guessed at. Measure it before changing it.
 */

import type { JSX, ReactNode } from 'react';
import { STATUS_FIELD_TEMPLATES, StatusField } from './StatusField.js';

/** The eight `EDA_DRAW_FRAME` panes, in the order `updateStatusBarWidths` sets them. */
export const KISTATUSBAR_FIELDS = [
  'message',
  'zoom',
  'coords',
  'deltas',
  'grid',
  'units',
  'tool',
  'constraint',
] as const;

export type KiStatusBarField = (typeof KISTATUSBAR_FIELDS)[number];

/**
 * The eight panes' contents. Omitting one leaves it blank, which is what a
 * frame that never calls `SetStatusText` for that index shows.
 *
 * The names are the pane's *usual* meaning; the index is what is fixed. A
 * frame is free to write something else into a pane and upstream ones do —
 * `PL_EDITOR_FRAME::UpdateStatusBar` (pagelayout_editor/pl_editor_frame.cpp:805
 * / :776) puts "coord origin: …" in pane 5 and the units in pane 6, keeping
 * the base widths.
 */
export type KiStatusBarFields = Partial<Record<KiStatusBarField, ReactNode>>;

/** Which panes stretch, and by how much (`-3` / `-2` upstream). */
const STRETCH: Partial<Record<KiStatusBarField, string>> = {
  message: 'cell stretch3',
  tool: 'cell stretch2',
  constraint: 'cell stretch2',
};

/** Fixed panes and the widest-case string that sizes each. */
const TEMPLATE: Partial<Record<KiStatusBarField, string>> = {
  zoom: STATUS_FIELD_TEMPLATES.zoom,
  coords: STATUS_FIELD_TEMPLATES.coords,
  deltas: STATUS_FIELD_TEMPLATES.deltas,
  grid: STATUS_FIELD_TEMPLATES.grid,
  units: STATUS_FIELD_TEMPLATES.units,
};

export interface KiStatusBarProps {
  /** The eight `EDA_DRAW_FRAME` panes. Mutually exclusive with `children`. */
  fields?: KiStatusBarFields;
  /** Per-pane `data-testid`, for the frames whose tests address a pane. */
  testIds?: Partial<Record<KiStatusBarField, string>>;
  /** Panes for a frame that is not an `EDA_DRAW_FRAME`. */
  children?: ReactNode;
  testId?: string;
}

export function KiStatusBar({ fields, testIds, children, testId }: KiStatusBarProps): JSX.Element {
  return (
    <div className="ze-statusbar" data-testid={testId}>
      {fields
        ? KISTATUSBAR_FIELDS.map((name) => {
            const template = TEMPLATE[name];

            if (template !== undefined) {
              return (
                <StatusField key={name} template={template} testId={testIds?.[name]}>
                  {fields[name]}
                </StatusField>
              );
            }

            return (
              <span key={name} className={STRETCH[name]} data-testid={testIds?.[name]}>
                {fields[name]}
              </span>
            );
          })
        : children}
    </div>
  );
}
