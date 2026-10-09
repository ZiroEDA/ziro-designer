// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text / Text Box Properties. Counterpart: `eeschema/dialogs/
 * dialog_text_properties.cpp` over `dialog_text_properties_base.cpp`, one
 * dialog serving SCH_TEXT and SCH_TEXTBOX, with the border/fill rows shown
 * only for the box:
 *
 *   Text:  [ multi-line entry                    ]
 *   [ ] Exclude from simulation        Syntax help
 *   Font:      [Default Font]  | B I | ⇤ ⇔ ⇥ | ⤒ ⇕ ⤓ | ⇉ ⇊ |
 *   Text size: [    ] mm   Color: [swatch]
 *   [ ] Border                        [ ] Background fill
 *   Width:     [    ] mm   Color: [swatch]   Fill color: [swatch]
 *   Style:     [ Default ▾ ]
 *                                      [ Cancel ] [ OK ]
 *
 * The entry grows with the dialog (AddGrowableRow( 0 )), the icon bar carries
 * KiCad's own bitmaps in its order, bold, italic, the three horizontal and
 * three vertical alignments, then horizontal/vertical text, and the colour
 * swatches sit in their thin bordered frames.
 *
 * The font choice offers upstream's two built-in entries; the outline fonts
 * FONT_CHOICE also lists are not available, because this build draws every
 * face with KiCad's own stroke font (issue #154). The choice itself is stored,
 * so a file that names a face keeps it.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import {
  parseUnitValueDouble,
  stringFromValue,
  unitLabel,
} from '@ziroeda/common/widgets/unit_binder.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
import {
  LINE_STYLE_NAMES,
  lineStyleComboValue,
  type LineStyleToken,
} from '@ziroeda/common/stroke_params.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { LINE_STYLE, lineTypeNames } from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import { lineStyleOfToken, lineStyleToken } from './dialog_wire_bus_properties.js';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'center' | 'bottom';

const H_BUTTONS: { value: HAlign; icon: string; title: string }[] = [
  { value: 'left', icon: 'text_align_left', title: 'Align left' },
  { value: 'center', icon: 'text_align_center', title: 'Align horizontal center' },
  { value: 'right', icon: 'text_align_right', title: 'Align right' },
];

const V_BUTTONS: { value: VAlign; icon: string; title: string }[] = [
  { value: 'top', icon: 'text_valign_top', title: 'Align top' },
  { value: 'center', icon: 'text_valign_center', title: 'Align vertical center' },
  { value: 'bottom', icon: 'text_valign_bottom', title: 'Align bottom' },
];

/** Everything the dialog hands back (TransferDataFromWindow). */
export interface TextPropsResult {
  text: string;
  /** FONT_CHOICE: '' = Default Font, otherwise the face written to the file. */
  face: string;
  bold: boolean;
  italic: boolean;
  sizeIU: number;
  color?: ItemColor;
  hAlign: HAlign;
  vAlign: VAlign;
  /** 0 or 90, the two orientation buttons (SetTextAngle). */
  angle: number;
  excludeFromSim: boolean;
  /** `(hyperlink "…")`: a sheet page ("#3") or a URL; '' = none. */
  hyperlink: string;
  /** Text box only: border and fill. */
  border?: boolean;
  borderWidthIU?: number;
  borderColor?: ItemColor;
  borderStyle?: string;
  filled?: boolean;
  fillColor?: ItemColor;
}

export interface TextPropsInitial extends TextPropsResult {}

interface Props {
  /** SCH_TEXT or SCH_TEXTBOX, the box adds the border and fill rows. */
  kind: 'text' | 'textbox';
  initial: TextPropsInitial;
  /** The hierarchy's pages, for the link combo ("#3" — Page 3 (Power)). */
  pages?: readonly { value: string; label: string }[];
  /**
   * The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. Both size
   * fields are `UNIT_BINDER`s upstream, so they format and parse in the frame's
   * units and the label beside each carries the unit name. These printed "mm"
   * whatever the frame was set to.
   */
  units: StatusUnits;
  onOk: (result: TextPropsResult) => void;
  onCancel: () => void;
}

/** `UNIT_BINDER::SetValue`: the frame's units, with the label carrying the name. */
const sizeToText = (iu: number, units: StatusUnits): string =>
  stringFromValue(iuToMM(iu), units, false);

/** COLOR_SWATCH in its wxBORDER_SIMPLE panel, with KiCad's "unset" clear. */
function Swatch({
  color,
  onChange,
  title,
}: {
  color?: ItemColor;
  onChange: (c: ItemColor | undefined) => void;
  title: string;
}): JSX.Element {
  return (
    <>
      {/* COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
            (color_swatch.cpp:301-328), where an <input type="color"> handed
            the job to the desktop's own popup - anchored to the control, so
            off-screen near the window edge, and unable to carry alpha. */}
      <span className="ze-lp-swatch-frame">
        <ColorSwatch
          className="ze-lp-swatch"
          label={title}
          color={itemColorToColor4d(color)}
          onChange={(c) => onChange(color4dToItemColor(c))}
        />
      </span>
    </>
  );
}

export function DialogTextProperties({
  kind,
  initial,
  pages,
  units,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [text, setText] = useState(initial.text);
  const [bold, setBold] = useState(initial.bold);
  const [italic, setItalic] = useState(initial.italic);
  const [hAlign, setHAlign] = useState<HAlign>(initial.hAlign);
  const [vAlign, setVAlign] = useState<VAlign>(initial.vAlign);
  const [angle, setAngle] = useState(initial.angle);
  const [sizeText, setSizeText] = useState(() => sizeToText(initial.sizeIU, units));
  const [color, setColor] = useState<ItemColor | undefined>(initial.color);
  const [excludeFromSim, setExcludeFromSim] = useState(initial.excludeFromSim);
  const [face, setFace] = useState(initial.face ?? '');
  const [linkOn, setLinkOn] = useState(!!initial.hyperlink);
  const [link, setLink] = useState(initial.hyperlink ?? '');
  const [border, setBorder] = useState(initial.border ?? false);
  const [borderWidth, setBorderWidth] = useState(() =>
    sizeToText(initial.borderWidthIU ?? 0, units),
  );
  const [borderColor, setBorderColor] = useState<ItemColor | undefined>(initial.borderColor);
  // Like DIALOG_SHAPE_PROPERTIES, the text-box border combo is filled from
  // `lineTypeNames` alone (dialog_text_properties.cpp:66), so a border with no
  // style of its own shows Solid rather than a "Default" entry upstream lacks.
  const [borderStyle, setBorderStyle] = useState(lineStyleComboValue(initial.borderStyle));
  const [filled, setFilled] = useState(initial.filled ?? false);
  const [fillColor, setFillColor] = useState<ItemColor | undefined>(initial.fillColor);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // SetInitialFocus( m_textCtrl ).
  useEffect(() => {
    textRef.current?.focus();
    textRef.current?.select();
  }, []);

  const isBox = kind === 'textbox';

  const submit = (): void => {
    if (!text.trim()) return;
    // `UNIT_BINDER::GetValue` — parsed in the frame's units, and a value that
    // carries its own suffix is honoured.
    const n = parseUnitValueDouble(sizeText, units);
    const w = parseUnitValueDouble(borderWidth, units);
    onOk({
      text,
      face,
      hyperlink: linkOn ? link.trim() : '',
      bold,
      italic,
      sizeIU: Number.isFinite(n) && n > 0 ? Math.round(mmToIU(n)) : initial.sizeIU,
      ...(color ? { color } : {}),
      hAlign,
      vAlign,
      angle,
      excludeFromSim,
      ...(isBox
        ? {
            border,
            borderWidthIU: Number.isFinite(w) && w >= 0 ? Math.round(mmToIU(w)) : 0,
            ...(borderColor ? { borderColor } : {}),
            borderStyle,
            filled,
            ...(fillColor ? { fillColor } : {}),
          }
        : {}),
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-text-props" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {isBox ? 'Text Box Properties' : 'Text Properties'}
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-tp-body">
          <div className="ze-tp-entry">
            <span className="ze-lp-fmt-label">Text:</span>
            <textarea
              ref={textRef}
              className="ze-lp-value ze-tp-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="ze-lp-entry-row2">
            <label className="ze-lp-check">
              <input
                type="checkbox"
                checked={excludeFromSim}
                onChange={(e) => setExcludeFromSim(e.target.checked)}
              />
              Exclude from simulation
            </label>
            <a
              className="ze-lp-syntax"
              href="https://docs.kicad.org/GetStarted#text"
              target="_blank"
              rel="noreferrer"
              title="Show syntax help window"
            >
              Syntax help
            </a>
          </div>

          <div className="ze-tp-grid">
            {/* m_textEntrySizer row 2, left empty at SetEmptyCellSize's 6px. */}
            <div className="ze-tp-gap" />

            <span className="ze-lp-fmt-label">Font:</span>
            {/* The shared FontChoice, which is `Combo` — our owner-drawn
                combo, as FONT_CHOICE is wxOwnerDrawnComboBox. This was a
                hand-rolled `<select>` saying the same thing in its own words. */}
            {/* Row 3 of m_textEntrySizer holds BOTH: the font control at
                (3,1) spanning two columns and `bSizeCtrlSizer` at (3,3)
                spanning three (`dialog_text_properties_base.cpp:97,178`). The
                bar was a direct grid child here, so `.ze-lp-iconbar`'s
                `grid-column: 1 / -1` threw it onto a row of its own; nesting
                it beside the font in one flex row is what the field dialog
                already does. */}
            <div className="ze-lp-sizerow">
              <FontChoice face={face} onChange={setFace} />
              <div className="ze-lp-iconbar">
                <BitmapButtonSeparator />
                <BitmapButton
                  bitmap="text_bold"
                  tooltip="Bold"
                  checked={bold}
                  onClick={() => setBold(!bold)}
                />
                <BitmapButton
                  bitmap="text_italic"
                  tooltip="Italic"
                  checked={italic}
                  onClick={() => setItalic(!italic)}
                />
                <BitmapButtonSeparator />
                {H_BUTTONS.map((b) => (
                  <BitmapButton
                    key={b.value}
                    bitmap={b.icon}
                    tooltip={b.title}
                    checked={hAlign === b.value}
                    onClick={() => setHAlign(b.value)}
                  />
                ))}
                <BitmapButtonSeparator />
                {V_BUTTONS.map((b) => (
                  <BitmapButton
                    key={b.value}
                    bitmap={b.icon}
                    tooltip={b.title}
                    checked={vAlign === b.value}
                    onClick={() => setVAlign(b.value)}
                  />
                ))}
                <BitmapButtonSeparator />
                <BitmapButton
                  bitmap="text_horizontal"
                  tooltip="Horizontal"
                  checked={angle === 0}
                  onClick={() => setAngle(0)}
                />
                <BitmapButton
                  bitmap="text_vertical"
                  tooltip="Vertical"
                  checked={angle === 90}
                  onClick={() => setAngle(90)}
                />
                <BitmapButtonSeparator />
              </div>
            </div>

            <span className="ze-lp-fmt-label">Text size:</span>
            <div className="ze-lp-sizerow">
              <input
                className="ze-lp-size"
                value={sizeText}
                onChange={(e) => setSizeText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="ze-lp-units">{unitLabel(units)}</span>
              <span className="ze-lp-colorlabel">Color:</span>
              <Swatch color={color} onChange={setColor} title="Text color" />
            </div>

            {isBox && (
              <>
                {/* row 5, empty. */}
                <div className="ze-tp-gap" />
                <label className="ze-lp-check ze-tp-span">
                  <input
                    type="checkbox"
                    checked={border}
                    onChange={(e) => setBorder(e.target.checked)}
                  />
                  Border
                  <label className="ze-lp-check ze-tp-fill">
                    <input
                      type="checkbox"
                      checked={filled}
                      onChange={(e) => setFilled(e.target.checked)}
                    />
                    Background fill
                  </label>
                </label>

                <span className="ze-lp-fmt-label">Width:</span>
                <div className="ze-lp-sizerow">
                  <input
                    className="ze-lp-size"
                    value={borderWidth}
                    disabled={!border}
                    onChange={(e) => setBorderWidth(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span className="ze-lp-units">{unitLabel(units)}</span>
                  <span className="ze-lp-colorlabel">Color:</span>
                  <Swatch color={borderColor} onChange={setBorderColor} title="Border color" />
                  <span className="ze-lp-colorlabel">Fill color:</span>
                  <Swatch color={fillColor} onChange={setFillColor} title="Fill color" />
                </div>

                <span className="ze-lp-fmt-label">Style:</span>
                <Combo
                  className="ze-lp-font"
                  value={borderStyle}
                  disabled={!border}
                  options={LINE_STYLE_NAMES.map((s) => ({ value: s.value, label: s.label }))}
                  onChange={(v) => setBorderStyle(v as LineStyleToken)}
                />
              </>
            )}

            {/* row 9, empty — the band above the Link row. */}
            <div className="ze-tp-gap" />

            {/* m_hyperlinkCb + m_hyperlinkCombo: a sheet page or a URL. */}
            <label className="ze-lp-check">
              <input
                type="checkbox"
                checked={linkOn}
                onChange={(e) => setLinkOn(e.target.checked)}
              />
              Link:
            </label>
            <div className="ze-lp-sizerow">
              <input
                className="ze-lp-value"
                list="ze-text-links"
                disabled={!linkOn}
                placeholder="#3, https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <datalist id="ze-text-links">
                {(pages ?? []).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="file://" />
                <option value="http://" />
                <option value="https://" />
              </datalist>
            </div>
          </div>
        </div>

        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={!text.trim()} onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

const H_OF: Record<number, HAlign> = {
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT]: 'left',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER]: 'center',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT]: 'right',
};
const V_OF: Record<number, VAlign> = {
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP]: 'top',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER]: 'center',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM]: 'bottom',
};

/** The message TransferDataFromWindow refuses an invalid hyperlink with. */
export const INVALID_HYPERLINK_MESSAGE =
  'Invalid hyperlink destination. Please enter either a valid URL (e.g. file:// or http(s)://) ' +
  'or "#<page number>" to create a hyperlink to a page in this schematic.';

/**
 * `DIALOG_TEXT_PROPERTIES` (eeschema/dialogs/dialog_text_properties.cpp), the schematic editor's
 * model half for a live SCH_TEXT or SCH_TEXTBOX: the values the form shows (TransferDataToWindow)
 * and the SCH_COMMIT its OK makes (TransferDataFromWindow). The symbol editor's private and
 * common-to-units boxes belong to that frame and are not here.
 */
export class DIALOG_TEXT_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_currentItem: SCH_TEXT | SCH_TEXTBOX;

  constructor(aParent: SCH_EDIT_FRAME, aItem: SCH_TEXT | SCH_TEXTBOX) {
    this.m_frame = aParent;
    this.m_currentItem = aItem;
  }

  IsTextBox(): boolean {
    return this.m_currentItem.Type() === KICAD_T.SCH_TEXTBOX_T;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): TextPropsInitial {
    const item = this.m_currentItem;
    let text = item.GetText();

    // show text variable cross-references in a human-readable format
    const schematic = item.Schematic();

    if (schematic) text = schematic.ConvertKIIDsToRefs(text);

    const values: TextPropsInitial = {
      text,
      face: item.GetFont()?.GetName() ?? '',
      bold: item.IsBold(),
      italic: item.IsItalic(),
      sizeIU: item.GetTextWidth(),
      ...(color4dToItemColor(item.GetTextColor())
        ? { color: color4dToItemColor(item.GetTextColor()) }
        : {}),
      hAlign: H_OF[item.GetHorizJustify()] ?? 'left',
      vAlign: V_OF[item.GetVertJustify()] ?? 'center',
      angle: item.GetTextAngle().IsVertical() ? 90 : 0,
      excludeFromSim: item.GetExcludedFromSim(),
      hyperlink: item.GetHyperlink(),
    };

    if (this.IsTextBox()) {
      const textBox = item as SCH_TEXTBOX;
      const style = textBox.GetStroke().GetLineStyle();

      values.border = textBox.GetWidth() >= 0;
      values.borderWidthIU = Math.max(0, textBox.GetWidth());
      const borderColor = color4dToItemColor(textBox.GetStroke().GetColor());
      if (borderColor) values.borderColor = borderColor;
      values.borderStyle = lineTypeNames.has(style)
        ? lineStyleToken(style)
        : lineStyleToken(LINE_STYLE.SOLID);
      values.filled = textBox.IsSolidFill();
      const fillColor = color4dToItemColor(textBox.GetFillColor());
      if (fillColor) values.fillColor = fillColor;
    }

    return values;
  }

  /**
   * `TransferDataFromWindow()`. Returns the error to show when the dialog must stay open
   * (an invalid hyperlink), else null.
   */
  TransferDataFromWindow(aValues: TextPropsResult): string | null {
    const item = this.m_currentItem;

    if (!EDA_TEXT.ValidateHyperlink(aValues.hyperlink)) return INVALID_HYPERLINK_MESSAGE;

    const commit = new SCH_COMMIT(this.m_frame);

    /* save old text in undo list if not already in edit */
    if (item.GetEditFlags() === 0) commit.Modify(item, this.m_frame.GetScreen());

    let text = aValues.text;

    // convert any text variable cross-references to their UUIDs
    const schematic = item.Schematic();

    if (schematic) text = schematic.ConvertRefsToKIIDs(text);

    // On Windows, a new line is coded as \r\n. We use only \n in KiCad files.
    item.SetText(text.replaceAll('\r', ''));
    item.SetExcludedFromSim(aValues.excludeFromSim);
    item.SetHyperlink(aValues.hyperlink);

    if (item.GetTextWidth() !== aValues.sizeIU)
      item.SetTextSize({ x: aValues.sizeIU, y: aValues.sizeIU });

    item.SetFont(
      aValues.face === '' ? null : FONT.GetFont(aValues.face, aValues.bold, aValues.italic),
    );

    // Must come after SetTextSize()
    item.SetBold(aValues.bold);
    item.SetItalic(aValues.italic);
    item.SetTextColor(itemColorToColor4d(aValues.color));

    item.SetHorizJustify(
      aValues.hAlign === 'right'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
        : aValues.hAlign === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
    );
    item.SetVertJustify(
      aValues.vAlign === 'bottom'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
        : aValues.vAlign === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
    );
    item.SetTextAngle(aValues.angle === 90 ? ANGLE_VERTICAL : ANGLE_HORIZONTAL);

    if (this.IsTextBox()) {
      const textBox = item as SCH_TEXTBOX;
      const stroke = textBox.GetStroke();

      if (aValues.border) stroke.SetWidth(Math.max(0, aValues.borderWidthIU ?? 0));
      else stroke.SetWidth(-1);

      const style = lineStyleOfToken(aValues.borderStyle ?? 'solid');
      stroke.SetLineStyle(lineTypeNames.has(style) ? style : LINE_STYLE.SOLID);
      stroke.SetColor(itemColorToColor4d(aValues.borderColor));
      textBox.SetStroke(stroke);

      textBox.SetFillMode(aValues.filled ? FILL_T.FILLED_WITH_COLOR : FILL_T.NO_FILL);
      textBox.SetFillColor(itemColorToColor4d(aValues.fillColor));

      textBox.ClearBoundingBoxCache();
      textBox.ClearRenderCache();

      const minBoxSize = textBox.GetMinSize();
      const start = textBox.GetStart();
      const end = { ...textBox.GetEnd() };
      let expanded = false;

      if (minBoxSize.x > 0 && Math.abs(end.x - start.x) < minBoxSize.x) {
        end.x = end.x >= start.x ? start.x + minBoxSize.x : start.x - minBoxSize.x;
        expanded = true;
      }

      if (minBoxSize.y > 0 && Math.abs(end.y - start.y) < minBoxSize.y) {
        end.y = end.y >= start.y ? start.y + minBoxSize.y : start.y - minBoxSize.y;
        expanded = true;
      }

      if (expanded) textBox.SetEnd(end);
    }

    if (!commit.Empty()) commit.Push('Edit Text Properties');

    return null;
  }
}
