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
import { toolbarIconUrl } from './toolbarIcons.js';
import { Combo } from './Combo.js';

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

/**
 * `BITMAP_BUTTON`, which draws its bitmap with no border of its own
 * (`wxBU_AUTODRAW|wxBORDER_NONE`) and paints a checked state itself.
 */
export function IconButton({
  icon,
  title,
  checked,
  onClick,
}: {
  icon: string;
  title: string;
  checked?: boolean;
  onClick: () => void;
}): JSX.Element {
  const url = toolbarIconUrl(icon);
  return (
    <button
      type="button"
      className={`ze-lp-iconbtn${checked ? ' checked' : ''}`}
      title={title}
      aria-pressed={checked ?? false}
      onClick={onClick}
    >
      {url ? <img src={url} alt={title} /> : title}
    </button>
  );
}

/**
 * `FONT_CHOICE` (`common/widgets/font_choice.cpp`), whose two built-in entries
 * the generated bases spell "Default Font" and "KiCad Font".
 */
/** `wxString m_fontCtrlChoices[] = { _( "Default Font" ), _( "KiCad Font" ) };`
 *  (`dialog_field_properties_base.cpp:142`). Upstream appends the installed
 *  faces after these two; a browser cannot enumerate them. */
const FONT_OPTIONS = [
  { value: 'Default Font', label: 'Default Font' },
  { value: 'KiCad Font', label: 'KiCad Font' },
];

export function FontChoice({
  face,
  onChange,
}: {
  /** '' is `Default Font`, i.e. no `(font (face …))` in the file. */
  face: string;
  onChange: (face: string) => void;
}): JSX.Element {
  // `FONT_CHOICE` is a **wxOwnerDrawnComboBox** (`font_choice.h:28`), not a
  // wxChoice and certainly not a native dropdown: it draws its own rows so it
  // can render each face in that face. `Combo` is our owner-drawn one, the
  // same widget the toolbars' grid and zoom selectors use, so this asks for it
  // rather than falling back to the browser's `<select>` chrome — which is the
  // one control in these dialogs that was not ours.
  return (
    <Combo
      className="ze-lp-font"
      title="Text is drawn with KiCad's own font in the browser build."
      value={face === '' ? 'Default Font' : face}
      options={FONT_OPTIONS}
      onChange={(v) => onChange(v === 'Default Font' ? '' : v)}
    />
  );
}

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
      <span className="ze-lp-sep" />
      <IconButton icon="text_bold" title="Bold" checked={bold} onClick={() => onBold(!bold)} />
      <IconButton
        icon="text_italic"
        title="Italic"
        checked={italic}
        onClick={() => onItalic(!italic)}
      />
      {/* m_separator2 */}
      <span className="ze-lp-sep" />
      {H_ALIGN_BUTTONS.map((b) => (
        <IconButton
          key={b.value}
          icon={b.icon}
          title={b.title}
          checked={hAlign === b.value}
          onClick={() => onHAlign(b.value)}
        />
      ))}
      {/* m_separator3 */}
      <span className="ze-lp-sep" />
      {V_ALIGN_BUTTONS.map((b) => (
        <IconButton
          key={b.value}
          icon={b.icon}
          title={b.title}
          checked={vAlign === b.value}
          onClick={() => onVAlign(b.value)}
        />
      ))}
      {/* m_separator4 */}
      <span className="ze-lp-sep" />
      {onMirrored ? (
        <IconButton
          icon="text_mirrored"
          title="Mirrored"
          checked={mirrored === true}
          onClick={() => onMirrored(!mirrored)}
        />
      ) : (
        <>
          <IconButton
            icon="text_horizontal"
            title="Horizontal text"
            checked={angle === 0}
            onClick={() => onAngle?.(0)}
          />
          <IconButton
            icon="text_vertical"
            title="Vertical text"
            checked={angle === 90}
            onClick={() => onAngle?.(90)}
          />
        </>
      )}
      {/* m_separator5 */}
      <span className="ze-lp-sep" />
    </div>
  );
}
