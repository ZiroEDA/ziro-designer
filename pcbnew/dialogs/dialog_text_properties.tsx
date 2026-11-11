// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text properties for a board graphic text, headless.
 * Counterpart: `pcbnew/dialogs/dialog_text_properties.cpp`. Shape properties,
 * which shared this file until they were split along KiCad's own dialog
 * boundary, are `dialog_shape_properties.ts`.
 *
 * Single-item, so no three-state fold. Each applied field patches the item's
 * source node in step, since the writer emits a stored source verbatim.
 */

import { type JSX, useState } from 'react';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { PCB_TEXT_SYNTAX_HELP } from '../pcb_text_help_md.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import { DIALOG_TEXT_PROPERTIES_BASE, type FIELD } from './dialog_text_properties_base.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_FIELD } from '../pcb_field.js';
import type { PCB_TEXT } from '../pcb_text.js';
import { _ } from '@ziroeda/wx/translation.js';

/** Every field DIALOG_TEXT_PROPERTIES edits, for a board text item. */
export interface TextValues {
  text: string;
  /**
   * `(font (face "…"))`, bound to the dialog's FONT_CHOICE. '' is "Default
   * Font", i.e. no `(face …)` in the file, which is what
   * `GetFont()->GetName().IsEmpty()` means upstream.
   */
  face: string;
  x: number;
  y: number;
  /** Degrees. */
  orientation: number;
  layer: string;
  /** Glyph box, IU. */
  width: number;
  height: number;
  /**
   * `EDA_TEXT::GetAutoThickness()`, which is `GetTextThickness() == 0`
   * (eda_text.h:150) — the pen width is derived from the glyph size rather than
   * stored. `EDA_TEXT::Format` then writes `(thickness …)` only
   * `if( !GetAutoThickness() )` (eda_text.cpp:1079-1084), so the token's absence
   * and a stored zero are the same thing and both mean automatic.
   */
  autoThickness: boolean;
  /**
   * `GetTextThicknessProperty()` (eda_text.h:141-147): the stored thickness, or
   * the width the text is actually drawn with when that is automatic — which is
   * what DIALOG_TEXT_PROPERTIES puts in the (disabled) box too (:328-333). So
   * turning Auto Thickness off writes the pen the text already had, rather than
   * dropping it to zero.
   */
  thickness: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  /**
   * `GR_TEXT_H_ALIGN_T` / `GR_TEXT_V_ALIGN_T`, the `(justify …)` words. CENTER
   * is the default in both axes and writes no word, which is why the token is
   * absent on most text.
   */
  hJustify: 'left' | 'center' | 'right';
  vJustify: 'top' | 'center' | 'bottom';
  /** `(hide yes)` — the item is kept but not drawn or plotted. */
  hidden: boolean;
  /** `(knockout)`: the glyphs are cut out of a filled box. */
  knockout: boolean;
  locked: boolean;
  /** `m_KeepUpright`, written only where the window shows it (footprint text). */
  keepUpright: boolean;
}

/** What the constructor shows and labels for this item (dialog_text_properties.cpp:118-170,306-316). */
export interface TextWindowShape {
  title: string;
  /** m_MultiLineSizer for a board text; m_SingleLineSizer for a footprint's. */
  multiLine: boolean;
  /** `m_TextLabel`. */
  textLabel: string;
  /** "Offset X:" / "Offset Y:" for a footprint's text. */
  posXLabel: string;
  posYLabel: string;
  lockedShown: boolean;
  visibleShown: boolean;
  keepUprightShown: boolean;
  /** `m_statusLine`, or null when it is hidden. */
  statusLine: string | null;
}

/** DIALOG_TEXT_PROPERTIES::TransferDataToWindow. */
/** The `(justify …)` words `EDA_TEXT::Format` writes, for the model to carry. */
/** DIALOG_TEXT_PROPERTIES::TransferDataFromWindow. */
// ---------------------------------------------------------------------------
// DIALOG_TEXT_PROPERTIES over the live PCB_TEXT (#636 stage 6)

/** What OK reports: false keeps the dialog open; `message` is DisplayError's text. */
export interface TransferResult {
  ok: boolean;
  message?: string;
}

/**
 * `DIALOG_TEXT_PROPERTIES` (dialog_text_properties.cpp) on a live PCB_TEXT or
 * PCB_FIELD: `TransferDataToWindow` reads the item into the controls,
 * `TransferDataFromWindow` writes them back inside one BOARD_COMMIT pushed as
 * "Edit Text Properties".
 *
 * `m_Visible` is shown for a field only and `m_KeepUpright` for text inside a
 * footprint (the constructor, :150-170), so those two are written only then.
 */
export class DIALOG_TEXT_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_item: PCB_TEXT;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aItem: PCB_TEXT) {
    this.m_frame = aFrame;
    this.m_item = aItem;
  }

  private isField(): boolean {
    return this.m_item.Type() === KICAD_T.PCB_FIELD_T;
  }

  /** The constructor's Show() / SetLabel() / SetTitle() for this item. */
  GetWindowShape(): TextWindowShape {
    const parentFP = this.m_item.GetParentFootprint();

    if (!parentFP) {
      return {
        title: _('Text Properties'),
        multiLine: true,
        textLabel: _('Reference designator:'),
        posXLabel: _('Position X:'),
        posYLabel: _('Position Y:'),
        lockedShown: true,
        visibleShown: false,
        keepUprightShown: false,
        statusLine: null,
      };
    }

    let title = _('Footprint Text Properties');
    let textLabel = _('Text:');

    if (this.isField()) {
      const field = this.m_item as PCB_FIELD;

      if (field.IsReference()) {
        title = _('Footprint Reference Properties');
        textLabel = _('Reference:');
      } else if (field.IsValue()) {
        title = _('Footprint Value Properties');
        textLabel = _('Value:');
      } else {
        title = _('Footprint Field Properties');
      }
    }

    const side = parentFP.IsFlipped() ? _('back side (mirrored)') : _('front side');
    const rotated = parentFP.GetOrientation().AsDegrees().toFixed(1);

    return {
      title,
      multiLine: false,
      textLabel,
      posXLabel: _('Offset X:'),
      posYLabel: _('Offset Y:'),
      lockedShown: !this.m_frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR),
      visibleShown: this.isField(),
      keepUprightShown: true,
      statusLine: `Footprint ${parentFP.GetReference()} (${parentFP.GetValue()}), ${side}, rotated ${rotated} deg`,
    };
  }

  TransferDataToWindow(): TextValues {
    const board = this.m_frame.GetBoard()!;
    const item = this.m_item;

    // show text variable cross-references in a human-readable format
    const text = board.ConvertKIIDsToCrossReferences(unescapeString(item.GetText()));

    const font = item.GetFont();
    const pos = item.GetFPRelativePosition();

    return {
      text,
      face: font ? font.GetName() : '',
      x: pos.x,
      y: pos.y,
      orientation: new EDA_ANGLE(item.GetTextAngle().AsDegrees()).Normalize180().AsDegrees(),
      layer: LSET_Name(item.GetLayer()),
      width: item.GetTextSize().x,
      height: item.GetTextSize().y,
      autoThickness: item.GetAutoThickness(),
      thickness: item.GetAutoThickness()
        ? item.GetEffectiveTextPenWidth()
        : item.GetTextThickness(),
      bold: item.IsBold(),
      italic: item.IsItalic(),
      mirrored: item.IsMirrored(),
      hJustify:
        item.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          ? 'left'
          : item.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            ? 'right'
            : 'center',
      vJustify:
        item.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          ? 'top'
          : item.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
            ? 'bottom'
            : 'center',
      hidden: !item.IsVisible(),
      knockout: item.IsKnockout(),
      locked: item.IsLocked(),
      keepUpright: item.IsKeepUpright(),
    };
  }

  TransferDataFromWindow(v: TextValues): TransferResult {
    const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
    const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);

    // m_textWidth.Validate( minSize, maxSize ) / m_textHeight.Validate( … )
    for (const size of [v.width, v.height]) {
      if (size < minSize || size > maxSize) return { ok: false };
    }

    const board = this.m_frame.GetBoard()!;
    const item = this.m_item;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(item);

    // If no other command in progress, prepare undo command
    const pushCommit = item.GetEditFlags() === 0;

    if (!pushCommit) item.SetFlags(IN_EDIT);

    let message: string | undefined;

    const shape = this.GetWindowShape();

    // Set the new text content. A footprint's text is the single-line control; a board text
    // the multi-line one, whose value is escaped for the file.
    if (v.text !== '') {
      // convert any text variable cross-references to their UUIDs
      const txt = board.ConvertCrossReferencesToKIIDs(v.text);

      if (!shape.multiLine) item.SetText(txt);
      else item.SetText(EscapeString(txt.replace(/\r/g, ''), ESCAPE_CONTEXT.CTX_QUOTED_STR));
    }

    item.SetLocked(v.locked);

    item.SetLayer(LSET_NameToLayer(v.layer));
    item.SetIsKnockout(v.knockout);

    // m_fontCtrl->GetFontSelection( bold, italic )
    item.SetFont(v.face === '' ? null : FONT.GetFont(v.face, v.bold, v.italic));

    item.SetTextSize({ x: v.width, y: v.height });

    if (v.autoThickness) {
      item.SetAutoThickness(true);
    } else {
      item.SetTextThickness(v.thickness);

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(item.GetTextThickness(), item.GetTextSize());

      if (item.GetTextThickness() > maxPenWidth) {
        message = _('The text thickness is too large for the text size.\nIt will be clamped.');
        item.SetTextThickness(maxPenWidth);
      }
    }

    item.SetFPRelativePosition({ x: v.x, y: v.y });
    item.SetTextAngle(new EDA_ANGLE(v.orientation).Normalize());

    if (shape.visibleShown) (item as PCB_FIELD).SetVisible(!v.hidden);

    if (shape.keepUprightShown) item.SetKeepUpright(v.keepUpright);

    item.SetBoldFlag(v.bold);
    item.SetItalicFlag(v.italic);

    item.SetHorizJustify(
      v.hJustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : v.hJustify === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );

    item.SetVertJustify(
      v.vJustify === 'bottom'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
        : v.vJustify === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
    );

    item.SetMirrored(v.mirrored);

    if (pushCommit) commit.Push(_('Edit Text Properties'));

    return message ? { ok: true, message } : { ok: true };
  }
}

type LengthKey = 'width' | 'height' | 'thickness' | 'x' | 'y';

/** `m_OrientCtrl`'s text: one of its four entries when the angle is one of them. */
function orientationText(aDegrees: number): string {
  const turn = (a: number): number => ((a % 360) + 360) % 360;
  return ([0, 90, -90, 180].find((o) => turn(o) === turn(aDegrees)) ?? aDegrees).toFixed(1);
}

/** `ShowModal()` of DIALOG_TEXT_PROPERTIES: its base over the item's values. */
export function DialogTextProperties({
  initial,
  shape,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: {
  initial: TextValues;
  shape: TextWindowShape;
  /** The frame's units; Width, Height, Thickness and both positions are UNIT_BINDERs. */
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for PCB_LAYER_BOX_SELECTOR's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: TextValues) => void;
  onClose: () => void;
}): JSX.Element {
  const [v, setV] = useState<TextValues>(initial);
  const [texts, setTexts] = useState<Partial<Record<LengthKey | 'orientation', string>>>({});
  const [syntaxHelp, setSyntaxHelp] = useState(false);
  // onFontSelected's m_thickness.Show() / m_autoTextThickness->Show().
  const [strokeShown, setStrokeShown] = useState(true);

  const set = (patch: Partial<TextValues>): void => setV((p) => ({ ...p, ...patch }));

  /** onTextSize: with auto thickness, the pen for the new size and the bold state. */
  const autoPen = (aValues: TextValues): number => {
    const textSize = Math.min(aValues.width, aValues.height);
    return aValues.bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize);
  };

  /** onThickness / onFontSelected: bold is whichever pen the thickness is nearer. */
  const boldFor = (aValues: TextValues): boolean => {
    const textSize = Math.min(aValues.width, aValues.height);
    return (
      Math.abs(aValues.thickness - GetPenSizeForBold(textSize)) <
      Math.abs(aValues.thickness - GetPenSizeForNormal(textSize))
    );
  };

  const length = (aKey: LengthKey, aLabel: string, aTitle: string): FIELD => ({
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

  const ok = (): void => onApply(v);

  return (
    <>
      <DIALOG_TEXT_PROPERTIES_BASE
        title={shape.title}
        multiLine={shape.multiLine}
        m_MultiLineText={{ value: v.text, onChange: (aText) => set({ text: aText }) }}
        onSyntaxHelp={() => setSyntaxHelp(true)}
        m_TextLabel={shape.textLabel}
        m_SingleLineText={{ value: v.text, onChange: (aText) => set({ text: aText }) }}
        m_cbLocked={{
          value: v.locked,
          onChange: (aOn) => set({ locked: aOn }),
          shown: shape.lockedShown,
        }}
        m_LayerSelectionCtrl={{
          rows: layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) })),
          value: v.layer,
          onChange: (aLayer) => set({ layer: aLayer }),
        }}
        m_cbKnockout={{ value: v.knockout, onChange: (aOn) => set({ knockout: aOn }) }}
        m_KeepUpright={{
          value: v.keepUpright,
          onChange: (aOn) => set({ keepUpright: aOn }),
          shown: shape.keepUprightShown,
        }}
        m_Visible={{
          value: !v.hidden,
          onChange: (aOn) => set({ hidden: !aOn }),
          shown: shape.visibleShown,
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
        hAlign={v.hJustify}
        onHAlign={(aAlign) => set({ hJustify: aAlign })}
        vAlign={v.vJustify}
        onVAlign={(aAlign) => set({ vJustify: aAlign })}
        m_mirrored={{ checked: v.mirrored, onClick: () => set({ mirrored: !v.mirrored }) }}
        m_textWidth={length('width', _('Width:'), _('Text width'))}
        m_textHeight={length('height', _('Height:'), _('Text height'))}
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
        m_posX={length('x', shape.posXLabel, _('Text pos X'))}
        m_posY={length('y', shape.posYLabel, _('Text pos Y'))}
        m_orientation={{
          value: texts.orientation ?? orientationText(v.orientation),
          onChange: (aText) => {
            setTexts((t) => ({ ...t, orientation: aText }));
            const n = Number(aText);
            if (aText.trim() !== '' && Number.isFinite(n)) set({ orientation: n });
          },
        }}
        m_statusLine={shape.statusLine}
        onOK={ok}
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
