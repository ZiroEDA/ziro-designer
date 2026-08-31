// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PASTE_SPECIAL` — `common/dialogs/dialog_paste_special.cpp` and its
 * wxFormBuilder base `dialog_paste_special_base.cpp`.
 *
 * **One dialog, two editors.** Upstream it is constructed exactly twice, and
 * the difference between the two is three arguments, not two classes:
 *
 *     DIALOG_PASTE_SPECIAL dlg( m_frame, &pasteMode );                  // eeschema
 *         (sch_editor_control.cpp:2209)
 *     DIALOG_PASTE_SPECIAL dlg( m_frame, &mode, defaultRef );           // pcbnew
 *     if( clipItem->Type() != PCB_T ) dlg.HideClearNets();
 *         (pcb_control.cpp:1220-1223)
 *
 * It lived under `editors/schematic/dialogs/` here, which is a per-editor copy
 * of a `common/` dialog — so the PCB editor had no Paste Special to open at
 * all. The three things the two editors differ on are the three props below,
 * and everything else is stated once.
 *
 * The enum is upstream's, and it lives with the dialog rather than in either
 * editor: `enum class PASTE_MODE` is declared in
 * `include/dialogs/dialog_paste_special.h:33-38`, not in eeschema or pcbnew.
 */

import { useState, type JSX } from 'react';
import { useModalEscape } from '../ui/useModalEscape.js';

/** `PASTE_MODE` (`include/dialogs/dialog_paste_special.h:33-38`), in order. */
export const PASTE_MODES = [
  'UNIQUE_ANNOTATIONS',
  'KEEP_ANNOTATIONS',
  'REMOVE_ANNOTATIONS',
] as const;

export type PasteSpecialMode = (typeof PASTE_MODES)[number];

/**
 * `m_optionsChoices` (`dialog_paste_special_base.cpp:22`), verbatim and in the
 * radio box's order — `TransferDataFromWindow` maps selection 0/1/2 onto the
 * three enum members, so the order IS the mapping.
 */
const OPTION_LABELS: Record<PasteSpecialMode, string> = {
  UNIQUE_ANNOTATIONS: 'Assign unique reference designators to pasted symbols',
  KEEP_ANNOTATIONS: 'Keep existing reference designators, even if they are duplicated',
  REMOVE_ANNOTATIONS: 'Clear reference designators on all pasted symbols',
};

/**
 * `SetItemToolTip` for the radio box's rows (`dialog_paste_special.cpp:31-39`).
 * The middle row is deliberately empty upstream — the comment there reads
 * "Self explanatory" — so it carries no tooltip here either.
 */
const UNIQUE_TOOLTIP =
  'Finds the next available reference designator for any designators that already exist in the design.';

/** `_( "Replaces reference designators with '%s'." )`, formatted with `aDefaultRef`. */
export function removeTooltip(defaultRef: string): string {
  return `Replaces reference designators with '${defaultRef}'.`;
}

export interface DialogPasteSpecialProps {
  /**
   * `*aMode` on entry — `TransferDataToWindow` selects the row matching it.
   *
   * The two editors seed it differently and NEITHER is a constant of the
   * dialog: eeschema picks `annotateAutomatic ? UNIQUE_ANNOTATIONS :
   * REMOVE_ANNOTATIONS` (`sch_editor_control.cpp:2203`) — it never opens on
   * "keep" — while pcbnew starts at `KEEP_ANNOTATIONS` (`pcb_control.cpp:1209`)
   * and never opens on anything else.
   */
  mode: PasteSpecialMode;
  /**
   * `aDefaultRef`, which appears in the third row's tooltip. pcbnew passes
   * `"REF**"`; eeschema passes nothing and takes the header's default `"?"`
   * (`dialog_paste_special.h:44`).
   */
  defaultRef?: string;
  /**
   * Whether the "Clear net assignments" checkbox is shown.
   *
   * `HideClearNets()` *hides* the control, it does not disable it
   * (`dialog_paste_special.h:55-59`), and only pcbnew ever calls it — for a
   * footprint payload, whose items carry no board netlist to clear. eeschema
   * never calls it, so the box is VISIBLE and enabled in the schematic even
   * though `SCH_EDITOR_CONTROL::Paste` never reads `GetClearNets()`.
   */
  showClearNets?: boolean;
  /** wxID_OK: the chosen mode, and `GetClearNets()`. */
  onOk: (mode: PasteSpecialMode, clearNets: boolean) => void;
  /** wxID_CANCEL — the caller returns without pasting anything. */
  onCancel: () => void;
}

export function DialogPasteSpecial({
  mode: initialMode,
  defaultRef = '?',
  showClearNets = true,
  onOk,
  onCancel,
}: DialogPasteSpecialProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [mode, setMode] = useState<PasteSpecialMode>(initialMode);
  const [clearNets, setClearNets] = useState(false);

  const tooltip = (m: PasteSpecialMode): string | undefined => {
    if (m === 'UNIQUE_ANNOTATIONS') return UNIQUE_TOOLTIP;
    if (m === 'REMOVE_ANNOTATIONS') return removeTooltip(defaultRef);
    return undefined;
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Paste Special
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-paste-special-body">
          {/* The wxRadioBox's own label, which is its group box's legend. */}
          <fieldset className="ze-props-group">
            <legend>Reference Designators</legend>
            {PASTE_MODES.map((m) => (
              <label key={m} title={tooltip(m)}>
                <input
                  type="radio"
                  name="pastemode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />{' '}
                {OPTION_LABELS[m]}
              </label>
            ))}
          </fieldset>
          {showClearNets && (
            <label title="Remove the net information from all connected items before pasting">
              <input
                type="checkbox"
                checked={clearNets}
                onChange={(e) => setClearNets(e.target.checked)}
              />{' '}
              Clear net assignments
            </label>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(mode, clearNets)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
