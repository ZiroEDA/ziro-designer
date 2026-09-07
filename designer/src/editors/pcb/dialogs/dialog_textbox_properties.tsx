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
 * ## The shape
 *
 * `bMainSizer` is vertical and has **no group boxes**: the multi-line text
 * control fills the top, then a "Syntax help" link, then `Locked`, then one
 * `wxGridBagSizer` of everything else in two columns —
 *
 *     Layer:  [combo]                    Orientation: [combo]
 *     Font:   [FONT_CHOICE] | B I | ⇤⇔⇥ | ⤒⇕⤓ | mirrored |
 *     Text width:  [ ] mm               Border       [x]
 *     Text height: [ ] mm               Border width:  [ ] mm
 *     Thickness:   [ ] mm 🔗            Border style:  [combo]
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
 * Left out: `m_fontCtrl`, because nothing on the pcbnew side carries a font —
 * neither `PcbTextItem` nor `PcbTextBox` has a face, so the control would edit
 * nothing; the auto-thickness button (`m_autoTextThickness`), which needs font
 * metrics we do not have; and KiCad's Scintilla text control with its
 * text-variable auto-complete.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { TextBoxValues } from '@ziroeda/pcbnew/src/textbox_properties.js';
import type { StrokeType } from '@ziroeda/pcbnew/src/types.js';
import { LINE_STYLE_NAMES } from '@ziroeda/common/src/stroke_params.js';
import { Combo } from '../../../ui/Combo.js';
import { StdDialogButtons } from '../../../ui/StdDialogButtons.js';
import { TextFormatBar, type HAlign, type VAlign } from '../../../ui/TextFormatBar.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

type MmKey = 'width' | 'height' | 'thickness' | 'borderWidth';

/**
 * `m_OrientCtrl` is a `wxComboBox` seeded with these four
 * (`dialog_textbox_properties.cpp`), not a free-text angle field.
 */
const ORIENTATIONS = ['0', '90', '180', '270'];

interface Props {
  initial: TextBoxValues;
  layers: readonly string[];
  /** The board colour of a layer, for the layer combo's swatch. */
  layerColor: (layer: string) => string;
  /** "OK" reads "Create" when the box is being placed rather than edited. */
  placing?: boolean;
  onApply: (v: TextBoxValues) => void;
  onClose: () => void;
}

export function DialogTextBoxProperties({
  initial,
  layers,
  layerColor,
  placing = false,
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

  const mmField = (label: string, key: MmKey, disabled?: boolean): JSX.Element => (
    <>
      <span className="ze-tbp-lbl">{label}</span>
      <span className="ze-tbp-ctl">
        <input
          type="text"
          className="ze-input ze-tbp-num"
          disabled={disabled}
          value={typed[key] ?? String(pcbIuToMM(v[key]))}
          onChange={(e) => {
            setTyped((p) => ({ ...p, [key]: e.target.value }));
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<TextBoxValues>);
          }}
          onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
        />
        <span className="ze-muted">mm</span>
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
          {/* `m_MultiLineSizer`: the label, the control, then the link. */}
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

          <label className="ze-tbp-check">
            <input
              type="checkbox"
              checked={v.locked}
              onChange={(e) => set({ locked: e.target.checked })}
            />
            Locked
          </label>

          {/* One wxGridBagSizer, two label/control column pairs. */}
          <div className="ze-tbp-grid">
            <span className="ze-tbp-lbl">Layer:</span>
            {/* `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR: every entry
                carries its layer's colour swatch. Its `SetMinSize( 175,-1 )`
                (`_base.cpp:79`) is half of what makes the dialog its width. */}
            <Combo
              className="ze-tbp-layer"
              value={v.layer}
              onChange={(layer) => set({ layer })}
              options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
            />
            <span className="ze-tbp-lbl">Orientation:</span>
            <Combo
              value={String(v.orientation)}
              onChange={(next) => set({ orientation: Number(next) })}
              options={ORIENTATIONS.map((o) => ({ value: o, label: o }))}
            />

            {/* KiCad's row is `Font: [FONT_CHOICE] | bar |`. The combo is absent
                because *nothing on the pcbnew side carries a font* — neither
                `PcbTextItem` nor `PcbTextBox` has a face, so a FONT_CHOICE here
                would be a control that changes nothing, which is worse than its
                absence. It arrives with the model field; `ui/TextFormatBar.tsx`
                already has the widget waiting. */}
            <span className="ze-tbp-lbl" />
            <div className="ze-tbp-fontrow">
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

            {mmField('Text width:', 'width')}
            <label className="ze-tbp-check ze-tbp-border">
              <input
                type="checkbox"
                checked={v.border}
                onChange={(e) => set({ border: e.target.checked })}
              />
              Border
            </label>

            {mmField('Text height:', 'height')}
            {mmField('Border width:', 'borderWidth', !v.border)}

            {mmField('Thickness:', 'thickness')}
            <span className="ze-tbp-lbl">Border style:</span>
            {/* `m_borderStyleCombo` is a wxBitmapComboBox: the stroke is drawn
                beside its name. `SetMinSize( 240,-1 )` (`_base.cpp:233`) is the
                other half of the dialog's width. */}
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

        <StdDialogButtons
          onCancel={onClose}
          onOk={() => onApply(v)}
          {...(placing ? { okLabel: 'Create' } : {})}
        />
      </div>
    </div>
  );
}
