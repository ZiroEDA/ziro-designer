// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** Shared file value passed between the launcher, editors, and stores. */

/** A file picked from disk for a project open. `bytes` is the byte-exact source
 * of truth (persist/archive, like KiCad's byte-stream archiver); `text` is a
 * decoded view the editors parse, valid for text files, unused for binaries. */
export interface PickedHomeFile {
  name: string;
  text: string;
  bytes?: Uint8Array;
}
