// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DROP_FILE`, the Image Converter's drop target
 * (`bitmap2cmp_panel.cpp:576-604`). One is installed on each of the three
 * notebook pages (`:68-70`), and all three do the same thing:
 *
 *     if( m_panel->GetOutputSizeX().GetOriginalSizePixels() != 0 )
 *     {
 *         wxString cap = _( "Replace Loaded File?" );
 *         wxString msg = _( "There is already a file loaded. Do you want to replace it?" );
 *         KICAD_MESSAGE_DIALOG acceptFileDlg( m_panel, msg, cap,
 *                                             wxYES_NO | wxICON_QUESTION | wxYES_DEFAULT );
 *         if( acceptFileDlg.ShowModal() == wxID_NO )
 *             return false;
 *     }
 *
 * The strings and the flags live here, away from the React tree, so the prompt
 * can be checked without a DOM — the split `confirm.ts` makes for the
 * unsaved-changes question.
 */
import type { MessageDialogIcon, YesNoResult } from '../../ui/message_dialog.js';

/** The dialog's caption, character for character. */
export const REPLACE_LOADED_FILE_CAPTION = 'Replace Loaded File?';

/** Its message. */
export const REPLACE_LOADED_FILE_MESSAGE =
  'There is already a file loaded. Do you want to replace it?';

/** `wxICON_QUESTION`. */
export const REPLACE_LOADED_FILE_ICON: MessageDialogIcon = 'question';

/** `wxYES_DEFAULT`: Enter replaces, because dropping a file asked for that. */
export const REPLACE_LOADED_FILE_DEFAULT: YesNoResult = 'yes';

/**
 * `GetOutputSizeX().GetOriginalSizePixels() != 0` — the test for "a file is
 * already loaded". It reads the image's pixel width, not a "has a file" flag,
 * which is why the very first drop onto an empty panel is never questioned.
 */
export function askBeforeReplace(originalSizePixels: number): boolean {
  return originalSizePixels !== 0;
}

/** `OnDropFiles`' return: `wxID_NO` refuses the drop, anything else takes it. */
export function acceptDrop(answer: YesNoResult): boolean {
  return answer !== 'no';
}
