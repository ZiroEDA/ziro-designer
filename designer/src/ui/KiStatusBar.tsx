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
