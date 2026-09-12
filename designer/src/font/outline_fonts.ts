// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FONT::GetFont` (common/font/font.cpp:147-170) for the browser: the one
 * place a face name becomes an `OutlineFont`, and the reason it can be
 * asked from a draw loop.
 *
 *     FONT* FONT::GetFont( const wxString& aFontName, bool aBold, bool aItalic, … )
 *     {
 *         if( aFontName.empty() || aFontName.StartsWith( KICAD_FONT_NAME ) )
 *             return getDefaultFont();
 *         key = { aFontName, aBold, aItalic, aForDrawingSheet };
 *         font = s_fontMap[key] ?: OUTLINE_FONT::LoadFont( … ) ?: getDefaultFont();
 *         s_fontMap[key] = font;
 *     }
 *
 * Upstream loads synchronously off the disk. Here the file is fetched, so
 * the same call has three answers: the font, once it is here; null while
 * it is on its way, or if it never arrives — and null means "draw with the
 * stroke font", which is `getDefaultFont()`, the fallback `GetFont` itself
 * takes when `LoadFont` fails. A caller that drew the fallback is told
 * through {@link onOutlineFontsChanged} when the real face lands, so a
 * label drawn in Newstroke for a frame redraws in Arial the next.
 *
 * `fontconfig.ts` decides which file; this only fetches and caches it.
 * Faces are cached per file and `OutlineFont`s per (name, bold, italic),
 * as `s_fontMap` is keyed — the same face file serves "Arial" and
 * "Liberation Sans", but each keeps the name it was asked for.
 */
import { findFont } from '@ziroeda/common/src/font/fontconfig.js';
import { setFontProvider } from '@ziroeda/common/src/font/font_provider.js';
import { type OutlineFace, parseOutlineFace } from '@ziroeda/common/src/font/outline_face.js';
import { OutlineFont } from '@ziroeda/common/src/font/outline_font.js';
import {
  outlineBoundaryLimits,
  outlineTextWidth,
} from '@ziroeda/common/src/font/outline_layout.js';
import { isStrokeFont } from '@ziroeda/common/src/font/text_box.js';

/** Where the bundled files are served from; see `fontconfig.ts`'s catalogue. */
const FONTS_URL = '/fonts/';

type FaceState = { state: 'loading' } | { state: 'ready'; face: OutlineFace } | { state: 'failed' };

const faces = new Map<string, FaceState>();
const fonts = new Map<string, OutlineFont | null>();
const listeners = new Set<() => void>();

/** The fetch, overridable for tests and for a host that serves fonts elsewhere. */
let fetchFace: (file: string) => Promise<ArrayBuffer> = async (file) => {
  const res = await fetch(FONTS_URL + file);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.arrayBuffer();
};

export function setFaceFetcher(next: typeof fetchFace): void {
  fetchFace = next;
}

/** Subscribe to "a face finished loading"; returns the unsubscribe. */
export function onOutlineFontsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

function loadFace(file: string): FaceState {
  let st = faces.get(file);
  if (st) return st;
  st = { state: 'loading' };
  faces.set(file, st);
  fetchFace(file).then(
    (bytes) => {
      try {
        faces.set(file, { state: 'ready', face: parseOutlineFace(bytes) });
      } catch (e) {
        console.warn(`[font] ${file} did not parse:`, e);
        faces.set(file, { state: 'failed' });
      }
      // Every font keyed on this file was answered null while it loaded;
      // drop those so the next ask builds the real one.
      for (const [k, v] of fonts) if (v === null && k.endsWith(`|${file}`)) fonts.delete(k);
      notify();
    },
    (e) => {
      console.warn(`[font] ${file} failed to load:`, e);
      faces.set(file, { state: 'failed' });
      notify();
    },
  );
  return st;
}

/**
 * `FONT::GetFont`, minus the stroke font: null for the stroke font itself,
 * for a face still loading, and for one that failed — each of which the
 * caller draws with Newstroke.
 */
export function getOutlineFont(
  fontName: string | undefined,
  bold = false,
  italic = false,
): OutlineFont | null {
  if (!fontName || isStrokeFont(fontName)) return null;
  const found = findFont(fontName, bold, italic);
  if (!found) return null;
  const key = `${fontName}|${bold ? 1 : 0}|${italic ? 1 : 0}|${found.file.file}`;
  const cached = fonts.get(key);
  if (cached !== undefined) return cached;
  const st = loadFace(found.file.file);
  if (st.state !== 'ready') {
    fonts.set(key, null);
    return null;
  }
  const font = new OutlineFont(st.face, fontName, found.fakeBold, found.fakeItalic);
  fonts.set(key, font);
  return font;
}

/**
 * Install the outline measurer behind `textWidth`, so every consumer of a
 * width — bounding boxes, hit-testing, field autoplacement — asks the same
 * glyphs the renderer fills. #154's rule: never measure with one source and
 * draw with another. A face not yet loaded declines (null), and the caller
 * falls back to the stroke font, which is what is on screen at that moment.
 */
export function installOutlineFontProvider(): void {
  setFontProvider({
    measure(text, size, style) {
      const font = getOutlineFont(style.face, !!style.bold, !!style.italic);
      return font ? outlineTextWidth(font, text, size) : null;
    },
    limits(text, size, style) {
      const font = getOutlineFont(style.face, !!style.bold, !!style.italic);
      return font ? outlineBoundaryLimits(font, text, size) : null;
    },
  });
}

/** For tests: forget every face and font. */
export function resetOutlineFonts(): void {
  faces.clear();
  fonts.clear();
}
