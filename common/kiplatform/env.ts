// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIPLATFORM::ENV` (libs/kiplatform/os/unix/environment.cpp), the part the
 * path getters ask.
 */

/**
 * `GetDocumentsPath`: on Linux the XDG data directory, `g_get_user_data_dir()`
 * (`$HOME/.local/share`). A page has no home; GLib's answer when there is
 * none is `/`, so this is `/.local/share` - a directory nothing is mounted at,
 * so nothing reads or writes under it.
 */
export function GetDocumentsPath(): string {
  return '/.local/share';
}

/**
 * `GetUserCachePath`: `g_get_user_cache_dir()`, `$HOME/.cache` - `/.cache`
 * with no home, as for the documents path. `PATHS::EnsurePathExists` cannot
 * make a folder there, so a cached file lands in KiCad's own fallback, the
 * temp directory.
 */
export function GetUserCachePath(): string {
  return '/.cache';
}
