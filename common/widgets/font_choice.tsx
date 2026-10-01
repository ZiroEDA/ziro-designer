// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FONT_CHOICE` (`include/widgets/font_choice.h`, `common/widgets/font_choice.cpp`):
 * the face picker every text dialog carries beside its formatting bar, and
 * `FONT_LIST_MANAGER`, the list of installed families it offers.
 */

import type { JSX } from 'react';
import { INDETERMINATE_ACTION } from './ui_common.js';
import { BUNDLED_FONTS } from '../font/fontconfig.js';
import { Combo, type ComboOption } from './wx_combobox.js';

/**
 * The families the catalogue holds, in the order `FONT_LIST_MANAGER` would
 * list them — `FONTCONFIG::ListFonts` collects family names into a
 * `std::set<std::string>` (fontconfig.cpp:395-470), so they come out sorted
 * by codepoint, never by locale.
 */
export const BUNDLED_FAMILIES: readonly string[] = [
  ...new Set(BUNDLED_FONTS.map((f) => f.family)),
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** `FONT_CHOICE::OnDrawItem`'s `c_sampleString`. */
export const FONT_SAMPLE = 'AaBbCcDd123456';

/**
 * `FONT_CHOICE::RefreshFonts` (common/widgets/font_choice.cpp:227-262): the
 * two built-ins — `wxString m_fontCtrlChoices[] = { _( "Default Font" ),
 * _( "KiCad Font" ) }` (`dialog_field_properties_base.cpp:142`) — then
 * `FONT_LIST_MANAGER::Get().GetFonts()`, which is fontconfig's list of the
 * installed families. A browser cannot enumerate the machine's fonts; what it
 * has is the catalogue `fontconfig.ts` serves, the same families the
 * substitutions land on, so those are the "installed" faces here.
 *
 * `OnDrawItem` draws every installed face's row with a specimen in that
 * face (:355-369); the `sample` on each option is that, and the faces come
 * from the `@font-face` rules `installOutlineFontFaces` declares over the
 * same files the renderer fills glyphs from.
 */
const FONT_OPTIONS: ComboOption[] = [
  { value: 'Default Font', label: 'Default Font' },
  { value: 'KiCad Font', label: 'KiCad Font' },
  ...BUNDLED_FAMILIES.map((family) => ({
    value: family,
    label: family,
    sample: { text: FONT_SAMPLE, fontFamily: `"${family}"` },
  })),
];

/** `FONT_CHOICE::m_notFound`: `wxS( " " ) + _( "<not found>" )`. */
const NOT_FOUND = ' <not found>';

export function FontChoice({
  face,
  onChange,
  indeterminate = false,
  disabled = false,
}: {
  /** '' is `Default Font`, i.e. no `(font (face …))` in the file. */
  face: string;
  onChange: (face: string) => void;
  /** `SetHasIndeterminateChoice()`: a last row, "-- leave unchanged --". */
  indeterminate?: boolean;
  disabled?: boolean;
}): JSX.Element {
  // `FONT_CHOICE` is a **wxOwnerDrawnComboBox** (`font_choice.h:28`), not a
  // wxChoice and certainly not a native dropdown: it draws its own rows so it
  // can render each face in that face. `Combo` is our owner-drawn one, the
  // same widget the toolbars' grid and zoom selectors use, so this asks for it
  // rather than falling back to the browser's `<select>` chrome — which is the
  // one control in these dialogs that was not ours.
  //
  // `SetFontSelection` (:269-285): a face the list does not hold — "Arial" in
  // a file authored on a machine that had it — is appended as
  // `name + m_notFound` and selected; its value stays the face, so OK keeps
  // what the file said.
  const value = face === '' ? 'Default Font' : face;
  const base = indeterminate
    ? [...FONT_OPTIONS, { value: INDETERMINATE_ACTION, label: INDETERMINATE_ACTION }]
    : FONT_OPTIONS;
  const options = base.some((o) => o.value === value)
    ? base
    : [...base, { value, label: `${value}${NOT_FOUND}` }];
  return (
    <Combo
      className="ze-lp-font"
      value={value}
      options={options}
      disabled={disabled}
      onChange={(v) => onChange(v === 'Default Font' ? '' : v)}
    />
  );
}
