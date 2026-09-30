// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DESIGN_BLOCK_PROPERTIES` (common/dialogs/dialog_design_block_properties.cpp),
 * the logic half: the transfers between a `DESIGN_BLOCK` and the dialog's
 * name / keywords / description and its Default Fields grid. The window is
 * `dialog_design_block_properties_ui.tsx`.
 */
import type { DESIGN_BLOCK } from '../design_block.js';
import { LIB_ID } from '../lib_id.js';

/** What the dialog shows: the three text controls and the grid's rows. */
export interface DESIGN_BLOCK_PROPERTIES_VALUES {
  name: string;
  keywords: string;
  description: string;
  fields: [name: string, value: string][];
}

/** `OnAddField`'s new row name. [data] */
export const UNTITLED_FIELD = 'Untitled Field';

/** `TransferDataToWindow` + `TransferDataToGrid` (:66-83, :145-165). */
export function DesignBlockPropertiesToWindow(
  aDesignBlock: DESIGN_BLOCK,
): DESIGN_BLOCK_PROPERTIES_VALUES {
  return {
    name: aDesignBlock.GetLibId().GetLibItemName(),
    keywords: aDesignBlock.GetKeywords(),
    description: aDesignBlock.GetLibDescription(),
    fields: [...aDesignBlock.GetFields().entries()],
  };
}

/**
 * `TransferDataFromWindow` + `TransferDataFromGrid` (:86-113, :168-190).
 *
 * @return the error message the dialog shows (and stays up), or null when the
 *         design block has been updated.
 */
export function DesignBlockPropertiesFromWindow(
  aDesignBlock: DESIGN_BLOCK,
  aValues: DESIGN_BLOCK_PROPERTIES_VALUES,
): string | null {
  let illegalCh = LIB_ID.FindIllegalLibraryNameChar(aValues.name);

  // Also check for / in the name, since this is a path character which is illegal for
  // design blocks and footprints but not symbols
  if (illegalCh === 0 && aValues.name.includes('/')) illegalCh = '/'.charCodeAt(0);

  if (illegalCh)
    return `Illegal character '${String.fromCharCode(illegalCh)}' in name '${aValues.name}'.`;

  aDesignBlock.SetLibId(new LIB_ID(aDesignBlock.GetLibId().GetLibNickname(), aValues.name));
  aDesignBlock.SetLibDescription(aValues.description);
  aDesignBlock.SetKeywords(aValues.keywords);

  // TransferDataFromGrid: the fields are rebuilt row by row, so a duplicate leaves the
  // ones before it written (upstream's order; the dialog then stays up).
  aDesignBlock.GetFields().clear();

  for (const [rawName, value] of aValues.fields) {
    // `Strip()` (trailing whitespace: wxString::Strip's default), then one
    // Replace( "\n", "" ) and one Replace( "  ", " " ) pass — a single pass, so
    // four spaces become two, not one.
    const fieldName = rawName.trimEnd().replaceAll('\n', '').replaceAll('  ', ' ');

    if (aDesignBlock.GetFields().has(fieldName)) return 'Duplicate fields are not allowed.';

    aDesignBlock.GetFields().set(fieldName, value);
  }

  return null;
}
