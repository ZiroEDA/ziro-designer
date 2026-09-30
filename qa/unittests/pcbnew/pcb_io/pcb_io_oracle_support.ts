// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The oracle comparison the non-KiCad board importers are held to: KiCad's
 * own conversion of a sample board (`kicad-cli pcb import`, which is
 * `pi->LoadBoard()` then the s-expression `SaveBoard()`), against our importer
 * followed by our KiCad-exact writer.
 *
 * Three things are set aside, each because it is not the importer's output:
 *  - every uuid: an importer mints random KIIDs (`KIID()`), so none can match;
 *  - the ORDER of top-level items and of footprint children: the writer sorts
 *    those by comparators that fall back to the uuid when every other key ties;
 *  - the `(data …)` of an embedded file: it is zstd output, and our zstd-wasm
 *    build is not the libzstd 1.5.5 kicad-cli links (compressing KiCad's own
 *    decompressed bytes with `zstd -15 --no-check` 1.5.5 reproduces its data
 *    exactly). The `(checksum …)` of the decompressed content is compared.
 * `stripRenderCache` is the one opt-in exclusion: outline-font glyph polygons,
 * which come from the font engine, not the importer.
 */

import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** A file of the oracle data, gunzipped when it ends in `.gz`. */
export function readOracleFile(aPath: string): Uint8Array {
  const raw = readFileSync(aPath);
  return new Uint8Array(aPath.endsWith('.gz') ? gunzipSync(raw) : raw);
}

/** Split lines into blocks at the given tab depth: `(head` … matching `)`, or single lines. */
function blocks(lines: readonly string[], depth: number): string[][] {
  const tab = '\t'.repeat(depth);
  const out: string[][] = [];
  let cur: string[] | null = null;

  for (const l of lines) {
    if (cur === null) {
      cur = [l];

      if (!(l.startsWith(`${tab}(`) && !l.endsWith(')'))) {
        out.push(cur);
        cur = null;
      }
    } else {
      cur.push(l);

      if (l === `${tab})`) {
        out.push(cur);
        cur = null;
      }
    }
  }

  if (cur) out.push(cur);

  return out;
}

const ITEM_HEAD =
  /^\t\((footprint|gr_|segment|arc|via|zone|dimension|generated|group|image|target|table|barcode|point)\b/;

export interface NORMALIZE_OPTIONS {
  /** Mask the `(at …)` of a text drawn in an outline (TrueType) font. */
  maskOutlineTextPos?: boolean;
}

/** `(at …)` of a text block whose effects name a `(face …)`, masked. */
function maskOutlineText(aBlock: string[]): string[] {
  if (!aBlock.some((l) => l.includes('(face "'))) return aBlock;

  return aBlock.map((l, i) =>
    i === 1 && /^\t+\(at /.test(l) ? l.replace(/\(at [^)]*\)/, '(at ~)') : l,
  );
}

export function normalizeBoard(aText: string, aOptions: NORMALIZE_OPTIONS = {}): string {
  const lines = aText
    .replace(UUID, 'UUID')
    .replace(/\(data \|[^|]*\|\s*\)/g, '(data |ZSTD|)')
    .split('\n');

  // lines[0] = "(kicad_pcb", then the body, then ")" and the trailing newline
  const inner = lines.slice(1, lines.length - 2);
  const items = blocks(inner, 1).map((b) => {
    let block = b;

    if (aOptions.maskOutlineTextPos && /^\t\((gr_text|gr_text_box|dimension)\b/.test(b[0]!))
      block = maskOutlineText(block);

    if (block[0]!.startsWith('\t(footprint ') && block.length > 2) {
      const kids = blocks(block.slice(1, -1), 2).map((k) =>
        (aOptions.maskOutlineTextPos && /^\t\t\((fp_text|property|fp_text_box)\b/.test(k[0]!)
          ? maskOutlineText(k)
          : k
        ).join('\n'),
      );
      return [block[0], ...kids.sort(), block[block.length - 1]].join('\n');
    }

    return block.join('\n');
  });

  const header = items.filter((b) => !ITEM_HEAD.test(b));
  const rest = items.filter((b) => ITEM_HEAD.test(b)).sort();

  return [lines[0], ...header, ...rest, ')'].join('\n');
}

/** Drop every `(render_cache …)` block (outline-font glyph polygons). */
export function stripRenderCache(aText: string): string {
  const out: string[] = [];
  let skip: string | null = null;

  for (const l of aText.split('\n')) {
    if (skip !== null) {
      if (l === skip) skip = null;
      continue;
    }

    const m = /^(\t*)\(render_cache /.exec(l);

    if (m) {
      skip = `${m[1]})`;
      continue;
    }

    out.push(l);
  }

  return out.join('\n');
}

/** The first differing line of two normalised boards, for a readable failure. */
export function firstDifference(aOurs: string, aTheirs: string): string {
  const a = aOurs.split('\n');
  const b = aTheirs.split('\n');
  let i = 0;

  while (i < a.length && i < b.length && a[i] === b[i]) i++;

  if (i === a.length && i === b.length) return '';

  return `line ${i + 1}:\n  ours   ${JSON.stringify(a.slice(Math.max(0, i - 3), i + 3).join('\n'))}\n  theirs ${JSON.stringify(b.slice(Math.max(0, i - 3), i + 3).join('\n'))}`;
}

/** A footprint's library text, uuids masked, its depth-1 children sorted. */
export function normalizeFootprint(aText: string): string {
  const lines = aText.replace(UUID, 'UUID').split('\n');
  const kids: string[] = [];
  let cur: string[] | null = null;

  for (const l of lines.slice(1, lines.length - 2)) {
    if (cur === null) {
      cur = [l];
      if (!(l.startsWith('\t(') && !l.endsWith(')'))) {
        kids.push(cur.join('\n'));
        cur = null;
      }
    } else {
      cur.push(l);
      if (l === '\t)') {
        kids.push(cur.join('\n'));
        cur = null;
      }
    }
  }

  return [lines[0], ...kids.sort(), ')'].join('\n');
}
