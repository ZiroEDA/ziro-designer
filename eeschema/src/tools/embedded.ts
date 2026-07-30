// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Embedded files. Counterpart: `common/embedded_files.cpp` (EMBEDDED_FILES),
 * the `.kicad_sch` `(embedded_files (file (name ..) (type ..) (data ..)
 * (checksum ..)))` section plus the `(embedded_fonts yes|no)` flag.
 *
 * Blobs are zstd-compressed (level 15, `CompressAndEncode`) and base64-encoded
 * in 76-column lines between `|` delimiters; the checksum is MurmurHash3
 * x64_128 of the *decompressed* bytes with seed `EMBEDDED_FILES::Seed()`
 * (0xABBA2345), printed %016X%016X. Reading validates against that hash, then
 * the pre-fix V1 tail variant, and 64-char checksums as legacy SHA-256
 * (`DecompressAndDecode`). File types follow AddFile's extension table, the
 * collection stays name-sorted (std::map), and references use KiCad's
 * `kicad-embed://` URI scheme.
 */

import { init as zstdInit, compress, decompress } from '@bokuweb/zstd-wasm';

// zstd-wasm's init() is not idempotent (re-instantiating corrupts the module
// state), so every entry point awaits this single shared initialisation.
let zstdReady: Promise<unknown> | undefined;
const ensureZstd = (): Promise<unknown> => {
  zstdReady ??= zstdInit();
  return zstdReady;
};
import { mmh3HashToString, mmh3HashToStringV1 } from '@ziroeda/kimath';
import { isList, head, list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { arg, childNamed } from '@ziroeda/sexpr/src/query.js';
import type { EditCommand } from './command.js';
import type { Schematic } from '../types.js';

export interface EmbeddedFileInfo {
  name: string;
  /** `kicad-embed://<name>`, how other fields reference the file. */
  reference: string;
  /** The `(type ..)` token: font | model | worksheet | datasheet | other. */
  type?: string;
}

/** List the schematic's embedded files and the embed-fonts flag from its
 *  lossless source AST. */
export function listEmbeddedFiles(sch: Schematic): {
  files: EmbeddedFileInfo[];
  embedFonts: boolean;
} {
  const files: EmbeddedFileInfo[] = [];
  let embedFonts = false;
  for (const node of sch.source.items) {
    if (!isList(node)) continue;
    const kind = head(node);
    if (kind === 'embedded_fonts') {
      embedFonts = arg(node, 0) === 'yes';
    } else if (kind === 'embedded_files') {
      for (const f of node.items) {
        if (!isList(f) || head(f) !== 'file') continue;
        const nameNode = childNamed(f, 'name');
        const name = nameNode ? (arg(nameNode, 0) ?? '') : '';
        if (!name) continue;
        const typeNode = childNamed(f, 'type');
        const info: EmbeddedFileInfo = { name, reference: `kicad-embed://${name}` };
        const type = typeNode ? arg(typeNode, 0) : undefined;
        if (type !== undefined) info.type = type;
        files.push(info);
      }
    }
  }
  return { files, embedFonts };
}

/** EMBEDDED_FILES::Seed(). */
export const EMBEDDED_FILES_SEED = 0xabba2345;

/** AddFile's extension table: STP/STPZ/STEP/WRL/WRZ → model, WOFF/WOFF2/TTF/
 *  OTF → font, PDF → datasheet, KICAD_WKS → worksheet, else other. */
export function embeddedFileType(name: string): string {
  const ext = (name.split('.').pop() ?? '').toUpperCase();
  if (ext === 'STP' || ext === 'STPZ' || ext === 'STEP' || ext === 'WRL' || ext === 'WRZ')
    return 'model';
  if (ext === 'WOFF' || ext === 'WOFF2' || ext === 'TTF' || ext === 'OTF') return 'font';
  if (ext === 'PDF') return 'datasheet';
  if (ext === 'KICAD_WKS') return 'worksheet';
  return 'other';
}

const base64Encode = (bytes: Uint8Array): string => {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
};

const base64Decode = (text: string): Uint8Array => {
  const bin = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** EMBEDDED_FILES::CompressAndEncode, zstd level 15, base64, MMH3 checksum. */
export async function compressAndEncode(
  bytes: Uint8Array,
): Promise<{ data: string; checksum: string }> {
  await ensureZstd();
  const compressed = compress(bytes, 15);
  return {
    data: base64Encode(new Uint8Array(compressed)),
    checksum: mmh3HashToString(bytes, EMBEDDED_FILES_SEED),
  };
}

/** EMBEDDED_FILES::DecompressAndDecode, base64, zstd, checksum validation
 *  (MMH3, then the V1 tail variant, then 64-char legacy SHA-256). */
export async function decompressAndDecode(
  data: string,
  checksum: string,
): Promise<{ bytes: Uint8Array; isValid: boolean }> {
  await ensureZstd();
  const bytes = new Uint8Array(decompress(base64Decode(data)));
  let isValid: boolean;
  if (checksum.length === 64) {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    isValid = sha === checksum;
  } else {
    isValid =
      mmh3HashToString(bytes, EMBEDDED_FILES_SEED) === checksum ||
      mmh3HashToStringV1(bytes, EMBEDDED_FILES_SEED) === checksum;
  }
  return { bytes, isValid };
}

/** The base64 payload of a `(data |…|)` node: atoms joined, `|` stripped. */
function dataNodeText(dataNode: SList): string {
  let out = '';
  for (const it of dataNode.items.slice(1)) {
    if (it.kind === 'atom' || it.kind === 'string') out += it.value;
  }
  return out.replace(/^\|/, '').replace(/\|$/, '');
}

function findFileNode(sch: Schematic, name: string): SList | null {
  for (const node of sch.source.items) {
    if (!isList(node) || head(node) !== 'embedded_files') continue;
    for (const f of node.items) {
      if (!isList(f) || head(f) !== 'file') continue;
      const nameNode = childNamed(f, 'name');
      if (nameNode && arg(nameNode, 0) === name) return f;
    }
  }
  return null;
}

/** Decompressed content of an embedded file (for export / preview). */
export async function getEmbeddedFileData(
  sch: Schematic,
  name: string,
): Promise<{ bytes: Uint8Array; isValid: boolean } | null> {
  const f = findFileNode(sch, name);
  if (!f) return null;
  const dataNode = childNamed(f, 'data');
  if (!dataNode) return null;
  const checksumNode = childNamed(f, 'checksum');
  const checksum = checksumNode ? (arg(checksumNode, 0) ?? '') : '';
  return decompressAndDecode(dataNodeText(dataNode), checksum);
}

/** WriteEmbeddedFiles' data layout: 76-column base64 lines, the first opened
 *  and the last closed with `|`. */
function buildDataNode(b64: string): SList {
  const MIME_BASE64_LENGTH = 76;
  const lines: string[] = [];
  for (let first = 0; first < b64.length; first += MIME_BASE64_LENGTH)
    lines.push(b64.slice(first, first + MIME_BASE64_LENGTH));
  if (lines.length === 0) lines.push('');
  lines[0] = `|${lines[0]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]}|`;
  return list(atom('data'), ...lines.map(atom));
}

function replaceRoot(sch: Schematic, items: SNode[]): Schematic {
  return { ...sch, source: { kind: 'list', items } };
}

const fileNodeName = (f: SNode): string => {
  if (!isList(f)) return '';
  const n = childNamed(f, 'name');
  return n ? (arg(n, 0) ?? '') : '';
};

/** Rebuild the `(embedded_files …)` node with `files` (name-sorted, like the
 *  std::map collection); no files removes the node entirely. */
function withFileNodes(sch: Schematic, fileNodes: SList[]): Schematic {
  const sorted = [...fileNodes].sort((a, b) => {
    const an = fileNodeName(a);
    const bn = fileNodeName(b);
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  const items: SNode[] = [];
  let replaced = false;
  for (const node of sch.source.items) {
    if (isList(node) && head(node) === 'embedded_files') {
      if (!replaced && sorted.length) items.push(list(atom('embedded_files'), ...sorted));
      replaced = true;
      continue;
    }
    items.push(node);
  }
  if (!replaced && sorted.length) items.push(list(atom('embedded_files'), ...sorted));
  return replaceRoot(sch, items);
}

function existingFileNodes(sch: Schematic): SList[] {
  const out: SList[] = [];
  for (const node of sch.source.items) {
    if (!isList(node) || head(node) !== 'embedded_files') continue;
    for (const f of node.items) if (isList(f) && head(f) === 'file') out.push(f);
  }
  return out;
}

/** EMBEDDED_FILES::AddFile, compress + hash `bytes` and store them under
 *  `name` (overwriting any existing entry), returning the new document. */
export async function addEmbeddedFile(
  sch: Schematic,
  name: string,
  bytes: Uint8Array,
): Promise<Schematic> {
  const { data, checksum } = await compressAndEncode(bytes);
  const fileNode = list(
    atom('file'),
    list(atom('name'), str(name)),
    list(atom('type'), atom(embeddedFileType(name))),
    buildDataNode(data),
    list(atom('checksum'), str(checksum)),
  );
  const rest = existingFileNodes(sch).filter((f) => fileNodeName(f) !== name);
  return withFileNodes(sch, [...rest, fileNode]);
}

/** EMBEDDED_FILES::RemoveFile. */
export function removeEmbeddedFile(sch: Schematic, name: string): Schematic {
  return withFileNodes(
    sch,
    existingFileNodes(sch).filter((f) => fileNodeName(f) !== name),
  );
}

/** Apply a precomputed embedded-files document update (the zstd work is
 *  async, so the dialog computes `after` first and the command just swaps the
 *  source in, with the inverse restoring the prior source). */
export function embeddedFilesCommand(after: Schematic): EditCommand {
  return {
    label: 'Embedded Files',
    apply: (d) => ({ ...d, source: after.source }),
    invert: (before) => embeddedFilesCommand(before),
  };
}

/** Set the `(embedded_fonts yes|no)` flag (created before `embedded_files`
 *  when missing, where KiCad's writer places it). */
export function setEmbedFonts(sch: Schematic, on: boolean): Schematic {
  const node = list(atom('embedded_fonts'), atom(on ? 'yes' : 'no'));
  const items: SNode[] = [];
  let replaced = false;
  for (const it of sch.source.items) {
    if (isList(it) && head(it) === 'embedded_fonts') {
      items.push(node);
      replaced = true;
      continue;
    }
    if (!replaced && isList(it) && head(it) === 'embedded_files') {
      items.push(node);
      replaced = true;
    }
    items.push(it);
  }
  if (!replaced) items.push(node);
  return replaceRoot(sch, items);
}
