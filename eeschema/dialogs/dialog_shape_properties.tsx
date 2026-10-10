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
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { useState, type JSX } from 'react';
import { FILL_MODE_NAMES, FILL_MODE_TOKENS, iuToMM, mmToIU } from '@ziroeda/common';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
import {
  LINE_STYLE_NAMES,
  lineStyleComboValue,
  type LineStyleToken,
} from '@ziroeda/common/stroke_params.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import {
  parseUnitValueDouble,
  stringFromValue,
  unitLabel,
} from '@ziroeda/common/widgets/unit_binder.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, lineTypeNames } from '@ziroeda/common/stroke_params.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_SHAPE } from '../sch_shape.js';
import { lineStyleOfToken, lineStyleToken } from './dialog_wire_bus_properties.js';

/**
 * UI_FILL_MODE (include/eda_shape.h) in its declared order, which is the
 * combo's order. The stored `(fill (type …))` token for each is what
 * SetFillModeProp maps it to.
 */
/**
 * `m_fillCtrlChoices` on the SCHEMATIC page of `m_fillBook`
 * (dialog_shape_properties_base.cpp:149) — the same five `FILL_T` entries the
 * properties panel's `_HKI( "Fill" )` enum offers, so they live in
 * `common/eda_shape.ts` and both read them from there.
 */
const FILL_MODES = FILL_MODE_TOKENS.map((value, k) => ({ value, label: FILL_MODE_NAMES[k]! }));

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
    <DialogShim title={`${shapeName} Properties`} onClose={onCancel} className="ze-label-dialog">
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
          <CheckBox
            label="Border"
            checked={border}
            className="row ze-shapeprops-span"
            onChange={(v) => setBorder(v)}
          />

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
            // `m_borderStyleCombo` is a wxBitmapComboBox, and each row is
            // `Append( lineStyleDesc.name, KiBitmapBundle( lineStyleDesc.bitmap ) )`
            // (dialog_shape_properties.cpp:61) — the stroke drawn beside its
            // name. The bitmap is half of `lineTypeNames`; we were using only
            // the other half.
            options={LINE_STYLE_NAMES.map((x) => ({
              value: x.value,
              label: x.label,
              ...(x.bitmap ? { bitmap: x.bitmap } : {}),
            }))}
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
        <Button label="Cancel" onClick={onCancel} />
        <Button label="OK" isDefault onClick={submit} />
      </div>
    </DialogShim>
  );
}

/**
 * `DIALOG_SHAPE_PROPERTIES` (eeschema/dialogs/dialog_shape_properties.cpp), the schematic
 * editor's model half: the border and fill of a live shape (TransferDataToWindow) and the
 * SCH_COMMIT its OK makes (TransferDataFromWindow). The window draws it with DialogShapeProperties.
 *
 * Not here: the symbol editor's fill radio buttons and unit/body-style checkboxes (that frame has
 * its own dialog path), and the rule area's four exclude/DNP checkboxes, which the form lacks.
 */
export interface SHAPE_DIALOG_VALUES {
  border: boolean;
  borderWidth: number;
  /** The combo's token: `default` is DEFAULT_LINE_STYLE_LABEL's row. */
  borderStyle: string;
  borderColor: Color4d;
  /** `FILL_MODE_TOKENS[ GetFillModeProp() ]`. */
  fillType: string;
  fillColor: Color4d;
}

export class DIALOG_SHAPE_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_shape: SCH_SHAPE;

  constructor(aParent: SCH_EDIT_FRAME, aShape: SCH_SHAPE) {
    this.m_frame = aParent;
    this.m_shape = aShape;
  }

  /** `TransferDataToWindow()`, the schematic branch. */
  TransferDataToWindow(): SHAPE_DIALOG_VALUES {
    const stroke = this.m_shape.GetStroke();

    return {
      border: this.m_shape.GetWidth() >= 0,
      borderWidth: Math.max(0, this.m_shape.GetWidth()),
      borderStyle: lineStyleToken(stroke.GetLineStyle()),
      borderColor: stroke.GetColor(),
      fillType: FILL_MODE_TOKENS[this.m_shape.GetFillModeProp()] ?? 'none',
      fillColor: this.m_shape.GetFillColor(),
    };
  }

  /** `TransferDataFromWindow()`, the schematic branch. */
  TransferDataFromWindow(aValues: SHAPE_DIALOG_VALUES): boolean {
    const commit = new SCH_COMMIT(this.m_frame);

    if (!this.m_shape.IsNew()) commit.Modify(this.m_shape, this.m_frame.GetScreen());

    const stroke = this.m_shape.GetStroke();

    if (aValues.border) stroke.SetWidth(Math.max(0, aValues.borderWidth));
    else stroke.SetWidth(-1);

    // `std::advance( lineTypeNames.begin(), selection )`, SOLID past the end - the "Default" row
    // of the combo is DEFAULT_LINE_STYLE_LABEL, which is SOLID's own name.
    const style = lineStyleOfToken(aValues.borderStyle);
    stroke.SetLineStyle(lineTypeNames.has(style) ? style : LINE_STYLE.SOLID);
    stroke.SetColor(aValues.borderColor);

    this.m_shape.SetStroke(stroke);

    const fillMode = FILL_MODE_TOKENS.indexOf(
      aValues.fillType as (typeof FILL_MODE_TOKENS)[number],
    );
    this.m_shape.SetFillModeProp(Math.max(0, fillMode));
    this.m_shape.SetFillColor(aValues.fillColor);

    if (!commit.Empty()) commit.Push(`Edit ${this.m_shape.GetFriendlyName()}`);

    return true;
  }
}
