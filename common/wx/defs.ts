// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Style bits from wxWidgets 3.2 headers that the ported code passes through to the window's
 * dialogs. [data] Each value is the header's own.
 */

/** `wxOK` (wx/defs.h). */
export const wxOK = 0x00000004;
/** `wxICON_ERROR` (wx/defs.h). */
export const wxICON_ERROR = 0x00000200;
/** `wxCANCEL` (wx/defs.h). */
export const wxCANCEL = 0x00000010;
/** `wxCANCEL_DEFAULT` (wx/defs.h). */
export const wxCANCEL_DEFAULT = 0x80000000;
/** `wxICON_EXCLAMATION` / `wxICON_WARNING` (wx/defs.h): the same bit. */
export const wxICON_EXCLAMATION = 0x00000100;
export const wxICON_WARNING = wxICON_EXCLAMATION;
/** `wxCENTER` (wx/defs.h). */
export const wxCENTER = 0x0001;

/** `wxFD_OPEN` (wx/filedlg.h). */
export const wxFD_OPEN = 0x0001;
/** `wxFD_FILE_MUST_EXIST` (wx/filedlg.h). */
export const wxFD_FILE_MUST_EXIST = 0x0010;
/** `wxFD_SAVE` (wx/filedlg.h). */
export const wxFD_SAVE = 0x0002;
/** `wxFD_OVERWRITE_PROMPT` (wx/filedlg.h). */
export const wxFD_OVERWRITE_PROMPT = 0x0004;
