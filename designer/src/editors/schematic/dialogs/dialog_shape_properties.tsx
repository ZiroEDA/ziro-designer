// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shape properties: border and fill of a rectangle, circle, arc or polyline.
 * Counterpart: `eeschema/dialogs/dialog_shape_properties.cpp`
 * (DIALOG_SHAPE_PROPERTIES), in its schematic-editor form.
 *
 * The symbol-editor form of this dialog has more in it (private, apply to all
 * units / body styles, and fill-with-body-colour radio buttons). In a schematic
 * a shape has no parent symbol and no body colour, so upstream shows a plain
 * fill combo and a colour swatch instead, which is what this is.
 *
 * "Border" is a checkbox rather than a width of zero: unchecking it stores a
 * width of -1, KiCad's "no border at all", which is distinct from 0 meaning
 * "use the schematic default width".
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
import {
  LINE_STYLE_NAMES,
  lineStyleComboValue,
  type LineStyleToken,
} from '@ziroeda/common/src/stroke_params.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import type { StatusUnits } from '../../../ui/status_format.js';
import {
  parseUnitValueDouble,
  stringFromValue,
  unitLabel,
} from '../../../ui/unit_binder.js';
import { Combo } from '../../../ui/Combo.js';

/**
 * UI_FILL_MODE (include/eda_shape.h) in its declared order, which is the
 * combo's order. The stored `(fill (type …))` token for each is what
 * SetFillModeProp maps it to.
 */
/**
 * `m_fillCtrlChoices` on the SCHEMATIC page of `m_fillBook`
 * (dialog_shape_properties_base.cpp:149):
 *
 *     { _("None"), _("Solid"), _("Hatch"), _("Reverse Hatch"), _("Cross-hatch") }
 *
 * `m_fillBook` is a wxSimplebook with two pages, and the other one — the symbol
 * editor's — is a column of RADIO buttons labelled "Do not fill", "Fill with
 * body outline color", "Fill with body background color", "Fill with:". This
 * list had those labels in a schematic dropdown: the wrong page's words in the
 * right page's control.
 */
const FILL_MODES: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'color', label: 'Solid' },
  { value: 'hatch', label: 'Hatch' },
  { value: 'reverse_hatch', label: 'Reverse Hatch' },
  { value: 'cross_hatch', label: 'Cross-hatch' },
];

export interface ShapePropsResult {
  /** false = no border at all (KiCad stores width -1). */
  border: boolean;
  borderWidthIU: number;
  borderStyle: string;
  borderColor?: ItemColor;
  fillType: string;
  fillColor?: ItemColor;
}

interface Props {
  /** Shown in the title, as upstream names the dialog after the shape. */
  shapeName: string;
  /**
   * The frame's display units. `m_borderWidth` is a `UNIT_BINDER`
   * (dialog_shape_properties.cpp), so the entry formats and parses in the
   * frame's units and the label beside it carries the name. This dialog
   * printed "mm" whatever the frame was set to.
   */
  units: StatusUnits;
  initial: ShapePropsResult;
  onOk: (r: ShapePropsResult) => void;
  onCancel: () => void;
}

export function DialogShapeProperties({
  shapeName,
  units,
  initial,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [border, setBorder] = useState(initial.border);
  const [width, setWidth] = useState(() =>
    initial.borderWidthIU <= 0 ? '0' : stringFromValue(iuToMM(initial.borderWidthIU), units, false),
  );
  // DIALOG_SHAPE_PROPERTIES fills the combo from `lineTypeNames` alone, so it
  // cannot say DEFAULT; a shape that has no style of its own shows Solid
  // (dialog_shape_properties.cpp:147) and is written back as solid.
  const [style, setStyle] = useState(lineStyleComboValue(initial.borderStyle));
  const [borderColor, setBorderColor] = useState(initial.borderColor);
  const [fillType, setFillType] = useState(initial.fillType);
  const [fillColor, setFillColor] = useState(initial.fillColor);

  const filled = fillType !== 'none';

  const submit = (): void =>
    onOk({
      border,
      borderWidthIU: border ? mmToIU(parseUnitValueDouble(width, units) || 0) : -1,
      borderStyle: style,
      ...(borderColor ? { borderColor } : {}),
      fillType,
      ...(filled && fillColor ? { fillColor } : {}),
    });

  const swatch = (
    value: ItemColor | undefined,
    set: (c: ItemColor | undefined) => void,
    enabled: boolean,
  ): JSX.Element => (
    <>
      {/* COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
          (color_swatch.cpp:301-328). It was an <input type="color">,
          i.e. the desktop's picker as a popup anchored to the control -
          off-screen near the window edge, and unable to carry alpha. */}
      <ColorSwatch
        label="Color"
        disabled={!enabled}
        color={itemColorToColor4d(value)}
        onChange={(c) => set(color4dToItemColor(c))}
      />
      {/* m_helpLabel2 (dialog_shape_properties_base.cpp:172) is one static
          label for the whole page, not a button per swatch - see the page
          body below. Clearing is the picker's own Clear Color. */}
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {shapeName} Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        {/* `bColumns`, horizontal (dialog_shape_properties_base.cpp:69):
            the border grid at proportion 9, a 15 px spacer, then `m_fillBook`.
            Two columns — this was one stacked list of six rows. */}
        <div className="ze-label-dialog-body ze-shapeprops">
          {/* `m_borderSizer`, a wxGridBagSizer( 3, 3 ):
                (0,0) span 1x2  Border
                (1,0) "Width:"  | (1,1) span 1x2  [entry][units] Color: [swatch]
                (2,0) "Style:"  | (2,1) span 1x2  the style combo
                (3,0) span 1x2  m_helpLabel1                                */}
          <div className="ze-shapeprops-border">
            <label className="row ze-shapeprops-span">
              <input
                type="checkbox"
                checked={border}
                onChange={(e) => setBorder(e.target.checked)}
              />
              <span>Border</span>
            </label>

            <span className="ze-shapeprops-lbl">Width:</span>
            {/* bSizer7: the entry, its units, then the Color label and swatch —
                all on ONE row, which is why Color sits beside Width upstream
                and not on a row of its own. */}
            <div className="ze-shapeprops-widthrow">
              <input
                className="ze-search"
                disabled={!border}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="ze-muted">{unitLabel(units)}</span>
              <span className="ze-shapeprops-colorlbl">Color:</span>
              {swatch(borderColor, setBorderColor, border)}
            </div>

            <span className="ze-shapeprops-lbl">Style:</span>
            <Combo
              ariaLabel="Style"
              disabled={!border}
              value={style}
              onChange={(v) => setStyle(v as LineStyleToken)}
              options={LINE_STYLE_NAMES.map((x) => ({ value: x.value, label: x.label }))}
            />

            {/* m_helpLabel1 (base.cpp:125), at (3,0) span 1x2. We did not have
                it at all. */}
            <span className="ze-help-label ze-shapeprops-span">
              Set border width to 0 to use schematic&apos;s default line width.
            </span>
          </div>

          {/* m_fillBook's schematic page: `m_fillSizer`, also a
              wxGridBagSizer( 3, 3 ) — "Fill:" over "Fill color:". */}
          <div className="ze-shapeprops-fill">
            <span className="ze-shapeprops-lbl">Fill:</span>
            <Combo
              ariaLabel="Fill"
              value={fillType}
              onChange={(v) => setFillType(v)}
              options={FILL_MODES.map((f) => ({ value: f.value, label: f.label }))}
            />

            {/* The colour label and swatch are disabled with the fill itself
                (onFillChoice), since there is nothing for a colour to apply to. */}
            <span className="ze-shapeprops-lbl">Fill color:</span>
            {swatch(fillColor, setFillColor, filled)}

            {/* m_helpLabel2 (base.cpp:172), added `wxTOP|wxRIGHT, 8`. Plural
                "colors" here because this page has two of them. */}
            <span className="ze-help-label ze-shapeprops-span">
              Clear colors to use Schematic Editor colors.
            </span>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
