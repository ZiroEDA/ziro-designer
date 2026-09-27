// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The text formatting bar, and the font choice beside it.
 *
 * KiCad builds the same sixteen controls into every dialog that edits a piece
 * of text — `dialog_text_properties_base.cpp:95-175`,
 * `dialog_field_properties_base.cpp:139-225`, `dialog_label_properties_base`,
 * `dialog_text_box_properties_base`, pcbnew's `dialog_text_properties_base` —
 * in one order, from two shared widgets in `common/widgets`: `FONT_CHOICE`
 * (`font_choice.cpp`) and `BITMAP_BUTTON` (`bitmap_button.cpp`). The order,
 * the bitmaps, the tooltips and the separators are all identical between them,
 * which is why they look like one control everywhere:
 *
 *     | B I | ⇤ ⇔ ⇥ | ⤒ ⇕ ⤓ | ⇉ ⇊ |
 *
 * So it is one module here too rather than a copy per dialog. The separators
 * are `BITMAP_BUTTON`s with `SetIsSeparator()`; bold and italic are
 * `SetIsCheckButton()`; the three horizontal alignments, the three vertical
 * ones and the two orientations are `SetIsRadioButton()`, each group
 * un-checking its siblings in the dialog's `onHAlignButton` / `onVAlignButton`
 * / `onOrientButton` handler (`dialog_field_properties.cpp:436-464`).
 *
 * The font list offers upstream's two BUILT-IN entries only; `FONT_CHOICE`
 * also lists the system's outline faces, which this build cannot use because
 * every face is drawn with KiCad's own stroke font (issue #154). The choice is
 * still stored, so a file that names a face keeps it.
 */
import type { JSX } from 'react';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';

/** `GR_TEXT_H_ALIGN_T` minus INDETERMINATE, which no button stands for. */
export type HAlign = 'left' | 'center' | 'right';
/** `GR_TEXT_V_ALIGN_T`, likewise. */
export type VAlign = 'top' | 'center' | 'bottom';

/** The three `m_hAlign*` buttons: bitmap and tooltip, verbatim. */
export const H_ALIGN_BUTTONS: { value: HAlign; icon: string; title: string }[] = [
  { value: 'left', icon: 'text_align_left', title: 'Align left' },
  { value: 'center', icon: 'text_align_center', title: 'Align horizontal center' },
  { value: 'right', icon: 'text_align_right', title: 'Align right' },
];

/** The three `m_vAlign*` buttons. */
export const V_ALIGN_BUTTONS: { value: VAlign; icon: string; title: string }[] = [
  { value: 'top', icon: 'text_valign_top', title: 'Align top' },
  { value: 'center', icon: 'text_valign_center', title: 'Align vertical center' },
  { value: 'bottom', icon: 'text_valign_bottom', title: 'Align bottom' },
];

export interface TextFormatBarProps {
  bold: boolean;
  onBold: (v: boolean) => void;
  italic: boolean;
  onItalic: (v: boolean) => void;
  hAlign: HAlign;
  onHAlign: (v: HAlign) => void;
  vAlign: VAlign;
  onVAlign: (v: VAlign) => void;
  /**
   * 0 or 90 — `m_horizontal` / `m_vertical`, `SetTextAngle`.
   *
   * eeschema's dialogs end the bar with this pair. Omit it when the dialog
   * ends with `m_mirrored` instead; the two are alternatives, never both.
   */
  angle?: number;
  onAngle?: (v: number) => void;
  /**
   * `m_mirrored`, the last button on **pcbnew's** bars
   * (`dialog_textbox_properties_base.h`, `dialog_text_properties_base.h`).
   *
   * A board item can be mirrored because it can sit on a back layer read
   * through the board; a schematic one cannot, and eeschema spends the same
   * slot on the horizontal/vertical orientation pair instead. Same bar, one
   * trailing group that differs — so it is a prop, not a second bar.
   */
  mirrored?: boolean;
  onMirrored?: (v: boolean) => void;
}

/** The formatting bar, in the one order every `formattingSizer` adds. */
export function TextFormatBar({
  bold,
  onBold,
  italic,
  onItalic,
  hAlign,
  onHAlign,
  vAlign,
  onVAlign,
  angle,
  onAngle,
  mirrored,
  onMirrored,
}: TextFormatBarProps): JSX.Element {
  return (
    <div className="ze-lp-iconbar">
      {/* m_separator1 */}
      <BitmapButtonSeparator />
      <BitmapButton
        bitmap="text_bold"
        tooltip="Bold"
        checked={bold}
        onClick={() => onBold(!bold)}
      />
      <BitmapButton
        bitmap="text_italic"
        tooltip="Italic"
        checked={italic}
        onClick={() => onItalic(!italic)}
      />
      {/* m_separator2 */}
      <BitmapButtonSeparator />
      {H_ALIGN_BUTTONS.map((b) => (
        <BitmapButton
          key={b.value}
          bitmap={b.icon}
          tooltip={b.title}
          checked={hAlign === b.value}
          onClick={() => onHAlign(b.value)}
        />
      ))}
      {/* m_separator3 */}
      <BitmapButtonSeparator />
      {V_ALIGN_BUTTONS.map((b) => (
        <BitmapButton
          key={b.value}
          bitmap={b.icon}
          tooltip={b.title}
          checked={vAlign === b.value}
          onClick={() => onVAlign(b.value)}
        />
      ))}
      {/* m_separator4 */}
      <BitmapButtonSeparator />
      {onMirrored ? (
        <BitmapButton
          bitmap="text_mirrored"
          tooltip="Mirrored"
          checked={mirrored === true}
          onClick={() => onMirrored(!mirrored)}
        />
      ) : (
        <>
          <BitmapButton
            bitmap="text_horizontal"
            tooltip="Horizontal text"
            checked={angle === 0}
            onClick={() => onAngle?.(0)}
          />
          <BitmapButton
            bitmap="text_vertical"
            tooltip="Vertical text"
            checked={angle === 90}
            onClick={() => onAngle?.(90)}
          />
        </>
      )}
      {/* m_separator5 */}
      <BitmapButtonSeparator />
    </div>
  );
}
