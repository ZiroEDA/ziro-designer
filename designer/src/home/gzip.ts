// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * gzip, for everything here that stores bytes.
 *
 * KiCad text compresses about tenfold - the 80 MB Jetson board lands near 8 MB
 * - so nothing in this app stores a project file uncompressed. That was worth
 * writing once and had been written twice, in projectStore.ts and in
 * cloud/templateSync.ts, character for character apart from a variable name.
 * The local history store would have been the third.
 *
 * Both directions degrade rather than fail. `CompressionStream` is not
 * universal, so a browser without it stores raw bytes; the reader checks the
 * gzip magic instead of trusting a flag, which is what lets records written by
 * either kind of browser - or by the older text-based store, before any of this
 * was compressed - stay readable by the other.
 */

const hasCompression = typeof CompressionStream !== 'undefined';

/** Compress, or hand the bytes back where the browser cannot. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasCompression) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decompress, detecting by content rather than by a stored flag.
 *
 * `0x1f 0x8b` is the gzip magic. Anything else is returned as it came, which is
 * the case for bytes written by a browser with no `CompressionStream` and for
 * anything predating compression.
 */
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const isGz = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (!isGz || typeof DecompressionStream === 'undefined') return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
