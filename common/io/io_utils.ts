// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/io_utils.cpp`: the header sniffs plugins use in `CanReadBoard`.
 * Upstream opens the path; these take the file's bytes (`null` when it could
 * not be read, which answers false as a failed open does).
 */

export const COMPOUND_FILE_HEADER: readonly number[] = [
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
];

/**
 * Check if a file starts with a defined string.
 *
 * @param aData the file's bytes.
 * @param aPrefix prefix string which should match with the initial characters in the file.
 * @param aIgnoreWhitespace true if whitespace characters should be ignored before the prefix.
 */
export function fileStartsWithPrefix(
  aData: Uint8Array | null,
  aPrefix: string,
  aIgnoreWhitespace: boolean,
): boolean {
  if (!aData || aData.length === 0) return false;

  // wxTextInputStream: UTF-8 lines, split on \n, \r\n or \r
  const lines = new TextDecoder().decode(aData).split(/\r\n|\n|\r/);
  let i = 0;
  let line = lines[i++] ?? '';

  if (aIgnoreWhitespace) {
    while (i < lines.length && line === '') line = (lines[i++] ?? '').trimStart();
  }

  return line.startsWith(aPrefix);
}

/**
 * Check if a file starts with a defined binary header.
 *
 * @param aData the file's bytes.
 * @param aHeader vector of bytes which need to match with the start of the file.
 * @param aOffset offset in the file where the header should be checked.
 */
export function fileHasBinaryHeader(
  aData: Uint8Array | null,
  aHeader: readonly number[],
  aOffset = 0,
): boolean {
  if (!aData || aData.length === 0) return false;

  if (aData.length < aOffset + aHeader.length) return false;

  return aHeader.every((b, i) => aData[aOffset + i] === b);
}
