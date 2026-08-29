// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad Newstroke stroke font, ported from common/font/stroke_font.cpp.
 *
 * Glyphs are Hershey-encoded strings (see newstrokeGlyphs.ts). This decodes them
 * exactly as STROKE_FONT::loadNewStrokeFont does, and lays out a text run the way
 * STROKE_FONT::GetTextAsGlyphs does, so schematic text is stroked with the real
 * KiCad font instead of a system font.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { NEWSTROKE_GLYPHS } from './newstroke_glyphs.js';
import { metricsInterline, OVERBAR_HEIGHT, STROKE_LEGACY_FACTOR } from './font_metrics.js';

/**
 * The stroke font's own name — `KICAD_FONT_NAME` (include/font/kicad_font_name.h),
 * which `STROKE_FONT::LoadFont` assigns to `m_fontName` (stroke_font.cpp:189).
 *
 * It is a keyword and is never translated. It matters outside the font code
 * because a text item may name it explicitly — `FONT::GetFont( "KiCad Font" )`
 * hands back the stroke font — so it is a face name that must NOT be treated
 * as an outline family.
 */
export const KICAD_FONT_NAME = 'KiCad Font';

/**
 * The OTHER name a font control can show: `_( "Default Font" )`, the entry that
 * means "no `(face …)` at all" rather than a face called that.
 *
 * `EDA_TEXT::GetFontProp` (common/eda_text.cpp:1022-1032) picks between the two
 * by item type — an eeschema item with no font reads "Default Font", a pcbnew
 * one reads KICAD_FONT_NAME — and every font combo in the tree lists both
 * (`#define DEFAULT_FONT_NAME` in fields_grid_table.cpp:60, and the literal
 * pair in six `*_base.cpp` files). It is stated once here for the same reason
 * KICAD_FONT_NAME is: a control that spells it differently silently stops
 * matching the value the model hands it.
 */
export const DEFAULT_FONT_NAME = 'Default Font';

const STROKE_FONT_SCALE = 1 / 21; // stroke_font.cpp
const FONT_OFFSET = -8; // historical Y offset baked into the glyph coordinates

interface Glyph {
  /** Advance width in reduced (em) units. */
  advance: number;
  /** Pen-down polylines in reduced units: x right from the glyph origin, y down from baseline. */
  strokes: Vec2[][];
}

let decoded: Glyph[] | null = null;

/** Decode one Hershey glyph string (loadNewStrokeFont's inner loop). */
function decodeGlyph(s: string): Glyph {
  const R = 'R'.charCodeAt(0);
  let startX = 0;
  let advance = 0;
  const strokes: Vec2[][] = [];
  let cur: Vec2[] | null = null;

  for (let i = 0; i < s.length; i += 2) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    if (i === 0) {
      // First pair: glyph start/end X give the advance width.
      startX = (c0 - R) * STROKE_FONT_SCALE;
      const endX = (c1 - R) * STROKE_FONT_SCALE;
      advance = endX - startX;
    } else if (s[i] === ' ' && s[i + 1] === 'R') {
      cur = null; // pen up: end the current stroke
    } else {
      const x = (c0 - R) * STROKE_FONT_SCALE - startX;
      const y = (c1 - R + FONT_OFFSET) * STROKE_FONT_SCALE;
      if (!cur) {
        cur = [];
        strokes.push(cur);
      }
      cur.push({ x, y });
    }
  }
  return { advance, strokes };
}

function glyphs(): Glyph[] {
  if (!decoded) decoded = NEWSTROKE_GLYPHS.map(decodeGlyph);
  return decoded;
}

/** Advance width of the space glyph (index 0), in em units. */
function spaceAdvance(): number {
  return glyphs()[0]!.advance;
}

// ----- KiCad text markup (font.cpp MARKUP_NODE) --------------------------------
// `~{...}` renders with an overbar, `_{...}` as subscript, `^{...}` as
// superscript. Factors from stroke_font.cpp GetTextAsGlyphs and
// font_metrics.h (m_OverbarHeight).
const SUPER_SUB_SIZE_MULTIPLIER = 0.8;
const SUPER_HEIGHT_OFFSET = 0.35;
const SUB_HEIGHT_OFFSET = 0.15;
const DEFAULT_OVERBAR_HEIGHT = OVERBAR_HEIGHT;

// m_OverbarHeight is project-adjustable (Schematic Setup > Formatting's
// "Vertical offset ratio"); renderers set it before drawing, like KiCad seeds
// SCH_RENDER_SETTINGS' font metrics from SCHEMATIC_SETTINGS.
let overbarHeight = DEFAULT_OVERBAR_HEIGHT;

/** Set the overbar Y offset as a multiple of text size (FONT_METRICS
 *  m_OverbarHeight); undefined or non-positive restores the default 1.23. */
export function setOverbarHeightRatio(ratio?: number): void {
  overbarHeight = ratio && ratio > 0 ? ratio : DEFAULT_OVERBAR_HEIGHT;
}

type MarkupStyle = 'normal' | 'overbar' | 'sub' | 'super';
interface MarkupRun {
  text: string;
  style: MarkupStyle;
}

/** Split one line into markup runs; plain text passes through untouched. */
function parseMarkup(line: string): MarkupRun[] {
  if (!/[~_^]\{/.test(line)) return [{ text: line, style: 'normal' }];
  const runs: MarkupRun[] = [];
  let plain = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    if ((c === '~' || c === '_' || c === '^') && next === '{') {
      // Find the matching close brace (markup can contain nested braces).
      let depth = 1;
      let j = i + 2;
      while (j < line.length && depth > 0) {
        if (line[j] === '{') depth++;
        else if (line[j] === '}') depth--;
        j++;
      }
      if (plain) {
        runs.push({ text: plain, style: 'normal' });
        plain = '';
      }
      runs.push({
        text: line.slice(i + 2, depth === 0 ? j - 1 : j),
        style: c === '~' ? 'overbar' : c === '_' ? 'sub' : 'super',
      });
      i = j - 1;
    } else {
      plain += c;
    }
  }
  if (plain) runs.push({ text: plain, style: 'normal' });
  return runs;
}

/** Advance one run's glyphs from `cursorX`; collect strokes when `out` given. */
function layoutRun(run: MarkupRun, size: number, cursorX: number, out?: Vec2[][]): number {
  const gl = glyphs();
  const glyphSize =
    run.style === 'sub' || run.style === 'super' ? size * SUPER_SUB_SIZE_MULTIPLIER : size;
  const dy =
    run.style === 'sub'
      ? glyphSize * SUB_HEIGHT_OFFSET
      : run.style === 'super'
        ? -glyphSize * SUPER_HEIGHT_OFFSET
        : 0;
  const barStart = cursorX;
  for (const ch of run.text) {
    if (ch === ' ') {
      cursorX += spaceAdvance() * glyphSize;
      continue;
    }
    let dd = ch.codePointAt(0)! - 0x20;
    if (dd < 0 || dd >= gl.length) dd = '?'.charCodeAt(0) - 0x20; // non-printable -> '?'
    const g = gl[dd]!;
    if (out) {
      const x0 = cursorX;
      out.push(
        ...g.strokes.map((s) =>
          s.map((p) => ({ x: x0 + p.x * glyphSize, y: p.y * glyphSize + dy })),
        ),
      );
    }
    cursorX += g.advance * glyphSize;
  }
  if (out && run.style === 'overbar') {
    // Shorten the bar a little so its rounded ends don't make it over-long.
    const barTrim = size * 0.1;
    const y = -size * overbarHeight;
    out.push([
      { x: barStart + barTrim, y },
      { x: cursorX - barTrim, y },
    ]);
  }
  return cursorX;
}

/**
 * Total advance width of `text` at glyph height `size` (IU), no stroke building.
 *
 * Multi-line text measures as its **widest line**, which is what `layoutText`
 * lays out and therefore what is on screen. This used to run the whole string
 * through as one line: the widths of every line were added together, and the
 * `\n` itself advanced as a missing-glyph '?', so `"a\nb\nc"` measured almost
 * five times its real width.
 *
 * Everything geometric goes through here — `textBoxWidth`, and so label and
 * text bounding boxes, hit-testing, selection halos and field autoplacement —
 * so a multi-line text had a box several times too wide, and picked up clicks
 * a long way to its right.
 */
/**
 * Split text into lines the way KiCad does (`wxStringSplit`, string_utils.cpp).
 *
 * The C++ loop appends the pending buffer only `if( !tmp.IsEmpty() )`, so a
 * **trailing** newline does not open a final empty line — while an interior
 * blank line is kept. JavaScript's `split` disagrees on exactly that case, and
 * the difference is visible: the coldfire demo has `(gr_text "JTAG_EN\n")`,
 * and counting two lines centres a two-line block on the anchor, lifting the
 * text by half an interline (0.84 · size) above where pcbnew draws it.
 */
export function splitTextLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function measureText(text: string, size: number): number {
  let widest = 0;
  for (const line of splitTextLines(text)) {
    let w = 0;
    for (const run of parseMarkup(line)) w = layoutRun(run, size, w);
    if (w > widest) widest = w;
  }
  return widest;
}

/**
 * Lay out `text` at glyph height `size` (em, IU) with the baseline-left origin at
 * (0,0). Returns the stroke polylines (in IU, y down from baseline) plus the total
 * advance width. Mirrors GetTextAsGlyphs: index = codepoint-0x20, '?' fallback,
 * space advances by the space glyph width, each glyph advances by its width*size.
 */

/**
 * How the lines of a multi-line run sit against each other.
 *
 * `FONT::getLinePositions` places every line from the *item's* justification,
 * against the anchor, one line at a time:
 *
 *     case GR_TEXT_H_ALIGN_LEFT:                                   break;
 *     case GR_TEXT_H_ALIGN_CENTER: lineOffset.x = -lineSize.x / 2;  break;
 *     case GR_TEXT_H_ALIGN_RIGHT:  lineOffset.x = -( lineSize.x + offset.x );
 *
 * so a left-justified block has every line starting at the anchor, and only a
 * centred one has short lines pulled in. Laying every line out centred — which
 * is what this did — draws a left-justified heading floating in the middle of
 * the paragraph under it.
 *
 * Expressed here as a shift *within the block* (whose left edge is x=0 and
 * whose width is the widest line), so a caller that positions the block by its
 * total width lands each line exactly where upstream puts it, whichever of the
 * three it asks for.
 */
export type TextHAlign = 'left' | 'center' | 'right';

export interface TextLayout {
  strokes: Vec2[][];
  /** The widest line: the block's width, which is what a caller positions by. */
  width: number;
  /** Lines actually drawn, for the caller's block-height maths. */
  lineCount: number;
}

/**
 * @param vBlock how the *stack* sits on the baseline. `'center'` (the default)
 * centres it, which is the only behaviour this had; `'first-line'` leaves line
 * 0 on the baseline and grows downwards, which is what `getLinePositions` does
 * — there the vertical alignment is applied by the caller, from a block height
 * it works out itself.
 */
export function layoutText(
  text: string,
  size: number,
  hAlign: TextHAlign = 'center',
  vBlock: 'center' | 'first-line' = 'center',
): TextLayout {
  // KiCad draws multi-line text (EDA_TEXT with embedded \n) as stacked lines
  // spaced by GetInterline(); a lone newline must not render as a glyph, and a
  // trailing one must not add a line (see splitTextLines).
  const lines = splitTextLines(text);

  // Pass 1: lay each line out left-aligned from x=0, keep its strokes + width.
  // Markup runs (~{overbar}, _{sub}, ^{super}) are resolved here.
  const laid = lines.map((line) => {
    const strokes: Vec2[][] = [];
    let cursorX = 0;
    for (const run of parseMarkup(line)) cursorX = layoutRun(run, size, cursorX, strokes);
    return { strokes, width: cursorX };
  });

  const maxWidth = Math.max(0, ...laid.map((l) => l.width));
  // `FONT::getLinePositions` steps each line by `GetInterline( size )`, which for
  // the stroke font carries the legacy factor; see `interline` below.
  const pitch = interline(size);
  const vShift = vBlock === 'center' ? -((lines.length - 1) * pitch) / 2 : 0;
  const out: Vec2[][] = [];
  laid.forEach((ld, li) => {
    const dx =
      hAlign === 'left' ? 0 : hAlign === 'right' ? maxWidth - ld.width : (maxWidth - ld.width) / 2;
    const dy = li * pitch + vShift;
    for (const s of ld.strokes) out.push(s.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  });
  return { strokes: out, width: maxWidth, lineCount: lines.length };
}

/**
 * `STROKE_FONT::GetInterline` (`common/font/stroke_font.cpp:194-199`): the pitch
 * between two baselines.
 *
 *     static double LEGACY_FACTOR = 0.9583;   // Adjustment to match legacy spacing
 *     return aFontMetrics.GetInterline( aGlyphHeight ) * LEGACY_FACTOR;
 *
 * The factor is not optional decoration — it is what makes our line spacing the
 * same as pcbnew's and eeschema's. Without it every multi-line run is 4.3 %
 * loose, which is exactly what this returned before, while the schematic
 * renderer carried a private `1.68 * 0.9583` for the same quantity and so
 * disagreed with the font it was drawing with.
 *
 * `OUTLINE_FONT::GetInterline` has no such factor; use
 * `text_box.ts`'s `fontInterline( height, face )` when the face may be an
 * outline one.
 */
export function interline(size: number): number {
  return metricsInterline(size) * STROKE_LEGACY_FACTOR;
}
