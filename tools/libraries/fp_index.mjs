// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the hosted footprint index carries about each `.kicad_mod` beyond its
 * name. This is our `fp-info-cache`: KiCad builds a FOOTPRINT_INFO per
 * footprint holding the unique pad count, the keywords and the description
 * (`footprint_info_impl.cpp:36-58`), and the whole Assign Footprints /
 * footprint-chooser filter engine reads only those three fields plus the
 * LIB_ID. Computing them here, once, is what lets the browser filter 15 000
 * footprints without downloading any of them.
 *
 * The pipeline scripts run under bare node with no build step, so they cannot
 * import the TypeScript packages; this file therefore re-states
 * `FOOTPRINT::GetUniquePadNumbers` over the file text rather than over a parsed
 * board. `qa/unittests/designer/footprint_index.test.ts` pins the two against
 * each other on real footprints so they cannot drift.
 *
 * Types live in `fp_index.d.mts`, the same arrangement `split.mjs` uses.
 */

/**
 * The text of the balanced `(…)` list starting at `open`, honouring quoted
 * strings and backslash escapes (a `)` inside `"…"` does not close anything).
 */
function balanced(text, open) {
  let depth = 0;
  let inString = false;

  for (let i = open; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') inString = true;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Every `(<token> …)` list in `text`, as balanced source blocks. */
function blocksNamed(text, token) {
  const out = [];
  const head = new RegExp(`\\(${token}[\\s(]`, 'g');
  for (let m = head.exec(text); m !== null; m = head.exec(text)) {
    const block = balanced(text, m.index);
    out.push(block);
    head.lastIndex = m.index + block.length;
  }
  return out;
}

/** The quoted strings of a block, unescaped, in order. */
function quoted(block) {
  const out = [];
  for (const m of block.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    out.push(m[1].replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** `IsCopperLayer` by name, plus the file-level wildcards a pad may use. */
function isCopperLayerToken(token) {
  return (
    /^(F|B|In\d+)\.Cu$/.test(token) || token === '*.Cu' || token === '*In.Cu' || token === 'F&B.Cu'
  );
}

/**
 * `FOOTPRINT::GetUniquePadNumbers( DO_NOT_INCLUDE_NPTH )`
 * (pcbnew/footprint.cpp:2532-2558) over a `.kicad_mod`'s text: distinct pad
 * numbers, skipping
 *
 *  - pads with **no copper layer**, which build complex solder-paste shapes,
 *  - pads with an **empty number**, upstream's "mechanical, not electrical",
 *  - **NPTH** pads, because `footprint_info_impl.cpp:53` asks for the count
 *    without them.
 *
 * A footprint with plated mounting holes or a stencil-only paste pad would
 * otherwise report more pads than any symbol can have pins, and "Filter by pin
 * count" would then never offer it.
 */
export function uniquePadNumbers(text, includeNpth = false) {
  const numbers = new Set();

  for (const pad of blocksNamed(text, 'pad')) {
    // `(pad "<number>" <attribute> <shape> …)`.
    const number = quoted(pad)[0];
    if (number === undefined || number === '') continue;

    const attribute = /^\(pad\s+"(?:[^"\\]|\\.)*"\s+([A-Za-z_]+)/.exec(pad)?.[1];
    if (!includeNpth && attribute === 'np_thru_hole') continue;

    const layers = blocksNamed(pad, 'layers')[0];
    if (!layers || !quoted(layers).some(isCopperLayerToken)) continue;

    numbers.add(number);
  }

  return numbers;
}

/** The index fields of one `.kicad_mod`: FOOTPRINT_INFO's three cached values. */
export function footprintIndexInfo(text) {
  const descr = blocksNamed(text, 'descr')[0];
  const tags = blocksNamed(text, 'tags')[0];
  return {
    pads: uniquePadNumbers(text).size,
    // FOOTPRINT::GetLibDescription / GetKeywords, '' when the token is absent.
    descr: descr ? (quoted(descr)[0] ?? '') : '',
    tags: tags ? (quoted(tags)[0] ?? '') : '',
  };
}
