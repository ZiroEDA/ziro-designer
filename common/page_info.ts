// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PAGE_INFO` — `common/page_info.cpp`.
 *
 * Upstream this is one table in `common/`, and every frame that offers a page
 * size reads it: the shared `DIALOG_PAGES_SETTINGS`, the plotters, the
 * renderers. It is `common/` here for the same reason, and because it was not:
 * `PAPER_MM` had grown FIVE copies in this tree — the drawing sheet's, one in
 * `dialog_print_pcb.tsx`, one in `renderBoard.ts`, one in the schematic
 * renderer, and the schematic's page-settings dialog importing the drawing
 * sheet's *component file* sideways, which is the circular ownership between
 * peers the project brief already names. This module is where they collapse to.
 */

/**
 * `PAGE_INFO::standardPageSizes` (common/page_info.cpp:46-68), in its own order.
 *
 * `DIALOG_PAGES_SETTINGS::TransferDataToWindow` (:112-133) appends the WHOLE
 * list to the combo, in this order, with each row's client data set to its
 * PAGE_SIZE_TYPE — so the combo IS this table and nothing sorts or filters it.
 *
 * **PAGE_INFO's unit is MILS, and the metric sizes are rounded into it.** The
 * table is built through
 *
 *     #define MMsize( x, y ) VECTOR2D( Mm2mils( x ), Mm2mils( y ) )
 *     int Mm2mils( double aVal ) { return KiROUND( aVal * 1000. / 25.4 ); }
 *                                            page_info.cpp:38, eda_units.cpp:76
 *
 * so A3 is not 420 mm — it is `KiROUND( 420 * 1000 / 25.4 )` = **16535 mils**,
 * which is 419.989 mm. We stored the millimetres instead and were 0.011 mm
 * wide, which is invisible on screen and completely visible the moment a number
 * is printed: pl_editor's message panel reads "Page Width 419.9890 mm" where
 * ours read "420.0000 mm".
 *
 * Storing mils and deriving the millimetres puts the rounding where upstream
 * has it instead of throwing it away. See [[wx-panel-state-is-field-text]] —
 * holding more precision than KiCad holds is a parity bug, not an improvement.
 *
 * Landscape W×H, in the C++'s own order ("All MUST be defined as landscape").
 */
export const PAPER_MILS: Record<string, [number, number]> = {
  A5: [8268, 5827],
  A4: [11693, 8268],
  A3: [16535, 11693],
  A2: [23386, 16535],
  A1: [33110, 23386],
  A0: [46811, 33110],
  A: [11000, 8500],
  B: [17000, 11000],
  C: [22000, 17000],
  D: [34000, 22000],
  E: [44000, 34000],
  GERBER: [32000, 32000],
  User: [17000, 11000],
  USLetter: [11000, 8500],
  USLegal: [14000, 8500],
  USLedger: [17000, 11000],
};

/**
 * The same table in millimetres, derived rather than declared.
 *
 * `GetWidthIU` is `int GetWidthIU( double aIUScale ) { return aIUScale *
 * GetWidthMils(); }` (page_info.h:159) — an **int**, so the IU value truncates
 * as well. At pl_editor's scale (`drawSheetIUScale`, 25.4 IU per mil) A3 comes
 * out 419989 x 297002 IU, which is what makes its message panel print
 * "419.9890" and "297.0020" rather than "419.9890" and "297.0022".
 */
export const PAPER_MM: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(PAPER_MILS).map(([k, [w, h]]) => [k, [(w * 25.4) / 1000, (h * 25.4) / 1000]]),
) as Record<string, [number, number]>;

/**
 * The combo, row for row.
 *
 * Three things the audit found wrong and all three are in the C++ verbatim:
 * the descriptions have SPACES around the `x` ("A5 148 x 210mm"), the US sizes
 * are two words ("US Letter"), and `User (Custom)` is the 13th row rather than
 * the last — because the table's order is the combo's order and the US sizes
 * come after it.
 *
 * The blank row at 12 is not a mistake either: `PAGE_SIZE_TYPE::GERBER` is
 * declared with `wxPAPER_NONE` and NO `_HKI` description (page_info.cpp:62), so
 * `Append( wxGetTranslation( "" ) )` puts an empty row in the list. It selects
 * a real 32000 x 32000 mil page. Reproduced rather than tidied away: the bar is
 * that a user cannot tell which app they are in.
 */
import type { OUTPUTFORMATTER } from './richio.js';
import { FormatDouble2Str } from './string_utils.js';
export const PAPER_CHOICES: { id: string; label: string }[] = [
  { id: 'A5', label: 'A5 148 x 210mm' },
  { id: 'A4', label: 'A4 210 x 297mm' },
  { id: 'A3', label: 'A3 297 x 420mm' },
  { id: 'A2', label: 'A2 420 x 594mm' },
  { id: 'A1', label: 'A1 594 x 841mm' },
  { id: 'A0', label: 'A0 841 x 1189mm' },
  { id: 'A', label: 'A 8.5 x 11in' },
  { id: 'B', label: 'B 11 x 17in' },
  { id: 'C', label: 'C 17 x 22in' },
  { id: 'D', label: 'D 22 x 34in' },
  { id: 'E', label: 'E 34 x 44in' },
  { id: 'GERBER', label: '' },
  { id: 'User', label: 'User (Custom)' },
  { id: 'USLetter', label: 'US Letter 8.5 x 11in' },
  { id: 'USLegal', label: 'US Legal 8.5 x 14in' },
  { id: 'USLedger', label: 'US Ledger 11 x 17in' },
];

/**
 * `PAGE_INFO::GetWidthIU` / `GetHeightIU` — page size in internal units.
 *
 *     int GetWidthIU( double aIUScale ) const { return aIUScale * GetWidthMils(); }
 *                                                          page_info.h:159, 168
 *
 * The **int** return is not incidental. At pl_editor's scale (`drawSheetIUScale`,
 * 25.4 IU per mil) A3's height is 11693 x 25.4 = 297002.2, which truncates to
 * 297002 IU; converted back for display that is 297.0020 mm, and it is exactly
 * what a live pl_editor's message panel prints. Carrying the .2 would print
 * 297.0022 and be wrong by being more accurate.
 */
export function pageSizeIU(paper: string, iuPerMil: number): [number, number] {
  const mils = PAPER_MILS[paper];
  if (!mils) return [0, 0];
  return [Math.trunc(iuPerMil * mils[0]), Math.trunc(iuPerMil * mils[1])];
}

/** IU per mil at pl_editor's scale: PL_IU_PER_MM (1e3) x 25.4 / 1000. */
export const DRAW_SHEET_IU_PER_MIL = 25.4;

/**
 * The page size as the drawing sheet editor's message panel prints it —
 * millimetres, after the mils rounding AND the integer-IU truncation above.
 */
export function pageSizeDisplayMM(paper: string): [number, number] {
  const [w, h] = pageSizeIU(paper, DRAW_SHEET_IU_PER_MIL);
  return [w / 1000, h / 1000];
}

/**
 * The page a `(paper …)` TOKEN names, in millimetres — the file's spelling
 * rather than a `PAGE_INFO` field.
 *
 * Two forms, and both matter: a name with an optional `portrait` keyword, which
 * swaps the landscape pair above; and `User <w> <h>`, whose two numbers ARE the
 * size in millimetres and so cannot come out of any table — that is what "user"
 * means. `PAPER_MILS`' `User: [17000, 11000]` is `PAGE_INFO`'s *initial* custom
 * page, not the one a given file holds.
 *
 * It lives here because two renderers needed it and each had grown its own
 * copy: `editors/schematic/render/renderer.ts` handled `User` and
 * `editors/pcb/renderBoard.ts` did not, so a board saved with a custom page
 * size drew neither its drawing sheet nor its page limits while the same
 * schematic drew both. Millimetres, not IU: pcbnew's internal unit is a
 * nanometre and eeschema's is 100 nm, so a shared function returning IU would
 * be wrong in one of the two callers — see [[iu-scale-differs-per-editor]].
 */
export function pageSizeMM(paper: string | undefined): { w: number; h: number } | null {
  if (!paper) return null;

  const parts = paper.trim().split(/\s+/);

  if (parts[0] === 'User') {
    const w = Number(parts[1]);
    const h = Number(parts[2]);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
  }

  const dims = PAPER_MM[parts[0] ?? ''];
  if (!dims) return null;

  const [w, h] = parts.includes('portrait') ? [dims[1], dims[0]] : dims;
  return { w, h };
}

// ---------------------------------------------------------------------------
// PAGE_INFO (include/page_info.h / common/page_info.cpp)
// ---------------------------------------------------------------------------

/// Min and max page sizes for clamping, in mils.
export const MIN_PAGE_SIZE_MILS = 1000;
export const MAX_PAGE_SIZE_PCBNEW_MILS = 48000;
export const MAX_PAGE_SIZE_EESCHEMA_MILS = 120000;

/// Min and max page sizes for clamping, in mm.
export const MIN_PAGE_SIZE_MM = 25.4;
export const MAX_PAGE_SIZE_PCBNEW_MM = 48000 * 0.0254;
export const MAX_PAGE_SIZE_EESCHEMA_MM = 120000 * 0.0254;

/*
 * @brief Standard paper sizes nicknames
 * Do not rename entires as these names are saved to file and parsed back
 */
export enum PAGE_SIZE_TYPE {
  A5 = 0,
  A4,
  A3,
  A2,
  A1,
  A0,
  A,
  B,
  C,
  D,
  E,
  GERBER,
  USLetter,
  USLegal,
  USLedger,
  User,
}

/** `magic_enum::enum_name( PAGE_SIZE_TYPE )`. */
const PAGE_SIZE_TYPE_NAMES: readonly string[] = [
  'A5',
  'A4',
  'A3',
  'A2',
  'A1',
  'A0',
  'A',
  'B',
  'C',
  'D',
  'E',
  'GERBER',
  'USLetter',
  'USLegal',
  'USLedger',
  'User',
];

/** `wxPaperSize`, the wx print ids the table names; `wxPAPER_NONE` is 0. */
export enum wxPaperSize {
  wxPAPER_NONE = 0,
  wxPAPER_LETTER = 1,
  wxPAPER_LEGAL = 5,
  wxPAPER_A3 = 8,
  wxPAPER_A4 = 9,
  wxPAPER_A5 = 11,
  wxPAPER_TABLOID = 3,
  wxPAPER_CSHEET = 24,
  wxPAPER_DSHEET = 25,
  wxPAPER_ESHEET = 26,
  wxPAPER_A2 = 66,
  wxPAPER_A1 = 99,
  wxPAPER_A0 = 100,
}

/** `wxPrintOrientation`. */
export enum wxPrintOrientation {
  wxPORTRAIT = 1,
  wxLANDSCAPE = 2,
}

/** `EDA_UNIT_UTILS::Mm2mils`: `KiROUND( aVal * 1000. / 25.4 )`. */
const Mm2mils = (aVal: number): number => Math.round((aVal * 1000) / 25.4);

// local readability macro for millimeter wxSize
const MMsize = (x: number, y: number): { x: number; y: number } => ({
  x: Mm2mils(x),
  y: Mm2mils(y),
});

function clampWidth(aWidthInMils: number): number {
  if (aWidthInMils < 10) aWidthInMils = 10;

  return aWidthInMils;
}

function clampHeight(aHeightInMils: number): number {
  if (aHeightInMils < 10.0) aHeightInMils = 10.0;

  return aHeightInMils;
}

/**
 * Describe the page size and margins of a paper page on which to eventually print or plot.
 *
 * Paper sizes are often described in inches.  Here paper is described in 1/1000th of an
 * inch (mils).  For convenience there are some read only accessors for internal units
 * which is a compile time calculation, not runtime.
 */
export class PAGE_INFO {
  // Custom paper size for next instantiation of type "User"
  private static s_user_width = 17000;
  private static s_user_height = 11000;

  // all dimensions here are in mils
  private m_type: PAGE_SIZE_TYPE; ///< paper type: A4, A3, etc.
  private m_size: { x: number; y: number }; ///< mils
  private m_portrait: boolean; ///< true if portrait, false if landscape
  private m_paper_id: wxPaperSize; ///< wx' style paper id.
  private m_description: string; ///< more human friendly description of page size

  // only the class implementation(s) may use this constructor
  private static make(
    aSizeMils: { x: number; y: number },
    aType: PAGE_SIZE_TYPE,
    aPaperId: wxPaperSize,
    aDescription = '',
  ): PAGE_INFO {
    const p = Object.create(PAGE_INFO.prototype) as PAGE_INFO;
    p.m_type = aType;
    p.m_size = { ...aSizeMils };
    p.m_paper_id = aPaperId;
    p.m_description = aDescription;
    p.m_portrait = false;
    p.updatePortrait();

    // This constructor is protected, and only used by const PAGE_INFO's known
    // only to class implementation, so no further changes to "this" object are
    // expected.
    return p;
  }

  // Standard page sizes in mils, all constants
  // see:  https://lists.launchpad.net/kicad-developers/msg07389.html
  // also see: wx/defs.h
  private static standardPageSizes: PAGE_INFO[] = [
    // All MUST be defined as landscape.
    PAGE_INFO.make(MMsize(210, 148), PAGE_SIZE_TYPE.A5, wxPaperSize.wxPAPER_A5, 'A5 148 x 210mm'),
    PAGE_INFO.make(MMsize(297, 210), PAGE_SIZE_TYPE.A4, wxPaperSize.wxPAPER_A4, 'A4 210 x 297mm'),
    PAGE_INFO.make(MMsize(420, 297), PAGE_SIZE_TYPE.A3, wxPaperSize.wxPAPER_A3, 'A3 297 x 420mm'),
    PAGE_INFO.make(MMsize(594, 420), PAGE_SIZE_TYPE.A2, wxPaperSize.wxPAPER_A2, 'A2 420 x 594mm'),
    PAGE_INFO.make(MMsize(841, 594), PAGE_SIZE_TYPE.A1, wxPaperSize.wxPAPER_A1, 'A1 594 x 841mm'),
    PAGE_INFO.make(MMsize(1189, 841), PAGE_SIZE_TYPE.A0, wxPaperSize.wxPAPER_A0, 'A0 841 x 1189mm'),
    PAGE_INFO.make(
      { x: 11000, y: 8500 },
      PAGE_SIZE_TYPE.A,
      wxPaperSize.wxPAPER_LETTER,
      'A 8.5 x 11in',
    ),
    PAGE_INFO.make(
      { x: 17000, y: 11000 },
      PAGE_SIZE_TYPE.B,
      wxPaperSize.wxPAPER_TABLOID,
      'B 11 x 17in',
    ),
    PAGE_INFO.make(
      { x: 22000, y: 17000 },
      PAGE_SIZE_TYPE.C,
      wxPaperSize.wxPAPER_CSHEET,
      'C 17 x 22in',
    ),
    PAGE_INFO.make(
      { x: 34000, y: 22000 },
      PAGE_SIZE_TYPE.D,
      wxPaperSize.wxPAPER_DSHEET,
      'D 22 x 34in',
    ),
    PAGE_INFO.make(
      { x: 44000, y: 34000 },
      PAGE_SIZE_TYPE.E,
      wxPaperSize.wxPAPER_ESHEET,
      'E 34 x 44in',
    ),

    // US paper sizes
    PAGE_INFO.make({ x: 32000, y: 32000 }, PAGE_SIZE_TYPE.GERBER, wxPaperSize.wxPAPER_NONE),
    PAGE_INFO.make(
      { x: 17000, y: 11000 },
      PAGE_SIZE_TYPE.User,
      wxPaperSize.wxPAPER_NONE,
      'User (Custom)',
    ),

    PAGE_INFO.make(
      { x: 11000, y: 8500 },
      PAGE_SIZE_TYPE.USLetter,
      wxPaperSize.wxPAPER_LETTER,
      'US Letter 8.5 x 11in',
    ),
    PAGE_INFO.make(
      { x: 14000, y: 8500 },
      PAGE_SIZE_TYPE.USLegal,
      wxPaperSize.wxPAPER_LEGAL,
      'US Legal 8.5 x 14in',
    ),
    PAGE_INFO.make(
      { x: 17000, y: 11000 },
      PAGE_SIZE_TYPE.USLedger,
      wxPaperSize.wxPAPER_TABLOID,
      'US Ledger 11 x 17in',
    ),
  ];

  constructor(aType: PAGE_SIZE_TYPE = PAGE_SIZE_TYPE.A3, aIsPortrait = false) {
    this.m_type = PAGE_SIZE_TYPE.A4;
    this.m_size = { x: PAGE_INFO.s_user_width, y: PAGE_INFO.s_user_height };
    this.m_portrait = false;
    this.m_paper_id = wxPaperSize.wxPAPER_NONE;
    this.m_description = '';
    this.SetType(aType, aIsPortrait);
  }

  /** The compiler-generated copy (`PAGE_INFO pageInfo = aBoard->GetPageSettings()`). */
  static copyOf(aOther: PAGE_INFO): PAGE_INFO {
    const p = Object.create(PAGE_INFO.prototype) as PAGE_INFO;
    p.assign(aOther);
    return p;
  }

  /** `operator=` (`*this = *result`). */
  assign(aOther: PAGE_INFO): this {
    this.m_type = aOther.m_type;
    this.m_size = { ...aOther.m_size };
    this.m_portrait = aOther.m_portrait;
    this.m_paper_id = aOther.m_paper_id;
    this.m_description = aOther.m_description;
    return this;
  }

  /** The compiler-generated `operator==` (`m_paper != aPageSettings` in BOARD). */
  equals(aOther: PAGE_INFO): boolean {
    return (
      this.m_type === aOther.m_type &&
      this.m_size.x === aOther.m_size.x &&
      this.m_size.y === aOther.m_size.y &&
      this.m_portrait === aOther.m_portrait &&
      this.m_paper_id === aOther.m_paper_id &&
      this.m_description === aOther.m_description
    );
  }

  private updatePortrait(): void {
    // update m_portrait based on orientation of m_size.x and m_size.y
    this.m_portrait = this.m_size.y > this.m_size.x;
  }

  /**
   * Set the name of the page type and also the sizes and margins commonly associated with
   * that type name.
   *
   * @param aPageSize is one of the PAGE_SIZE_TYPE values, or its name: "A5" "A4" "A3"
   * "A2" "A1" "A0" "A" "B" "C" "D" "E" "GERBER", "USLetter", "USLegal", "USLedger",
   * or "User".  If "User" then the width and height are custom, and will be set
   * according to <b>previous</b> calls to static PAGE_INFO::SetUserWidthMils() and
   * static PAGE_INFO::SetUserHeightMils();
   * @param aIsPortrait Set to true to set page orientation to portrait mode.
   * @return true if @a aStandarePageDescription was a recognized type.
   */
  SetType(aPageSize: PAGE_SIZE_TYPE | string, aIsPortrait = false): boolean {
    if (typeof aPageSize === 'string') {
      // magic_enum::enum_cast<PAGE_SIZE_TYPE>( …, magic_enum::case_insensitive )
      const lower = aPageSize.toLowerCase();
      const idx = PAGE_SIZE_TYPE_NAMES.findIndex((n) => n.toLowerCase() === lower);

      if (idx < 0) return false;

      return this.SetType(idx as PAGE_SIZE_TYPE, aIsPortrait);
    }

    const aType = aPageSize;
    let rc = true;

    const result = PAGE_INFO.standardPageSizes.find((p) => p.m_type === aType);

    if (result) this.assign(result);
    else rc = false;

    if (aType === PAGE_SIZE_TYPE.User) {
      this.m_type = PAGE_SIZE_TYPE.User;
      this.m_paper_id = wxPaperSize.wxPAPER_NONE;
      this.m_size.x = PAGE_INFO.s_user_width;
      this.m_size.y = PAGE_INFO.s_user_height;

      this.updatePortrait();
    }

    if (aIsPortrait) {
      // all private PAGE_INFOs are landscape, must swap x and y
      [this.m_size.x, this.m_size.y] = [this.m_size.y, this.m_size.x];
      this.updatePortrait();
    }

    return rc;
  }

  GetType(): PAGE_SIZE_TYPE {
    return this.m_type;
  }

  GetTypeAsString(): string {
    return PAGE_SIZE_TYPE_NAMES[this.m_type]!;
  }

  GetPageFormatDescription(): string {
    return this.m_description;
  }

  /**
   * @return True if the object has the default page settings which are A3, landscape.
   */
  IsDefault(): boolean {
    return this.m_type === PAGE_SIZE_TYPE.A3 && !this.m_portrait;
  }

  /**
   * @return true if the type is Custom.
   */
  IsCustom(): boolean {
    return this.m_type === PAGE_SIZE_TYPE.User;
  }

  /**
   * Rotate the paper page 90 degrees.
   *
   * This PAGE_INFO may either be in portrait or landscape mode.  Use this function to
   * change from one mode to the other mode.
   *
   * @param aIsPortrait if true and not already in portrait mode, will change this
   *                    PAGE_INFO to portrait mode.  Or if false and not already in
   *                    landscape mode, will change this PAGE_INFO to landscape mode.
   */
  SetPortrait(aIsPortrait: boolean): void {
    if (this.m_portrait !== aIsPortrait) {
      // swap x and y in m_size
      [this.m_size.x, this.m_size.y] = [this.m_size.y, this.m_size.x];

      this.m_portrait = aIsPortrait;

      // margins are not touched, do that if you want
    }
  }

  IsPortrait(): boolean {
    return this.m_portrait;
  }

  /**
   * @return ws' style printing orientation (wxPORTRAIT or wxLANDSCAPE).
   */
  GetWxOrientation(): wxPrintOrientation {
    return this.IsPortrait() ? wxPrintOrientation.wxPORTRAIT : wxPrintOrientation.wxLANDSCAPE;
  }

  /**
   * @return wxPrintData's style paper id associated with page type name.
   */
  GetPaperId(): wxPaperSize {
    return this.m_paper_id;
  }

  SetWidthMM(aWidthInMM: number): void {
    this.SetWidthMils((aWidthInMM * 1000) / 25.4);
  }

  SetWidthMils(aWidthInMils: number): void {
    if (this.m_size.x !== aWidthInMils) {
      this.m_size.x = clampWidth(aWidthInMils);

      this.m_type = PAGE_SIZE_TYPE.User;
      this.m_paper_id = wxPaperSize.wxPAPER_NONE;

      this.updatePortrait();
    }
  }

  GetWidthMils(): number {
    return this.m_size.x;
  }

  GetWidthMM(): number {
    return (this.m_size.x * 25.4) / 1000;
  }

  SetHeightMM(aHeightInMM: number): void {
    this.SetHeightMils((aHeightInMM * 1000) / 25.4);
  }

  SetHeightMils(aHeightInMils: number): void {
    if (this.m_size.y !== aHeightInMils) {
      this.m_size.y = clampHeight(aHeightInMils);

      this.m_type = PAGE_SIZE_TYPE.User;
      this.m_paper_id = wxPaperSize.wxPAPER_NONE;

      this.updatePortrait();
    }
  }

  GetHeightMils(): number {
    return this.m_size.y;
  }

  GetHeightMM(): number {
    return (this.m_size.y * 25.4) / 1000;
  }

  GetSizeMils(): { x: number; y: number } {
    return this.m_size;
  }

  /**
   * Gets the page width in IU
   *
   * @param aIUScale The IU scale, this is most likely always going to be IU_PER_MILS
   * variable being passed. Note, this constexpr variable changes depending
   * on application, hence why it is passed.
   */
  GetWidthIU(aIUScale: number): number {
    return Math.trunc(aIUScale * this.GetWidthMils());
  }

  /**
   * Gets the page height in IU
   *
   * @param aIUScale The IU scale, this is most likely always going to be IU_PER_MILS
   * variable being passed. Note, this constexpr variable changes depending
   * on application, hence why it is passed.
   */
  GetHeightIU(aIUScale: number): number {
    return Math.trunc(aIUScale * this.GetHeightMils());
  }

  /**
   * Gets the page size in internal units
   *
   * @param aIUScale The IU scale, this is most likely always going to be IU_PER_MILS
   * variable being passed. Note, this constexpr variable changes depending
   * on application, hence why it is passed.
   */
  GetSizeIU(aIUScale: number): { x: number; y: number } {
    return { x: this.GetWidthIU(aIUScale), y: this.GetHeightIU(aIUScale) };
  }

  /**
   * Set the width of Custom page in mils for any custom page constructed or made via
   * SetType() after making this call.
   */
  static SetCustomWidthMils(aWidthInMils: number): void {
    PAGE_INFO.s_user_width = clampWidth(aWidthInMils);
  }

  /**
   * Set the height of Custom page in mils for any custom page constructed or made via
   * SetType() after making this call.
   */
  static SetCustomHeightMils(aHeightInMils: number): void {
    PAGE_INFO.s_user_height = clampHeight(aHeightInMils);
  }

  /**
   * @return custom paper width in mils.
   */
  static GetCustomWidthMils(): number {
    return PAGE_INFO.s_user_width;
  }

  /**
   * @return custom paper height in mils.
   */
  static GetCustomHeightMils(): number {
    return PAGE_INFO.s_user_height;
  }

  /**
   * Output the page class to \a aFormatter in s-expression form.
   *
   * @param aFormatter The #OUTPUTFORMATTER object to write to.
   * @throw IO_ERROR on write error.
   */
  Format(aFormatter: OUTPUTFORMATTER): void {
    const typeStr = PAGE_SIZE_TYPE_NAMES[this.GetType()]!;
    aFormatter.Print(`(paper ${aFormatter.Quotew(typeStr)}`);

    // The page dimensions are only required for user defined page sizes.
    // Internally, the page size is in mils
    if (this.GetType() === PAGE_SIZE_TYPE.User) {
      aFormatter.Print(
        ` ${FormatDouble2Str((this.GetWidthMils() * 25.4) / 1000.0)} ${FormatDouble2Str((this.GetHeightMils() * 25.4) / 1000.0)}`,
      );
    }

    if (!this.IsCustom() && this.IsPortrait()) aFormatter.Print(' portrait');

    aFormatter.Print(')');
  }

  static GetPageFormatsList(): readonly PAGE_INFO[] {
    return PAGE_INFO.standardPageSizes;
  }
}
