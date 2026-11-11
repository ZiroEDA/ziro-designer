// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @deprecated The plain-object (`PcbTextBox`) form, kept for the properties
 * dialog until it moves onto `PCB_TEXTBOX` (#636 stage 6). The class port is
 * `pcb_textbox.ts`; new code uses that one.
 *
 * Reading and writing a text box's properties.
 * Counterpart: `DIALOG_TEXTBOX_PROPERTIES::TransferDataToWindow` /
 * `TransferDataFromWindow` (pcbnew/dialogs/dialog_textbox_properties.cpp).
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it, and it patches the item's source node so a
 * saved file keeps everything the model does not represent.
 *
 * ## Justification is two independent axes
 *
 * `(justify …)` is one token holding up to three words — a horizontal one
 * (`left`/`right`, centre being the unwritten default), a vertical one
 * (`top`/`bottom`, likewise), and `mirror`. Upstream sets them through separate
 * `SetHorizJustify` / `SetVertJustify` / `SetMirrored` calls, so the dialog
 * edits three things that share one token. Round-tripping means rebuilding the
 * whole list from all three rather than patching a word, and it means the
 * *defaults must not be written*: emitting `center` where the file had nothing
 * changes the token every save.
 *
 * ## The border is a mode
 *
 * `border no` is a real setting — text with invisible margins — not the absence
 * of one, and the stroke stays in the file either way so the width survives
 * being toggled off and on.
 */
import { type JSX, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { PCB_TEXT_SYNTAX_HELP } from '../pcb_text_help_md.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { FIELD } from './dialog_text_properties_base.js';
import { DIALOG_TEXTBOX_PROPERTIES_BASE } from './dialog_textbox_properties_base.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import {
  LINE_STYLE,
  LINE_STYLE_NAMES,
  type LineStyleToken,
} from '@ziroeda/common/stroke_params.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_TEXTBOX } from '../pcb_textbox.js';
import type { TransferResult } from './dialog_text_properties.js';
import { _ } from '@ziroeda/wx/translation.js';

export type HorizJustify = 'left' | 'center' | 'right';
export type VertJustify = 'top' | 'center' | 'bottom';

/** Every control on the dialog, flattened. */
export interface TextBoxValues {
  text: string;
  /** `(font (face "…"))`; '' is "Default Font", the stroke font. */
  face: string;
  layer: string;
  locked: boolean;
  width: number;
  height: number;
  /** `m_autoTextThickness`: GetAutoThickness(), the pen derived from the size. */
  autoThickness: boolean;
  /** The stored pen, or the effective one when automatic (what the disabled box shows). */
  thickness: number;
  orientation: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  horizJustify: HorizJustify;
  vertJustify: VertJustify;
  border: boolean;
  borderWidth: number;
  borderStyle: LineStyleToken;
  knockout: boolean;
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
}

/** The single selected text box's index, or null. */
/**
 * Split a `(justify …)` word list into its three independent parts.
 *
 * Centre is what the file means by *saying nothing*, on both axes, which is why
 * neither `center` word appears in a KiCad file.
 */
export function splitJustify(words: readonly string[] | undefined): {
  horiz: HorizJustify;
  vert: VertJustify;
  mirrored: boolean;
} {
  const w = words ?? [];
  return {
    horiz: w.includes('left') ? 'left' : w.includes('right') ? 'right' : 'center',
    vert: w.includes('top') ? 'top' : w.includes('bottom') ? 'bottom' : 'center',
    mirrored: w.includes('mirror'),
  };
}

/**
 * Rebuild a `(justify …)` word list, omitting the defaults.
 *
 * Writing `center` back would add a word KiCad never writes, changing the file
 * on every save even when nothing was edited.
 */
export function joinJustify(horiz: HorizJustify, vert: VertJustify, mirrored: boolean): string[] {
  const out: string[] = [];
  if (horiz !== 'center') out.push(horiz);
  if (vert !== 'center') out.push(vert);
  if (mirrored) out.push('mirror');
  return out;
}

/** `TransferDataToWindow`: the dialog's starting values. */
/** `TransferDataFromWindow`, plus the source patching that makes it stick. */
// ---------------------------------------------------------------------------
// DIALOG_TEXTBOX_PROPERTIES over the live PCB_TEXTBOX (#636 stage 6)

/**
 * `DIALOG_TEXTBOX_PROPERTIES` (dialog_textbox_properties.cpp) on a live
 * PCB_TEXTBOX, OK being one BOARD_COMMIT pushed as "Edit Text Box Properties".
 *
 * The C++ dialog has no margin or knockout controls: those two fields are
 * reported (the React dialog shows them) but not written back.
 */
export class DIALOG_TEXTBOX_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_textBox: PCB_TEXTBOX;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aTextBox: PCB_TEXTBOX) {
    this.m_frame = aFrame;
    this.m_textBox = aTextBox;
  }

  /** The constructor's `m_cbLocked->Show( false )` for a footprint's text box. */
  LockedShown(): boolean {
    return this.m_textBox.GetParentFootprint() === null;
  }

  /** onBorderChecked's default: `bds.GetLineThickness( m_textBox->GetLayer() )`. */
  DefaultBorderWidth(aLayer: string): number {
    return this.m_frame.GetBoard()!.GetDesignSettings().GetLineThickness(LSET_NameToLayer(aLayer));
  }

  TransferDataToWindow(): TextBoxValues {
    const board = this.m_frame.GetBoard()!;
    const tb = this.m_textBox;
    const stroke = tb.GetStroke();

    let style = stroke.GetLineStyle();

    if (style === LINE_STYLE.DEFAULT) style = LINE_STYLE.SOLID;

    const font = tb.GetFont();

    return {
      text: board.ConvertKIIDsToCrossReferences(unescapeString(tb.GetText())),
      face: font ? font.GetName() : '',
      layer: LSET_Name(tb.GetLayer()),
      locked: tb.IsLocked(),
      width: tb.GetTextSize().x,
      height: tb.GetTextSize().y,
      autoThickness: tb.GetAutoThickness(),
      thickness: tb.GetAutoThickness() ? tb.GetEffectiveTextPenWidth() : tb.GetTextThickness(),
      orientation: new EDA_ANGLE(tb.GetTextAngle().AsDegrees()).Normalize180().AsDegrees(),
      bold: tb.IsBold(),
      italic: tb.IsItalic(),
      mirrored: tb.IsMirrored(),
      horizJustify:
        tb.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          ? 'left'
          : tb.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            ? 'right'
            : 'center',
      vertJustify:
        tb.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          ? 'top'
          : tb.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
            ? 'bottom'
            : 'center',
      border: tb.IsBorderEnabled(),
      borderWidth: stroke.GetWidth(),
      borderStyle: (LINE_STYLE_NAMES.find((d) => d.style === style)?.value ??
        'solid') as LineStyleToken,
      knockout: tb.IsKnockout(),
      marginLeft: tb.GetMarginLeft(),
      marginTop: tb.GetMarginTop(),
      marginRight: tb.GetMarginRight(),
      marginBottom: tb.GetMarginBottom(),
    };
  }

  TransferDataFromWindow(v: TextBoxValues): TransferResult {
    const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
    const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);

    for (const size of [v.width, v.height]) {
      if (size < minSize || size > maxSize) return { ok: false };
    }

    const tb = this.m_textBox;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(tb);

    // If no other command in progress, prepare undo command
    const pushCommit = tb.GetEditFlags() === 0;

    if (!pushCommit) tb.SetFlags(IN_EDIT);

    let message: string | undefined;

    const board = this.m_frame.GetBoard()!;
    const txt = board.ConvertCrossReferencesToKIIDs(v.text).replace(/\r/g, '');

    tb.SetText(EscapeString(txt, ESCAPE_CONTEXT.CTX_QUOTED_STR));
    tb.SetLocked(v.locked);
    tb.SetLayer(LSET_NameToLayer(v.layer));

    tb.SetFont(v.face === '' ? null : FONT.GetFont(v.face, v.bold, v.italic));

    tb.SetTextSize({ x: v.width, y: v.height });

    if (v.autoThickness) {
      tb.SetAutoThickness(true);
    } else {
      tb.SetTextThickness(v.thickness);

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(tb.GetTextThickness(), tb.GetTextSize());

      if (tb.GetTextThickness() > maxPenWidth) {
        message = _('The text thickness is too large for the text size.\nIt will be clamped.');
        tb.SetTextThickness(maxPenWidth);
      }
    }

    tb.SetTextAngle(new EDA_ANGLE(v.orientation).Normalize());
    tb.SetBoldFlag(v.bold);
    tb.SetItalicFlag(v.italic);

    tb.SetHorizJustify(
      v.horizJustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : v.horizJustify === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );

    tb.SetVertJustify(
      v.vertJustify === 'top'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
        : v.vertJustify === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
    );

    tb.SetMirrored(v.mirrored);

    tb.SetBorderEnabled(v.border);
    const stroke = tb.GetStroke().clone();

    stroke.SetWidth(v.borderWidth);

    const desc = LINE_STYLE_NAMES.find((d) => d.value === v.borderStyle);
    stroke.SetLineStyle(desc ? desc.style : LINE_STYLE.SOLID);

    tb.SetStroke(stroke);

    tb.ClearBoundingBoxCache();
    tb.ClearRenderCache();

    const minBoxSize = tb.GetMinSize();
    const start = tb.GetStart();
    const end = { x: tb.GetEnd().x, y: tb.GetEnd().y };
    let expanded = false;

    if (minBoxSize.x > 0 && Math.abs(end.x - start.x) < minBoxSize.x) {
      end.x = end.x >= start.x ? start.x + minBoxSize.x : start.x - minBoxSize.x;
      expanded = true;
    }

    if (minBoxSize.y > 0 && Math.abs(end.y - start.y) < minBoxSize.y) {
      end.y = end.y >= start.y ? start.y + minBoxSize.y : start.y - minBoxSize.y;
      expanded = true;
    }

    if (expanded) tb.SetEnd(end);

    if (pushCommit) commit.Push(_('Edit Text Box Properties'));

    return message ? { ok: true, message } : { ok: true };
  }
}

type LengthKey = 'width' | 'height' | 'thickness' | 'borderWidth';

/** `m_OrientCtrl`'s text: one of rot_list's entries when the angle is one of them. */
function orientationText(aDegrees: number): string {
  const turn = (a: number): number => ((a % 360) + 360) % 360;
  return ([0, 90, -90, 180].find((o) => turn(o) === turn(aDegrees)) ?? aDegrees).toFixed(1);
}

/** `ShowQuasiModal()` of DIALOG_TEXTBOX_PROPERTIES: its base over the text box's values. */
export function DialogTextBoxProperties({
  dialog,
  initial,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: {
  dialog: DIALOG_TEXTBOX_PROPERTIES;
  initial: TextBoxValues;
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for PCB_LAYER_BOX_SELECTOR's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: TextBoxValues) => void;
  onClose: () => void;
}): JSX.Element {
  const [v, setV] = useState<TextBoxValues>(initial);
  const [texts, setTexts] = useState<Partial<Record<LengthKey | 'orientation', string>>>({});
  const [syntaxHelp, setSyntaxHelp] = useState(false);
  // onFontSelected's m_thickness.Show() / m_autoTextThickness->Show().
  const [strokeShown, setStrokeShown] = useState(true);

  const set = (patch: Partial<TextBoxValues>): void => setV((p) => ({ ...p, ...patch }));

  /** onTextSize: the pen for the size and the bold state. */
  const autoPen = (aValues: TextBoxValues): number => {
    const textSize = Math.min(aValues.width, aValues.height);
    return aValues.bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize);
  };

  /** onThickness / onFontSelected: bold is whichever pen the thickness is nearer. */
  const boldFor = (aValues: TextBoxValues): boolean => {
    const textSize = Math.min(aValues.width, aValues.height);
    return (
      Math.abs(aValues.thickness - GetPenSizeForBold(textSize)) <
      Math.abs(aValues.thickness - GetPenSizeForNormal(textSize))
    );
  };

  const length = (aKey: LengthKey, aLabel: string, aTitle?: string): FIELD => ({
    label: aLabel,
    title: aTitle,
    value: texts[aKey] ?? pcbUnitText(v[aKey], units),
    units: unitLabel(units),
    onChange: (aText) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      const iu = pcbUnitValue(aText, units);
      if (!Number.isFinite(iu)) return;

      setV((p) => {
        const next = { ...p, [aKey]: iu };

        if (aKey === 'width' || aKey === 'height') {
          if (next.autoThickness) next.thickness = autoPen(next);
        } else if (aKey === 'thickness') {
          next.bold = boldFor(next);
        }

        return next;
      });

      if ((aKey === 'width' || aKey === 'height') && v.autoThickness)
        setTexts((t) => ({ ...t, thickness: undefined }));
    },
    onBlur: () => setTexts((t) => ({ ...t, [aKey]: undefined })),
  });

  return (
    <>
      <DIALOG_TEXTBOX_PROPERTIES_BASE
        m_MultiLineText={{ value: v.text, onChange: (aText) => set({ text: aText }) }}
        onSyntaxHelp={() => setSyntaxHelp(true)}
        m_cbLocked={{
          value: v.locked,
          onChange: (aOn) => set({ locked: aOn }),
          shown: dialog.LockedShown(),
        }}
        m_LayerSelectionCtrl={{
          rows: layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) })),
          value: v.layer,
          onChange: (aLayer) => set({ layer: aLayer }),
        }}
        m_orientation={{
          value: texts.orientation ?? orientationText(v.orientation),
          onChange: (aText) => {
            setTexts((t) => ({ ...t, orientation: aText }));
            const n = Number(aText);
            if (aText.trim() !== '' && Number.isFinite(n)) set({ orientation: n });
          },
        }}
        m_fontCtrl={{
          face: v.face,
          onChange: (aFace) => {
            const stroke = FONT.IsStrokeName(aFace === '' ? _('KiCad Font') : aFace);
            setStrokeShown(stroke);
            setV((p) => ({ ...p, face: aFace, ...(stroke ? { bold: boldFor(p) } : {}) }));
          },
        }}
        m_bold={{
          checked: v.bold,
          onClick: () => {
            // onBoldToggle: the thickness follows the new state.
            setV((p) => {
              const textSize = Math.min(p.width, p.height);
              const bold = !p.bold;
              return {
                ...p,
                bold,
                thickness: bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize),
              };
            });
            setTexts((t) => ({ ...t, thickness: undefined }));
          },
        }}
        m_italic={{ checked: v.italic, onClick: () => set({ italic: !v.italic }) }}
        hAlign={v.horizJustify}
        onHAlign={(aAlign) => set({ horizJustify: aAlign })}
        vAlign={v.vertJustify}
        onVAlign={(aAlign) => set({ vertJustify: aAlign })}
        m_mirrored={{ checked: v.mirrored, onClick: () => set({ mirrored: !v.mirrored }) }}
        m_textWidth={length('width', _('Text width:'), _('Text width'))}
        m_textHeight={length('height', _('Text height:'), _('Text height'))}
        m_thickness={{
          ...length('thickness', _('Thickness:'), _('Text thickness')),
          shown: strokeShown,
          enabled: !v.autoThickness,
        }}
        m_autoTextThickness={{
          checked: v.autoThickness,
          shown: strokeShown,
          onClick: () => {
            // onAutoTextThickness: checking it sets the pen from the size and disables the field.
            setV((p) =>
              p.autoThickness
                ? { ...p, autoThickness: false }
                : { ...p, autoThickness: true, thickness: autoPen(p) },
            );
            setTexts((t) => ({ ...t, thickness: undefined }));
          },
        }}
        m_borderCheckbox={{
          value: v.border,
          onChange: (aOn) => {
            // onBorderChecked: a border with no width takes the layer's line thickness.
            setV((p) => ({
              ...p,
              border: aOn,
              ...(aOn && p.borderWidth <= 0
                ? { borderWidth: dialog.DefaultBorderWidth(p.layer) }
                : {}),
            }));
            setTexts((t) => ({ ...t, borderWidth: undefined }));
          },
        }}
        m_borderWidth={{ ...length('borderWidth', _('Border width:')), enabled: v.border }}
        m_borderStyleCombo={{
          rows: LINE_STYLE_NAMES.map((s) => ({
            value: s.value,
            label: s.label,
            ...(s.bitmap ? { bitmap: bitmapUrl(s.bitmap) } : {}),
          })),
          value: v.borderStyle,
          enabled: v.border,
          onChange: (aStyle) => set({ borderStyle: aStyle as LineStyleToken }),
        }}
        onOK={() => onApply(v)}
        onCancel={onClose}
      />
      {syntaxHelp && (
        <HtmlMessageBox
          caption={_('Syntax Help')}
          className="ze-syntaxhelp"
          html={PCB_TEXT_SYNTAX_HELP}
          onClose={() => setSyntaxHelp(false)}
        />
      )}
    </>
  );
}
