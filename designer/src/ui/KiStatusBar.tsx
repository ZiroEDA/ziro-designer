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

import { useCallback, useRef, useState, type JSX, type ReactNode } from 'react';
import { STATUS_FIELD_TEMPLATES, StatusField } from './StatusField.js';
import { BackgroundJobList, useFrontBackgroundJob } from './BackgroundJobList.js';

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
  /**
   * A frame's own field widths, overriding the shared table pane by pane.
   *
   * `updateStatusBarWidths` is what every draw frame gets, but a frame may
   * state its own afterwards and one does: `PL_EDITOR_FRAME` builds a `dims[]`
   * of its own and calls `SetFieldsCount` with it
   * (pagelayout_editor/pl_editor_frame.cpp:150-181), which is why its
   * coordinate origin pane is wide enough for "coord origin: Right Bottom page
   * corner" and its units and constraint panes do not stretch.
   *
   * Naming a pane here makes it fixed at that template's width; a pane left
   * out keeps whatever the shared table says, stretch included. See
   * `editors/drawingsheet/pl_status_bar.ts` for the one caller.
   */
  templates?: Partial<Record<KiStatusBarField, string>>;
  /** Per-pane `data-testid`, for the frames whose tests address a pane. */
  testIds?: Partial<Record<KiStatusBarField, string>>;
  /** Panes for a frame that is not an `EDA_DRAW_FRAME`. */
  children?: ReactNode;
  testId?: string;
}

/**
 * `wxGauge` field width while a job is running, `updateAuxFieldWidths`
 * (common/widgets/kistatusbar.cpp:383): `m_fieldWidths[… BGJOB_GAUGE] = 75`.
 * DATA — KiCad's own literal, not a theme metric.
 */
const BGJOB_GAUGE_WIDTH = 75;

/**
 * `layoutControls`' `constexpr int padding = 5` (kistatusbar.cpp:401): the
 * gauge sits at `x + padding` and is `w - padding` wide inside its field.
 */
const BGJOB_GAUGE_PADDING = 5;

/**
 * The two panes `KISTATUSBAR` appends after whatever the frame asked for —
 * `extraFields` starts at 2 for exactly these (kistatusbar.cpp:87-91), so
 * every frame has them whether or not it knows about background jobs. Order is
 * `FIELD::BGJOB_LABEL` then `FIELD::BGJOB_GAUGE` (kistatusbar.h's enum, and
 * `fieldIndex` returning 0 and 1 for them).
 *
 * Both collapse to width 0 when no job is running (`updateAuxFieldWidths`,
 * :375-384), so an idle bar is indistinguishable from one without them — which
 * is why adding them here changes no existing frame's layout.
 */
function BackgroundJobFields(): JSX.Element | null {
  const job = useFrontBackgroundJob();
  const [listAt, setListAt] = useState<{ x: number; y: number } | null>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const closeList = useCallback(() => setListAt(null), []);

  // `HideBackgroundProgressBar()` is the constructor's last act; the bar is
  // shown only from `jobUpdated` (:339-346) and hidden again by `Remove` when
  // the queue empties (:280-289).
  if (!job) return null;

  return (
    <>
      {/* wxALIGN_RIGHT | wxST_NO_AUTORESIZE (:127-129), and ellipsized at the
          end by `updateBackgroundText` (:409-426). */}
      <span className="cell bgjob-label" data-testid="statusbar-bgjob-label">
        {job.status}
      </span>
      <div
        ref={gaugeRef}
        className="cell bgjob-gauge"
        style={{ width: BGJOB_GAUGE_WIDTH, paddingLeft: BGJOB_GAUGE_PADDING }}
        data-testid="statusbar-bgjob-gauge"
        // `onBackgroundProgressClick` opens the list at the gauge's screen
        // position plus the width of its field — the field's right edge.
        onMouseDown={() => {
          const r = gaugeRef.current?.getBoundingClientRect();
          setListAt(r ? { x: r.right, y: r.top } : { x: 0, y: 0 });
        }}
      >
        <progress
          className="ze-bgjob-gauge"
          max={job.maxProgress}
          value={job.currentProgress}
          aria-label={job.name}
        />
      </div>
      {listAt && <BackgroundJobList anchorX={listAt.x} anchorY={listAt.y} onClose={closeList} />}
    </>
  );
}

export function KiStatusBar({
  fields,
  testIds,
  children,
  testId,
  templates,
}: KiStatusBarProps): JSX.Element {
  // The frame's own `dims[]` wins pane by pane, exactly as `SetFieldsCount`
  // wins over the widths the base constructor had already set.
  const table = templates ? { ...TEMPLATE, ...templates } : TEMPLATE;
  return (
    <div className="ze-statusbar" data-testid={testId}>
      {fields
        ? KISTATUSBAR_FIELDS.map((name) => {
            const template = table[name];

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
      <BackgroundJobFields />
    </div>
  );
}
