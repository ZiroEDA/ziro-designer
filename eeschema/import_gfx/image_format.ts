// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which image format an embedded bitmap holds.
 *
 * `(image … (data …))` is base64 of the *original file's bytes*, whatever
 * format that file was — KiCad's Place Image accepts five:
 *
 *     _( "Image files" ) + AddFileExtListToFilter( { "png", "jpg", "jpeg", "bmp", "gif" } )
 *
 * and `REFERENCE_IMAGE` works out the format when it decodes. We stripped the
 * data URL's prefix on the way in and hardcoded `data:image/png;base64,` on the
 * way out, so a JPEG, GIF or BMP was handed to the browser labelled PNG.
 * Chrome usually sniffs its way out of that; it is still wrong, and it is the
 * kind of wrong that works until one day it doesn't.
 *
 * The format is read from the payload's leading bytes rather than from a
 * remembered mime type, so it is right for a file we never saw chosen — one
 * loaded from a `.kicad_sch` somebody else wrote.
 */

/** Base64 encodes 3 bytes per 4 characters, so these prefixes are stable. */
const SIGNATURES: readonly (readonly [string, string])[] = [
  ['iVBORw0KGgo', 'image/png'], // \x89PNG\r\n\x1a\n
  ['/9j/', 'image/jpeg'], // \xff\xd8\xff
  ['R0lGOD', 'image/gif'], // GIF87a / GIF89a
  ['Qk', 'image/bmp'], // BM
  ['PHN2Zy', 'image/svg+xml'], // "<svg"
  ['PD94bWw', 'image/svg+xml'], // "<?xml"
];

/**
 * The mime type of base64 image data, defaulting to PNG when nothing matches —
 * which is what this always assumed, and is still the right guess for a file
 * KiCad wrote.
 */
export function imageMimeType(base64: string): string {
  const head = base64.trimStart();
  for (const [sig, mime] of SIGNATURES) if (head.startsWith(sig)) return mime;
  return 'image/png';
}

/** The `src` for an embedded bitmap, with the format it actually is. */
export const imageDataUrl = (base64: string): string =>
  `data:${imageMimeType(base64)};base64,${base64}`;
