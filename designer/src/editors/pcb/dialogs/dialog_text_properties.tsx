// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text properties.
 * Counterpart: `pcbnew/dialogs/dialog_text_properties.cpp` and its `_base.cpp`.
 *
 * The decisions live in `pcbnew/src/graphic_properties.ts`; this is layout.
 *
 * ## The shape is one gridbag, and its placements are data
 *
 * `bMainSizer` is vertical with NO group boxes: `m_MultiLineSizer` (the "Text:"
 * label, the control, and the "Syntax help" link the .cpp appends to that same
 * sizer at `:107`), then ONE `wxGridBagSizer( 2, 3 )`, then the standard
 * buttons.
 *
 *     Locked  [x]
 *     Layer:  [combo]                     Knockout [x]
 *     Font:   [FONT_CHOICE]               | B I | ⇤⇔⇥ | ⤒⇕⤓ | mirrored |
 *     Width:      [ ] mm                  Position X: [ ] mm
 *     Height:     [ ] mm                  Position Y: [ ] mm
 *     Thickness:  [ ] mm                  Orientation: [combo]
 *
 * Seven columns with `AddGrowableCol( 1 )` AND `AddGrowableCol( 5 )` — the two
 * control columns share the slack, which is why the two halves stay the same
 * width as the dialog grows — and column 3 is the empty separator its
 * `SetEmptyCellSize( wxSize( 20,-1 ) )` widens. Every cell states its own
 * `wxGBPosition` and its own `Add()` border in `.ze-txt-*`, because that is how
 * the file states them.
 *
 * This dialog had three invented group boxes (Text, Font, Position), a
 * single-line `<input>` where upstream has a Scintilla control, a native
 * `<select>` for the layer, Bold/Italic/Mirrored spelled out as checkboxes
 * where KiCad has the shared formatting bar, a free-text Orientation, and no
 * Syntax help at all.
 *
 * ## What upstream hides for a BOARD text
 *
 * `dialog_text_properties.cpp:161-165` — for anything that is not footprint
 * text it hides `m_SingleLineSizer` (the "Reference designator:" row),
 * `m_Visible` ("Show") and `m_KeepUpright`. Those three are footprint-text
 * business, so this dialog does not carry them; the Show checkbox it used to
 * have was one of them.
 *
 * Left out: the auto-thickness button (`m_autoTextThickness`), which needs font
 * metrics we do not have.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbIUScale, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { TextValues } from '@ziroeda/pcbnew/src/graphic_properties.js';
import { Combo } from '../../../ui/Combo.js';
import { StdDialogButtons } from '../../../ui/StdDialogButtons.js';
import { FontChoice, TextFormatBar, type HAlign, type VAlign } from '../../../ui/TextFormatBar.js';
import { parseUnitValue, stringFromValue, unitLabel } from '../../../ui/unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** The IU-valued fields, each a `UNIT_BINDER` upstream. */
type MmKey = 'width' | 'height' | 'thickness' | 'x' | 'y';

/**
 * `double rot_list[] = { 0.0, 90.0, -90.0, 180.0 }`, written into the combo as
 * `wxString::Format( "%.1f", … )` (`dialog_text_properties.cpp:220-223`) — the
 * same four `DIALOG_TEXTBOX_PROPERTIES` carries, from the same list.
 */
const ORIENTATIONS = [0, 90, -90, 180];

/** The entry that stands for an angle; 270 selects the -90 the list carries. */
function orientationLabel(deg: number): string {
  const turn = (a: number): number => ((a % 360) + 360) % 360;
  return (ORIENTATIONS.find((o) => turn(o) === turn(deg)) ?? deg).toFixed(1);
}

interface Props {
  initial: TextValues;
  /**
   * The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. Width, Height,
   * Thickness and both positions are `UNIT_BINDER`s upstream
   * (`dialog_text_properties.cpp:40-46`), so all five show and read the frame's
   * unit rather than a fixed millimetre.
   */
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for the layer combo's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: TextValues) => void;
  onClose: () => void;
}

export function DialogTextProperties({
  initial,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [v, setV] = useState<TextValues>(initial);
  // Held as text while typed, so a half-typed "0." is not rounded away under
  // the cursor.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const set = (patch: Partial<TextValues>): void => setV((p) => ({ ...p, ...patch }));

  /**
   * One `UNIT_BINDER` row: the label, the control and the unit static text are
   * three separate gridbag cells in three columns, so this cannot wrap them in
   * a box of its own without losing the column the opposite half aligns to.
   */
  const mmField = (label: string, key: MmKey, slot: string): JSX.Element => (
    <>
      <span className={`ze-txt-lbl ze-txt-${slot}-lbl`}>{label}</span>
      <input
        type="text"
        className={`ze-input ze-txt-${slot}-ctl`}
        value={typed[key] ?? stringFromValue(pcbIuToMM(v[key]), units, false, pcbIUScale)}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          // `UNIT_BINDER::GetValue()` — `GetIntValue()` quantised to the board's
          // internal unit, not `Number()`, which cannot read the mils this field
          // shows on a mils board and honours no `1.5mm` suffix.
          const mm = parseUnitValue(e.target.value, units, pcbIUScale);
          if (Number.isFinite(mm)) set({ [key]: pcbMmToIU(mm) } as Partial<TextValues>);
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className={`ze-unit-label ze-txt-${slot}-u`}>{unitLabel(units)}</span>
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-textprops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Text Properties
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-textprops-body">
          {/* `m_MultiLineSizer`: the label, the control, then the link the .cpp
              appends to this same sizer (`:107`) — all three inside the one box
              `bMainSizer` adds with `wxALL, 10`. */}
          <div className="ze-txt-multiline">
            <span className="ze-txt-caption">Text:</span>
            <textarea
              className="ze-input ze-txt-text"
              // biome-ignore lint/a11y/noAutofocus: `SetInitialFocus( m_MultiLineText )`
              autoFocus
              value={v.text}
              onChange={(e) => set({ text: e.target.value })}
            />
            {/* `m_syntaxHelp`, a wxHyperlinkCtrl (`:104-107`). It opens
                `PCB_TEXT::ShowSyntaxHelp`, which we do not have yet. */}
            <button type="button" className="ze-hyperlink ze-txt-syntax">
              Syntax help
            </button>
          </div>

          {/* One wxGridBagSizer( 2, 3 ), seven columns, growable 1 and 5. */}
          <div className="ze-txt-grid">
            {/* `m_cbLocked` at `( 0, 0 )`, spanning three columns. */}
            <label className="ze-txt-check ze-txt-locked">
              <input
                type="checkbox"
                checked={v.locked}
                onChange={(e) => set({ locked: e.target.checked })}
              />
              Locked
            </label>

            <span className="ze-txt-lbl ze-txt-layer-lbl">Layer:</span>
            {/* `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR: every entry
                carries its layer's colour swatch. This was a native `<select>`,
                which has neither the swatch nor the frame's chrome. */}
            <Combo
              className="ze-txt-layer"
              value={v.layer}
              onChange={(layer) => set({ layer })}
              options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
            />
            {/* `bSizer7` at `( 1, 4 )`. Knockout is all of it for a board text:
                Keep upright and Show are hidden (`:163-164`). */}
            <label className="ze-txt-check ze-txt-knockout">
              <input
                type="checkbox"
                checked={v.knockout}
                onChange={(e) => set({ knockout: e.target.checked })}
              />
              Knockout
            </label>

            {/* `m_fontLabel` at `( 2, 0 )` and `m_fontCtrl` at `( 2, 1 )`
                spanning two. `FONT_CHOICE` is a wxOwnerDrawnComboBox, which is
                what `Combo` is; the shared `FontChoice` builds it with the
                entries the generated bases spell. */}
            <span className="ze-txt-lbl ze-txt-font-lbl">Font:</span>
            <div className="ze-txt-font">
              <FontChoice face={v.face} onChange={(face) => set({ face })} />
            </div>
            {/* `( 2, 4 )`, spanning three. */}
            <div className="ze-txt-bar">
              <TextFormatBar
                bold={v.bold}
                onBold={(bold) => set({ bold })}
                italic={v.italic}
                onItalic={(italic) => set({ italic })}
                hAlign={v.hJustify as HAlign}
                onHAlign={(h) => set({ hJustify: h })}
                vAlign={v.vJustify as VAlign}
                onVAlign={(vv) => set({ vJustify: vv })}
                mirrored={v.mirrored}
                onMirrored={(mirrored) => set({ mirrored })}
              />
            </div>

            {mmField('Width:', 'width', 'w')}
            {mmField('Position X:', 'x', 'px')}

            {mmField('Height:', 'height', 'h')}
            {mmField('Position Y:', 'y', 'py')}

            {mmField('Thickness:', 'thickness', 't')}
            <span className="ze-txt-lbl ze-txt-orient-lbl">Orientation:</span>
            <Combo
              className="ze-txt-orient"
              value={orientationLabel(v.orientation)}
              onChange={(next) => set({ orientation: Number(next) })}
              options={ORIENTATIONS.map((o) => ({ value: o.toFixed(1), label: o.toFixed(1) }))}
            />
          </div>
        </div>

        {/* `SetupStandardButtons()` with no override, so the button is OK. */}
        <StdDialogButtons onCancel={onClose} onOk={() => onApply(v)} />
      </div>
    </div>
  );
}
