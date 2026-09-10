// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A project's name and manifest, as the server holds them: encrypted under the
 * project key, one opaque string in `projects.enc_meta`.
 *
 * `docs/encryption-plan.md` P1. What the server used to read in the clear -
 * the name, every path, every size, every plaintext hash - is in here, and
 * beside each file the key that opens its blob, wrapped under the project key.
 * Per-file keys are the reference design's choice and the reason a blob can
 * be shared between two projects or survive a key rotation without being
 * re-encrypted: only these small wraps change.
 */
import { base64ToBytes, bytesToBase64, decryptSecret, encryptSecret } from './crypto.js';

export interface EncFileEntry {
  /** The path within the project, as the manifest always named it. */
  name: string;
  /** SHA-256 of the plaintext (gzipped) bytes: the local identity, and what a download is checked against. */
  hash: string;
  /** Plaintext length. */
  size: number;
  /** The random id the ciphertext is stored under (`<owner>/blobs/<xx>/<id>`). */
  blobId: string;
  /** Ciphertext length, which is what the server's `files` entry carries. */
  encSize: number;
  /** The file's own key, wrapped under the project key. Base64. */
  encFileKey: string;
}

export interface EncMeta {
  v: 1;
  name: string;
  files: EncFileEntry[];
}

/** Encrypt the metadata for the row. */
export async function sealMeta(projectKey: Uint8Array, meta: EncMeta): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  return bytesToBase64(await encryptSecret(projectKey, bytes));
}

/** Open the row's metadata. Throws on a wrong key or a tampered row. */
export async function openMeta(projectKey: Uint8Array, encMeta: string): Promise<EncMeta> {
  const bytes = await decryptSecret(projectKey, base64ToBytes(encMeta));
  const meta = JSON.parse(new TextDecoder().decode(bytes)) as EncMeta;
  if (meta.v !== 1 || !Array.isArray(meta.files)) throw new Error('unrecognised project metadata');
  return meta;
}

/** Wrap a file key under the project key. */
export async function wrapFileKey(projectKey: Uint8Array, fileKey: Uint8Array): Promise<string> {
  return bytesToBase64(await encryptSecret(projectKey, fileKey));
}

/** Unwrap a file key. */
export async function unwrapFileKey(
  projectKey: Uint8Array,
  encFileKey: string,
): Promise<Uint8Array> {
  return decryptSecret(projectKey, base64ToBytes(encFileKey));
}
