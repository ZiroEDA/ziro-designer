// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GRID_SETTINGS` — `common/dialogs/dialog_grid_settings.{h,cpp}` and
 * its `_base`, the modal both Add and Edit open on the Grids page.
 *
 * In `dialogs/` rather than `dialogs/prefs/` because that is where it lives
 * upstream: it is `common/dialogs/`, owned by no app, and `PANEL_GRID_SETTINGS`
 * is only its first caller. Its sibling here is `dialog_page_settings.tsx`, the
 * other shared modal.
 *
 * The layout is `DIALOG_GRID_SETTINGS_BASE` (`dialog_grid_settings_base.cpp:12-90`):
 * a three-column `wxFlexGridSizer` whose middle column grows, holding
 *
 *     Name:  [            ]  (optional)
 *     X:     [            ]  unit
 *            [x] Linked
 *     Y:     [            ]  unit
 *
 * and a `wxStdDialogButtonSizer` with OK and Cancel. `m_checkLinked` is
 * constructed **checked** (`:52`) and `m_textY` **disabled** (`:64`), which is
 * exactly the state an Add starts in; `SetInitialFocus( m_textName )`
 * (`dialog_grid_settings.cpp:48`) puts the caret in the Name field.
 *
 * The two text fields are `UNIT_BINDER`s over the calling frame
 * (`dialog_grid_settings.cpp:42-43`), so they read and write in the frame's
 * display unit while `GRID` itself is always stored in millimetres.
 */
import { type JSX, useState } from 'react';
import { useModalEscape } from '../ui/useModalEscape.js';
import { MessageDialogError } from '../ui/dialog_message.js';
import type { GridEntry } from '../ui/grid_settings.js';
import {
  type EdaUnits,
  parseUnitValueDouble,
  stringFromValue,
  unitLabel,
  validateUnitValue,
} from '../ui/unit_binder.js';
import type { EdaIuScale } from '@ziroeda/common';

/**
 * `m_gridSizeX.Validate( 0.001, 1000.0, EDA_UNITS::MM )`
 * (`dialog_grid_settings.cpp:81`, and the same for Y at `:87`). **Millimetres**,
 * whatever unit the field is showing — `UNIT_BINDER::Validate` converts the
 * limits from the units it is given, not from the control's
 * (`common/widgets/unit_binder.cpp`, "aMin and aMax are not always given in
 * internal units"). [data]
 */
const GRID_RANGE_MM = { min: 0.001, max: 1000.0 };

/** `_( "Grid size X out of range." )` (`dialog_grid_settings.cpp:83`). */
const X_OUT_OF_RANGE = 'Grid size X out of range.';
/** `_( "Grid size Y out of range." )` (`dialog_grid_settings.cpp:89`). */
const Y_OUT_OF_RANGE = 'Grid size Y out of range.';

/** `DIALOG_GRID_SETTINGS_BASE`'s default title (`dialog_grid_settings_base.h:57`). */
export const GRID_SETTINGS_TITLE = 'Grid Settings';

export interface DialogGridSettingsProps {
  /**
   * `GRID& aGrid`, the row being edited. `OnAddGrid` passes
   * `GRID{ wxEmptyString, "", "" }` (`panel_grid_settings.cpp:249`), and
   * `TransferDataToWindow` fills nothing when `x` is empty
   * (`dialog_grid_settings.cpp:59-73`) — so an empty grid is what opens the
   * dialog blank, with Linked ticked and Y disabled.
   */
  grid: GridEntry;
  /** The `UNITS_PROVIDER`'s display unit — `GetUserUnits()`. */
  units: EdaUnits;
  /** The `UNITS_PROVIDER`'s `GetIuScale()`, which decides the field precision. */
  iuScale: EdaIuScale;
  /** `ShowModal() == wxID_OK`, with the edited `GRID`. */
  onOk: (grid: GridEntry) => void;
  onCancel: () => void;
}

export function DialogGridSettings({
  grid,
  units,
  iuScale,
  onOk,
  onCancel,
}: DialogGridSettingsProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onCancel);

  /*
   * `TransferDataToWindow` (dialog_grid_settings.cpp:58-75).
   *
   * Everything below the `if` runs only for a grid that already has an X, so a
   * NEW grid keeps the base file's own initial state: empty fields, Linked
   * ticked, Y disabled. And note what upstream does NOT do for a linked grid —
   * it never fills `m_textY`, so unticking Linked on an existing square grid
   * leaves the Y field blank rather than pre-filled with X.
   */
  const [state] = useState(() => {
    if (grid.x === '') return { name: '', linked: true, x: '', y: '' };
    const linked = grid.x === grid.y;
    return {
      name: grid.name,
      linked,
      // `m_grid.ToDouble( scale )` then `SetDoubleValue` (:62-70) — both
      // full-precision, so a grid round-trips through this dialog unchanged.
      x: stringFromValue(parseUnitValueDouble(grid.x, 'mm'), units, false, iuScale),
      y: linked ? '' : stringFromValue(parseUnitValueDouble(grid.y, 'mm'), units, false, iuScale),
    };
  });

  const [name, setName] = useState(state.name);
  const [linked, setLinked] = useState(state.linked);
  const [x, setX] = useState(state.x);
  const [y, setY] = useState(state.y);
  /** `wxMessageBox( …, _( "Error" ), wxOK | wxICON_ERROR )`. */
  const [error, setError] = useState<string | null>(null);

  /** `TransferDataFromWindow` (`dialog_grid_settings.cpp:78-103`). */
  const accept = (): void => {
    // `m_gridSizeX.GetDoubleValue()` (:80), NOT `GetValue()`: the grid is stored
    // at full precision, so 2 typed into a mils field is exactly 0.0508 mm.
    const gridX = parseUnitValueDouble(x, units);

    if (validateUnitValue('X:', gridX, GRID_RANGE_MM, units, iuScale) !== null) {
      setError(X_OUT_OF_RANGE);
      return;
    }

    const typedY = parseUnitValueDouble(y, units);

    if (!linked && validateUnitValue('Y:', typedY, GRID_RANGE_MM, units, iuScale) !== null) {
      setError(Y_OUT_OF_RANGE);
      return;
    }

    const gridY = linked ? gridX : typedY;

    // "Grid X/Y are always stored in millimeters so we can compare them
    // easily" (:97-100). `StringFromValue`'s `aAddUnitsText` defaults to false,
    // so the stored string is a bare number — which is why `GRID::ToDouble`
    // reads a unitless entry as millimetres.
    onOk({
      name,
      x: stringFromValue(gridX, 'mm', false, iuScale),
      y: stringFromValue(gridY, 'mm', false, iuScale),
    });
  };

  if (error !== null) {
    return <MessageDialogError message={error} onClose={() => setError(null)} />;
  }

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-gs"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {GRID_SETTINGS_TITLE}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-gs-body">
          <label className="ze-gs-label" htmlFor="ze-gs-name">
            Name:
          </label>
          <input
            id="ze-gs-name"
            className="ze-search"
            // `SetInitialFocus( m_textName )` (dialog_grid_settings.cpp:48).
            // biome-ignore lint/a11y/noAutofocus: SetInitialFocus, upstream's own.
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="ze-gs-unit">(optional)</span>

          <label className="ze-gs-label" htmlFor="ze-gs-x">
            X:
          </label>
          <input
            id="ze-gs-x"
            className="ze-search"
            value={x}
            onChange={(e) => setX(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="ze-gs-unit">{unitLabel(units)}</span>

          <span />
          <label className="ze-gs-linked">
            <input
              type="checkbox"
              checked={linked}
              // `OnLinkedChecked`: `m_textY->Enable( !IsChecked() )` and
              // nothing else — the Y value itself is left alone.
              onChange={(e) => setLinked(e.target.checked)}
            />
            Linked
          </label>
          <span />

          <label className="ze-gs-label" htmlFor="ze-gs-y">
            Y:
          </label>
          <input
            id="ze-gs-y"
            className="ze-search"
            value={y}
            disabled={linked}
            onChange={(e) => setY(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="ze-gs-unit">{unitLabel(units)}</span>
        </div>
        {/* `wxStdDialogButtonSizer` — OK then Cancel, laid out by the platform;
            every other dialog here renders it through `.ze-modal-footer`. */}
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={accept}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
