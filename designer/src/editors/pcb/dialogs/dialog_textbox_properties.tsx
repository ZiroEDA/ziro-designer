// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text box properties.
 * Counterpart: `pcbnew/dialogs/dialog_textbox_properties.cpp` and its
 * `_base.cpp`.
 *
 * The decisions live in `pcbnew/src/textbox_properties.ts`; this is layout.
 *
 * ## The shape is one gridbag, and its placements are data
 *
 * `bMainSizer` is vertical and has **no group boxes**: `m_MultiLineSizer` (the
 * "Text:" label, the control, and the "Syntax help" link the .cpp appends to
 * that same sizer at `:90`), then ONE `wxGridBagSizer( 3, 3 )`, then the
 * standard buttons.
 *
 *     Locked  [x]
 *     Layer:  [combo]                    Orientation: [combo]
 *     Font:   [FONT_CHOICE]              | B I | \u21e4\u21d4\u21e5 | \u2912\u21d5\u2913 | mirrored |
 *     Text width:  [ ] mm                Border       [x]
 *     Text height: [ ] mm                Border width:  [ ] mm
 *     Thickness:   [ ] mm                Border style:  [combo]
 *
 * That grid is SEVEN columns wide with `AddGrowableCol( 3 )` — column 3 is
 * empty and holds the two halves apart — and its rows are 0, 1, 3, 5, 6, 7:
 * rows 2 and 4 exist and are empty, which is what puts six pixels rather than
 * three under the Layer row and under the Font row. Every cell carries its own
 * `wxGBPosition` and its own `Add()` border, in `.ze-tbp-*`; there is no shared
 * row or column rule, because a gridbag is a list of placements and not a
 * table. This file had a four-column grid and a container `gap`, so nothing
 * lined up with the half opposite and the whole dialog sat flush against its
 * own edges — `bMainSizer` insets both blocks by 10.
 *
 * This file had four invented group boxes — Text, Font, Alignment, Border — a
 * text area four lines tall in the corner of the first one, and the whole
 * formatting bar spelled out as checkboxes and dropdowns.
 *
 * ## The formatting bar is the shared one
 *
 * `ui/TextFormatBar.tsx` already builds it: KiCad assembles the same buttons
 * from `FONT_CHOICE` and `BITMAP_BUTTON` into every dialog that edits text, in
 * one order. pcbnew's bars end with `m_mirrored` where eeschema's end with the
 * horizontal/vertical pair, which is the one thing that differs and is a prop.
 *
 * ## Knockout and the four margins are not in this dialog
 *
 * They are `PCB_TEXTBOX`'s **property manager** entries — `_HKI( "Knockout" )`
 * and `_HKI( "Margin Left" )` and friends (`pcb_textbox.cpp:871,893-900`) — so
 * they belong to the Properties panel, not here. They were invented controls.
 *
 * ## The width is two control minimums, never a dialog size
 *
 * `_base.cpp:18` states no dialog size at all. The two `SetMinSize` calls in the
 * file — `m_LayerSelectionCtrl` at 175 and `m_borderStyleCombo` at 240 (`:79`,
 * `:233`) — are what propagate up through the gridbag to `Fit( this )`. They
 * live in `.ze-tbp-layer` / `.ze-tbp-borderstyle`.
 *
 * Left out: the auto-thickness button (`m_autoTextThickness`), which needs font
 * metrics we do not have, and KiCad's Scintilla text control with its
 * text-variable auto-complete.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbIUScale, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseUnitValue, stringFromValue, unitLabel } from '../../../ui/unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';
import type { TextBoxValues } from '@ziroeda/pcbnew/src/textbox_properties.js';
import type { StrokeType } from '@ziroeda/pcbnew/src/types.js';
import { LINE_STYLE_NAMES } from '@ziroeda/common/src/stroke_params.js';
import { Combo } from '../../../ui/Combo.js';
import { StdDialogButtons } from '../../../ui/StdDialogButtons.js';
import { FontChoice, TextFormatBar, type HAlign, type VAlign } from '../../../ui/TextFormatBar.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

type MmKey = 'width' | 'height' | 'thickness' | 'borderWidth';

/**
 * `double rot_list[] = { 0.0, 90.0, -90.0, 180.0 }`, written into the combo as
 * `wxString::Format( "%.1f", … )` (`dialog_textbox_properties.cpp:153-156`).
 * Not 0/90/180/270, and not without the decimal: those were both invented here.
 */
const ORIENTATIONS = [0, 90, -90, 180];

/**
 * The entry that stands for an angle. A board angle of 270 is the same rotation
 * as the -90 the list carries, so it selects that row rather than falling off
 * the end of the combo; anything else is shown as it is, which is what
 * `m_OrientCtrl` being an editable `wxComboBox` lets upstream do.
 */
function orientationLabel(deg: number): string {
  const turn = (a: number): number => ((a % 360) + 360) % 360;
  return (ORIENTATIONS.find((o) => turn(o) === turn(deg)) ?? deg).toFixed(1);
}

interface Props {
  initial: TextBoxValues;
  /**
   * The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`.
   *
   * Every distance in this dialog is a `UNIT_BINDER` upstream — the .cpp binds
   * five of them, `m_textWidth`, `m_textHeight`, `m_thickness`, `m_borderWidth`
   * and the orientation angle, each constructed with its label, its control AND
   * its unit static text. The binder formats through `StringFromValue`, parses
   * through `ValueFromString`, and writes the unit NAME into that third control,
   * all in the frame's units. A board in mils shows `39.37` where the same field
   * on a mm board shows `1`.
   *
   * These four printed a literal "mm" and formatted with `iuToMM` regardless,
   * which is the same defect `dialog_units_follow_frame.test.ts` was written for
   * on the schematic side — and could not see here, because its scan stopped at
   * `editors/schematic/dialogs`.
   */
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for the layer combo's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: TextBoxValues) => void;
  onClose: () => void;
}

export function DialogTextBoxProperties({
  initial,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [v, setV] = useState<TextBoxValues>(initial);
  // Width fields are held as text while typed, so a half-typed "0." is not
  // rounded away under the cursor.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const set = (patch: Partial<TextBoxValues>): void => setV((p) => ({ ...p, ...patch }));

  /**
   * One `UNIT_BINDER` row: the label, the control and the unit static text are
   * three separate cells of the gridbag, in three columns
   * (`m_SizeXLabel` / `m_SizeXCtrl` / `m_SizeXUnits` at `( 5, 0 )` `( 5, 1 )`
   * `( 5, 2 )`), so this cannot wrap them in a box of its own without losing
   * the column the right-hand half aligns to.
   *
   * `Enable( false )` greys all three together (`unit_binder.cpp:697-706`).
   */
  const mmField = (label: string, key: MmKey, slot: string, disabled?: boolean): JSX.Element => (
    <>
      <span className={`ze-tbp-lbl ze-tbp-${slot}-lbl${disabled ? ' disabled' : ''}`}>{label}</span>
      <input
        type="text"
        className={`ze-input ze-tbp-${slot}-ctl`}
        disabled={disabled}
        value={typed[key] ?? stringFromValue(pcbIuToMM(v[key]), units, false, pcbIUScale)}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          // `UNIT_BINDER::GetValue()`, which is `GetIntValue()` quantised to the
          // frame's internal unit — not `Number()`, which cannot read the mils
          // this field shows on a mils board, and honours no `1.5mm` suffix.
          const mm = parseUnitValue(e.target.value, units, pcbIUScale);
          if (Number.isFinite(mm)) set({ [key]: pcbMmToIU(mm) } as Partial<TextBoxValues>);
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className={`ze-unit-label ze-tbp-${slot}-u${disabled ? ' disabled' : ''}`}>
        {unitLabel(units)}
      </span>
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-textboxprops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Text Box Properties
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-textboxprops-body">
          {/* `m_MultiLineSizer`: the label, the control, then the link the .cpp
              appends to this same sizer (`:90`) — all three inside the one box
              `bMainSizer` adds with `wxALL, 10`. */}
          <div className="ze-tbp-multiline">
            <span className="ze-tbp-caption">Text:</span>
            <textarea
              className="ze-input ze-tbp-text"
              value={v.text}
              onChange={(e) => set({ text: e.target.value })}
            />
            {/* `m_syntaxHelp`, a wxHyperlinkCtrl (`:87-90`). It opens the
                text-variable syntax window, which we do not have yet. */}
            <button type="button" className="ze-hyperlink ze-tbp-syntax">
              Syntax help
            </button>
          </div>

          {/* One wxGridBagSizer( 3, 3 ), seven columns, `AddGrowableCol( 3 )`.
              Each cell states its own `wxGBPosition` in shell.css. */}
          <div className="ze-tbp-grid">
            {/* `m_cbLocked` at `( 0, 0 )`, spanning three columns — it is IN the
                gridbag, not above it. */}
            <label className="ze-tbp-check ze-tbp-locked">
              <input
                type="checkbox"
                checked={v.locked}
                onChange={(e) => set({ locked: e.target.checked })}
              />
              Locked
            </label>

            <span className="ze-tbp-lbl ze-tbp-layer-lbl">Layer:</span>
            {/* `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR: every entry
                carries its layer's colour swatch. */}
            <Combo
              className="ze-tbp-layer"
              value={v.layer}
              onChange={(layer) => set({ layer })}
              options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
            />
            <span className="ze-tbp-lbl ze-tbp-orient-lbl">Orientation:</span>
            <Combo
              className="ze-tbp-orient"
              value={orientationLabel(v.orientation)}
              onChange={(next) => set({ orientation: Number(next) })}
              options={ORIENTATIONS.map((o) => ({ value: o.toFixed(1), label: o.toFixed(1) }))}
            />

            {/* `m_fontLabel` at `( 3, 0 )` and `m_fontCtrl` at `( 3, 1 )`
                spanning three, then the bar at `( 3, 4 )`. */}
            <span className="ze-tbp-lbl ze-tbp-font-lbl">Font:</span>
            <div className="ze-tbp-font">
              <FontChoice face={v.face} onChange={(face) => set({ face })} />
            </div>
            <div className="ze-tbp-bar">
              <TextFormatBar
                bold={v.bold}
                onBold={(bold) => set({ bold })}
                italic={v.italic}
                onItalic={(italic) => set({ italic })}
                hAlign={v.horizJustify as HAlign}
                onHAlign={(h) => set({ horizJustify: h })}
                vAlign={v.vertJustify as VAlign}
                onVAlign={(vv) => set({ vertJustify: vv })}
                mirrored={v.mirrored}
                onMirrored={(mirrored) => set({ mirrored })}
              />
            </div>

            {mmField('Text width:', 'width', 'w')}
            <label className="ze-tbp-check ze-tbp-border">
              <input
                type="checkbox"
                checked={v.border}
                onChange={(e) => set({ border: e.target.checked })}
              />
              Border
            </label>

            {mmField('Text height:', 'height', 'h')}
            {mmField('Border width:', 'borderWidth', 'bw', !v.border)}

            {mmField('Thickness:', 'thickness', 't')}
            <span className={`ze-tbp-lbl ze-tbp-style-lbl${v.border ? '' : ' disabled'}`}>
              Border style:
            </span>
            {/* `m_borderStyleCombo` is a wxBitmapComboBox: the stroke is drawn
                beside its name. */}
            <Combo
              className="ze-tbp-borderstyle"
              disabled={!v.border}
              value={v.borderStyle}
              onChange={(next) => set({ borderStyle: next as StrokeType })}
              options={LINE_STYLE_NAMES.map((s) => ({
                value: s.value,
                label: s.label,
                ...(s.bitmap ? { bitmap: s.bitmap } : {}),
              }))}
            />
          </div>
        </div>

        {/* `SetupStandardButtons()` (`:161`) takes no label override, so the
            affirmative button reads OK whether the box is being placed or
            edited. "Create" was ours. */}
        <StdDialogButtons onCancel={onClose} onOk={() => onApply(v)} />
      </div>
    </div>
  );
}
