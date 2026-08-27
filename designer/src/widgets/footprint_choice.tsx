// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOICE` — `common/widgets/footprint_choice.cpp`.
 *
 * The class comment upstream says what it is for
 * (`include/widgets/footprint_choice.h:25-37`):
 *
 *     Customized combo box for footprint selection. This provides the
 *     following features:
 *
 *     - library name is greyed out for readability when lib:footprint format
 *       is found in the item text
 *     - empty items are displayed as nonselectable separators
 *
 *     For any items containing footprints, the "lib:footprint" name should be
 *     attached to the item as a wxStringClientData.
 *
 * Neither is expressible in a native `<select>`, whose option list the browser
 * draws: an `<option>` is one run of text in one colour, and an empty one is a
 * blank row rather than a rule. So this is an `OwnerDrawnCombo` — our
 * `wxOwnerDrawnComboBox` — and the function below is its `OnDrawItem`.
 */
import type { JSX, ReactNode } from 'react';
import { OwnerDrawnCombo, type DrawItemFlags, type OwnerDrawnItem } from '../ui/OwnerDrawnCombo.js';

/**
 * The half of `FOOTPRINT_CHOICE::OnDrawItem` that decides *what* is greyed
 * (`common/widgets/footprint_choice.cpp:85-103`):
 *
 *     // If this item has a footprint and that footprint has a ":" delimiter,
 *     // find the library component, then find that in the display string and
 *     // grey it out.
 *     size_t start_grey = 0;
 *     size_t end_grey = 0;
 *
 *     wxString lib = static_cast<wxStringClientData*>( GetClientObject( aItem ) )->GetData();
 *     size_t   colon_index = lib.rfind( ':' );
 *
 *     if( colon_index != wxString::npos )
 *     {
 *         wxString library_part = lib.SubString( 0, colon_index );
 *         size_t   library_index = text.rfind( library_part );
 *
 *         if( library_index != wxString::npos )
 *         {
 *             start_grey = library_index;
 *             end_grey = start_grey + library_part.Length();
 *         }
 *     }
 *
 * Three things about it are load-bearing and easy to lose:
 *
 * 1. the fragment runs up to and **including** the last colon —
 *    `SubString( 0, colon_index )` is inclusive of `colon_index`, so
 *    "TerminalBlock:TB_1x02" greys "TerminalBlock:" and not "TerminalBlock";
 * 2. the library comes from the CLIENT DATA and is then searched for in the
 *    DISPLAY STRING, which are deliberately different texts — the default row
 *    reads "[Default] TerminalBlock:TB_1x02" while its client data is the bare
 *    "TerminalBlock:TB_1x02", and that is exactly why the "[Default] " prefix
 *    stays bright;
 * 3. no colon, or a library the display string does not contain, leaves
 *    `start === end`, which is the "grey nothing" case.
 *
 * @param text        `GetString( aItem )`, what is drawn
 * @param clientData  the `wxStringClientData`, the "lib:footprint" LIB_ID
 */
export function greyRange(text: string, clientData: string): { start: number; end: number } {
  let start = 0;
  let end = 0;

  const colonIndex = clientData.lastIndexOf(':');

  if (colonIndex !== -1) {
    // `SubString( 0, colon_index )` — inclusive of the colon, hence `+ 1`.
    const libraryPart = clientData.slice(0, colonIndex + 1);
    const libraryIndex = text.lastIndexOf(libraryPart);

    if (libraryIndex !== -1) {
      start = libraryIndex;
      end = start + libraryPart.length;
    }
  }

  return { start, end };
}

/**
 * `FOOTPRINT_CHOICE::OnDrawItem` (`footprint_choice.cpp:58-122`).
 *
 * The separator half:
 *
 *     if( text == wxEmptyString )
 *     {
 *         wxPen pen( m_grey, 1, wxPENSTYLE_SOLID );
 *
 *         aDC.SetPen( pen );
 *         aDC.DrawLine( aRect.x, aRect.y + aRect.height / 2, aRect.x + aRect.width,
 *                       aRect.y + aRect.height / 2 );
 *     }
 *
 * is `OwnerDrawnCombo`'s, because "an empty item is a rule, not a blank row" is
 * the widget's own contract; this function is only ever called for a row that
 * has text.
 *
 * The greying half:
 *
 *     if( start_grey != end_grey && !( aFlags & wxODCB_PAINTING_SELECTED ) )
 *     {
 *         x = DrawTextFragment( aDC, x, y, text.SubString( 0, start_grey - 1 ) );
 *
 *         wxColour standard_color = aDC.GetTextForeground();
 *
 *         aDC.SetTextForeground( m_grey );
 *         x = DrawTextFragment( aDC, x, y, text.SubString( start_grey, end_grey - 1 ) );
 *
 *         aDC.SetTextForeground( standard_color );
 *         x = DrawTextFragment( aDC, x, y, text.SubString( end_grey, text.Length() - 1 ) );
 *     }
 *     else
 *     {
 *         aDC.DrawText( text, x, y );
 *     }
 *
 * Note `!( aFlags & wxODCB_PAINTING_SELECTED )`: the highlighted row is drawn in
 * ONE flat colour, and so is a focused closed box. That is not an accident of
 * the palette — grey on the orange highlight would be unreadable — and it is
 * why the top row of the real Choose Symbol screenshot has no dim prefix while
 * every row under it does.
 */
export function drawFootprintItem(item: OwnerDrawnItem, flags: DrawItemFlags): ReactNode {
  const text = item.label;
  const { start, end } = greyRange(text, item.value);

  if (start === end || flags.selected) return text;

  return (
    <>
      {/* `text.SubString( 0, start_grey - 1 )`; wx's SubString of (0, -1) is the
          empty string, and so is `slice( 0, 0 )`. */}
      {text.slice(0, start)}
      <span className="ze-fp-lib">{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

export interface FootprintChoiceProps {
  /** `Append( label, new wxStringClientData( value ) )`, in order. */
  items: readonly OwnerDrawnItem[];
  /** The selected entry's client data. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function FootprintChoice({
  items,
  value,
  onChange,
  disabled,
  ariaLabel,
}: FootprintChoiceProps): JSX.Element {
  return (
    <OwnerDrawnCombo
      className="ze-fp-choice"
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      drawItem={drawFootprintItem}
    />
  );
}
