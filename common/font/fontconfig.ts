// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `fontconfig::FONTCONFIG::FindFont` (common/font/fontconfig.cpp:213-381)
 * over a catalogue we ship, instead of the machine's font database.
 *
 * KiCad asks fontconfig for a family and a style and takes whatever comes
 * back: the face itself when it is installed, otherwise fontconfig's
 * substitute — on an Ubuntu desktop "Arial" is Liberation Sans, "Times New
 * Roman" Liberation Serif, "Courier New" Liberation Mono, and anything it
 * has never heard of is the default sans, Noto Sans (`fc-match`, 2026-09).
 * A browser cannot read the machine's fonts, so the same families are served
 * from `/fonts/` and the same substitutions are written down here. A file
 * authored with a face this catalogue lacks lands on the same default sans
 * KiCad would land on for a face the machine lacks.
 *
 * ### What FindFont decides, ported rule for rule
 *
 * 1. A requested NAME containing "bold", "heavy", "black", "thick" or "dark"
 *    asks for bold whatever the flag says (:224-231).
 * 2. The match's style string decides whether the face found is really bold
 *    or italic (:302-334): "thin/light/regular/roman/book" are not bold,
 *    "medium/semibold/demibold" count as bold only if bold was asked for,
 *    "bold/heavy/black/thick/dark" are; "italic/oblique/slant" are italic.
 * 3. Only when the family FOUND starts with the family ASKED FOR does a
 *    missing style become a fake one — `FF_MISSING_BOLD` / `FF_MISSING_ITAL`
 *    / both — which `OUTLINE_FONT::LoadFont` turns into `SetFakeBold` /
 *    `SetFakeItal` (:336-356). A substitute family never fakes anything: it
 *    is drawn in whichever of its styles matched.
 *
 * Style matching itself is fontconfig's closest-match, which for a family
 * with the four usual faces is exact and for one missing a face is the
 * nearest weight/slant. That is what `pickStyle` does.
 */

/** One face file in the catalogue. */
export interface FontFile {
  /** The family fontconfig reports (`FC_FAMILY`). */
  readonly family: string;
  /** The style string fontconfig reports (`FC_STYLE`): "Regular", "Bold Italic", "Book", "Oblique"… */
  readonly style: string;
  /** Path under the fonts directory. */
  readonly file: string;
}

/**
 * The bundled faces. Every file is the one Ubuntu's packages install —
 * `fonts-liberation`, `fonts-dejavu-core`, `fonts-noto-core` — unmodified,
 * under the licences in `designer/public/fonts/LICENSES.md`.
 */
export const BUNDLED_FONTS: readonly FontFile[] = [
  { family: 'Liberation Sans', style: 'Regular', file: 'LiberationSans-Regular.ttf' },
  { family: 'Liberation Sans', style: 'Bold', file: 'LiberationSans-Bold.ttf' },
  { family: 'Liberation Sans', style: 'Italic', file: 'LiberationSans-Italic.ttf' },
  { family: 'Liberation Sans', style: 'Bold Italic', file: 'LiberationSans-BoldItalic.ttf' },
  { family: 'Liberation Serif', style: 'Regular', file: 'LiberationSerif-Regular.ttf' },
  { family: 'Liberation Serif', style: 'Bold', file: 'LiberationSerif-Bold.ttf' },
  { family: 'Liberation Serif', style: 'Italic', file: 'LiberationSerif-Italic.ttf' },
  { family: 'Liberation Serif', style: 'Bold Italic', file: 'LiberationSerif-BoldItalic.ttf' },
  { family: 'Liberation Mono', style: 'Regular', file: 'LiberationMono-Regular.ttf' },
  { family: 'Liberation Mono', style: 'Bold', file: 'LiberationMono-Bold.ttf' },
  { family: 'Liberation Mono', style: 'Italic', file: 'LiberationMono-Italic.ttf' },
  { family: 'Liberation Mono', style: 'Bold Italic', file: 'LiberationMono-BoldItalic.ttf' },
  // DejaVu Sans ships no oblique in fonts-dejavu-core, so an italic request
  // is the FF_MISSING_ITAL path — the fake 12° shear — as it is on the desktop.
  { family: 'DejaVu Sans', style: 'Book', file: 'DejaVuSans.ttf' },
  { family: 'DejaVu Sans', style: 'Bold', file: 'DejaVuSans-Bold.ttf' },
  { family: 'DejaVu Sans Mono', style: 'Book', file: 'DejaVuSansMono.ttf' },
  { family: 'DejaVu Sans Mono', style: 'Bold', file: 'DejaVuSansMono-Bold.ttf' },
  { family: 'DejaVu Sans Mono', style: 'Oblique', file: 'DejaVuSansMono-Oblique.ttf' },
  { family: 'DejaVu Sans Mono', style: 'Bold Oblique', file: 'DejaVuSansMono-BoldOblique.ttf' },
  { family: 'Noto Sans', style: 'Regular', file: 'NotoSans-Regular.ttf' },
  { family: 'Noto Sans', style: 'Bold', file: 'NotoSans-Bold.ttf' },
  { family: 'Noto Sans', style: 'Italic', file: 'NotoSans-Italic.ttf' },
  { family: 'Noto Sans', style: 'Bold Italic', file: 'NotoSans-BoldItalic.ttf' },
  { family: 'Noto Serif', style: 'Regular', file: 'NotoSerif-Regular.ttf' },
  { family: 'Noto Serif', style: 'Bold', file: 'NotoSerif-Bold.ttf' },
  { family: 'Noto Serif', style: 'Italic', file: 'NotoSerif-Italic.ttf' },
  { family: 'Noto Serif', style: 'Bold Italic', file: 'NotoSerif-BoldItalic.ttf' },
];

/**
 * [data] fontconfig's substitutions on the reference machine, `fc-match`
 * on each name (2026-09-11), for the names a KiCad file is likely to carry.
 * The metric-compatible ones come from `30-metric-aliases.conf`; the rest
 * fall to the default sans, which is what an unknown name gets below.
 */
const ALIASES: Readonly<Record<string, string>> = {
  arial: 'Liberation Sans',
  // fc-match gives Nimbus Sans (urw-base35), which is not bundled; Liberation
  // Sans is the same metric family, next in the alias list.
  helvetica: 'Liberation Sans',
  'times new roman': 'Liberation Serif',
  times: 'Liberation Serif',
  'courier new': 'Liberation Mono',
  courier: 'Liberation Mono',
  'sans-serif': 'Noto Sans',
  sans: 'Noto Sans',
  serif: 'Noto Serif',
  monospace: 'DejaVu Sans Mono',
  mono: 'DejaVu Sans Mono',
};

/** `fc-match sans-serif`: the family every unknown name resolves to. */
export const DEFAULT_FAMILY = 'Noto Sans';

/** `FONTCONFIG::FF_RESULT`. */
export type FindFontResult =
  | 'ok'
  | 'substitute'
  | 'missing_bold'
  | 'missing_ital'
  | 'missing_bold_ital'
  | 'error';

export interface FoundFont {
  readonly result: FindFontResult;
  readonly file: FontFile;
  /** `SetFakeBold` / `SetFakeItal`, as `OUTLINE_FONT::LoadFont` derives them from the result. */
  readonly fakeBold: boolean;
  readonly fakeItalic: boolean;
}

const lower = (s: string): string => s.toLowerCase();

/** The name's own bold keywords (:224-231). */
function nameAsksBold(name: string): boolean {
  const n = lower(name);
  return ['bold', 'heavy', 'black', 'thick', 'dark'].some((k) => n.includes(k));
}

/** Rule 2: what a style string says about the face (:302-334). */
function styleIs(style: string, bold: boolean): { bold: boolean; italic: boolean } {
  const s = lower(style);
  let hasBold = false;
  if (['thin', 'light', 'regular', 'roman', 'book'].some((k) => s.includes(k))) hasBold = false;
  else if (['medium', 'semibold', 'demibold'].some((k) => s.includes(k))) hasBold = bold;
  else if (['bold', 'heavy', 'black', 'thick', 'dark'].some((k) => s.includes(k))) hasBold = true;
  const hasItal = ['italic', 'oblique', 'slant'].some((k) => s.includes(k));
  return { bold: hasBold, italic: hasItal };
}

/**
 * fontconfig's closest style: exact weight and slant first, then the same
 * slant at the other weight, then the same weight upright, then whatever
 * the family has. Deterministic over the catalogue's order.
 */
function pickStyle(files: readonly FontFile[], bold: boolean, italic: boolean): FontFile {
  const score = (f: FontFile): number => {
    const s = styleIs(f.style, true);
    let n = 0;
    if (s.italic !== italic) n += 2;
    if (s.bold !== bold) n += 1;
    return n;
  };
  let best = files[0]!;
  let bestScore = score(best);
  for (const f of files) {
    const sc = score(f);
    if (sc < bestScore) {
      best = f;
      bestScore = sc;
    }
  }
  return best;
}

/**
 * `FONTCONFIG::FindFont`. Returns the file to load, what kind of match it was,
 * and the fake-style flags; `error` only when the catalogue is empty.
 */
export function findFont(
  fontName: string,
  bold: boolean,
  italic: boolean,
  catalogue: readonly FontFile[] = BUNDLED_FONTS,
): FoundFont | null {
  if (nameAsksBold(fontName)) bold = true;
  const wanted = lower(fontName.trim());
  // The family fontconfig would settle on: the name itself when we have it,
  // an alias when we know one, the default sans otherwise.
  const families = new Set(catalogue.map((f) => f.family));
  let family = [...families].find((f) => lower(f) === wanted);
  if (!family) family = ALIASES[wanted];
  if (!family || !families.has(family)) family = DEFAULT_FAMILY;
  const files = catalogue.filter((f) => f.family === family);
  if (files.length === 0) return null;
  const file = pickStyle(files, bold, italic);
  const has = styleIs(file.style, bold);

  let result: FindFontResult = 'substitute';
  // Rule 3: the fakes apply only when the family found begins with the one
  // asked for — `searchFont.Lower().StartsWith( aFontName.Lower() )`.
  if (lower(file.family).startsWith(wanted)) {
    if (bold && !has.bold && italic && !has.italic) result = 'missing_bold_ital';
    else if (bold && !has.bold) result = 'missing_bold';
    else if (italic && !has.italic) result = 'missing_ital';
    else if (bold !== has.bold || italic !== has.italic) result = 'substitute';
    else result = 'ok';
  }
  if (result === 'substitute') {
    // "If we missed a case but the matching found the original font name,
    // then we are not substituting" — compared with the style folded in,
    // `fontName + ' ' + style`, which is why a plain family name never
    // matches here and stays a substitute.
    const qualified = `${file.family} ${file.style}`;
    if (lower(qualified) === wanted) result = 'ok';
  }
  return {
    result,
    file,
    fakeBold: result === 'missing_bold' || result === 'missing_bold_ital',
    fakeItalic: result === 'missing_ital' || result === 'missing_bold_ital',
  };
}
