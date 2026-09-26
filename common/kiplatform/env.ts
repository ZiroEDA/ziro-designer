// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIPLATFORM::ENV` (libs/kiplatform/os/unix/environment.cpp), the part the
 * path getters ask.
 */

/**
 * `GetDocumentsPath`: on Linux the XDG data directory (`~/.local/share`).
 * A page has no user home or data directory, so there is none to report and
 * the paths built on it are relative (`kicad/10.0/template/`) - nothing in
 * this app reads or writes under them.
 */
export function GetDocumentsPath(): string {
  return '';
}
