// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two content sniffs GerbView's autodetect runs, and the gate that turns
 * "this is neither" into a refusal.
 *
 *     // 2 = Autodetect
 *     if( ( *aFileType )[ii] == 2 )
 *     {
 *         if( EXCELLON_IMAGE::TestFileIsExcellon( ... ) ) ( *aFileType )[ii] = 1;
 *         else if( GERBER_FILE_IMAGE::TestFileIsRS274( ... ) ) ( *aFileType )[ii] = 0;
 *     }
 *
 *     switch( ( *aFileType )[ii] )
 *     {
 *     case 0: Read_GERBER_File( ... ); break;
 *     case 1: Read_EXCELLON_File( ... ); break;
 *     default:
 *         reporter.Report( wxString::Format( MSG_NOT_LOADED, ... ), RPT_SEVERITY_ERROR );
 *     }
 *                                             gerbview/files.cpp:355-401
 *
 * If neither test passes the type stays 2 and falls to `default:` — the file
 * is refused and named in an Errors box. Ours had no such gate: an unreadable
 * file fell through to the gerber parser and loaded as an empty layer.
 *
 * These are ports of the functions, not of the idea. The invented heuristic
 * they replace looked for `%FS`, `FMAT`, `;FILE_FORMAT` and a filename
 * extension, none of which either function reads.
 */

/**
 * `StrPurge` (`common/string_utils.cpp:784-800`): trims " \t\n\r\f\v" from
 * both ends. It matters more than it looks — see {@link testFileIsExcellon}.
 */
const WHITESPACE = ' \t\n\r\f\v';
function strPurge(line: string): string {
  let a = 0;
  let b = line.length;
  while (a < b && WHITESPACE.includes(line[a]!)) a++;
  while (b > a && WHITESPACE.includes(line[b - 1]!)) b--;
  return line.slice(a, b);
}

/** `isascii( line[i] )` over the whole line — a binary file is rejected. */
function isAllAscii(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) > 127) return false;
  return true;
}

/**
 * `strstr( line, "X" )` then `isdigit( letter[1] )` — the FIRST occurrence
 * only. A line whose first `X` is not followed by a digit does not set the
 * flag even if a later one would, and reproducing that is the point of doing
 * this by index rather than with a regex.
 */
function firstAfter(line: string, ch: string): string | null {
  const at = line.indexOf(ch);
  return at === -1 ? null : line.slice(at + 1);
}

const isDigit = (s: string | null): boolean =>
  s !== null && s.length > 0 && s[0]! >= '0' && s[0]! <= '9';

/**
 * `wxString::ToCDouble` on the text after a letter: true when it parses as a
 * C-locale double. Leading whitespace is allowed by wx and a trailing
 * remainder is not, so `"01C0.35"` fails and `"01"` succeeds.
 */
function toCDouble(s: string | null): boolean {
  if (s === null) return false;
  const t = s.trim();
  if (t === '') return false;
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t);
}

/**
 * `GERBER_FILE_IMAGE::TestFileIsRS274` (`gerbview/readgerb.cpp:139-227`).
 *
 * The two returns are identical apart from `foundADD`, which is upstream's
 * doing — RS-274X and RS-274D are told apart there and then folded back
 * together, with the comment "Could be folded into the expression above, but
 * someday we might want to test for them separately". Both are kept so that
 * the day upstream splits them, this splits the same way.
 */
export function testFileIsRS274(text: string): boolean {
  let foundADD = false;
  let foundD0 = false;
  let foundD2 = false;
  let foundM0 = false;
  let foundM2 = false;
  let foundStar = false;
  let foundX = false;
  let foundY = false;

  for (const raw of text.split('\n')) {
    const line = strPurge(raw);
    if (line === '') continue;
    if (!isAllAscii(line)) return false;

    if (line.includes('%ADD')) foundADD = true;
    if (line.includes('D00') || line.includes('D0')) foundD0 = true;
    if (line.includes('D02') || line.includes('D2')) foundD2 = true;
    if (line.includes('M00') || line.includes('M0')) foundM0 = true;
    if (line.includes('M02') || line.includes('M2')) foundM2 = true;
    if (line.includes('*')) foundStar = true;
    if (isDigit(firstAfter(line, 'X'))) foundX = true;
    if (isDigit(firstAfter(line, 'Y'))) foundY = true;
  }

  const anyCommand = foundD0 || foundD2 || foundM0 || foundM2;
  // RS-274X
  if (anyCommand && foundADD && foundStar && (foundX || foundY)) return true;
  // RS-274D
  if (anyCommand && !foundADD && foundStar && (foundX || foundY)) return true;
  return false;
}

/**
 * `EXCELLON_IMAGE::TestFileIsExcellon`
 * (`gerbview/excellon_read_drill_file.cpp:345-452`).
 *
 * Two things here are surprising and both are ported as they stand, because
 * the parity target is what the installed GerbView does:
 *
 * **`foundPercent` can never become true.** The check is
 * `if( ( letter = strstr( line, "%" ) ) != nullptr ) if( letter[1] == '\r' ||
 * letter[1] == '\n' ) foundPercent = true;` — but `line` has already been
 * through `StrPurge`, which strips exactly those two characters off the end.
 * A lone `%` line therefore has `letter[1] == '\0'`. So `foundM30`, which is
 * gated on `foundPercent`, is dead too, and the whole second return
 * (`foundM48 && foundT && foundPercent && foundM30`, upstream's "pathological
 * case ... valid header and EOF but no drill XY locations") is unreachable.
 *
 * **Which is why a drill file with no holes is refused.** With that branch
 * dead, the test reduces to `( foundX || foundY ) && foundT && foundM48`, so
 * an NPTH file for a board that has no non-plated holes — real header, real
 * tool list, no coordinates — fails both sniffs and is reported as
 * "Not loaded". A live GerbView does exactly that, which is what sent us here.
 *
 * The `T` branch is upstream's as well, dead assignment included: the
 * `foundT = false` arm can only run when `foundT` is already false.
 */
export function testFileIsExcellon(text: string): boolean {
  let foundM48 = false;
  let foundM30 = false;
  let foundPercent = false;
  let foundT = false;
  let foundX = false;
  let foundY = false;

  for (const raw of text.split('\n')) {
    let line = strPurge(raw);
    if (line === '') continue;
    if (!isAllAscii(line)) return false;

    // "We don't want to look for any commands after a comment"
    const comment = line.indexOf(';');
    if (comment !== -1) line = line.slice(0, comment);

    if (line.includes('M48')) foundM48 = true;
    if (line.includes('M30') && foundPercent) foundM30 = true;

    const pct = firstAfter(line, '%');
    if (pct !== null && (pct[0] === '\r' || pct[0] === '\n')) foundPercent = true;

    const afterT = firstAfter(line, 'T');
    if (afterT !== null) {
      if (!foundT && (foundX || foundY))
        foundT = false; // "Found first T after X or Y"
      else if (toCDouble(afterT)) foundT = true;
    }

    if (toCDouble(firstAfter(line, 'X'))) foundX = true;
    if (toCDouble(firstAfter(line, 'Y'))) foundY = true;
  }

  if ((foundX || foundY) && foundT && (foundM48 || (foundPercent && foundM30))) return true;
  // "Pathological case of drill file with valid header and EOF but no drill XY
  // locations." Unreachable while foundPercent cannot be set; see above.
  if (foundM48 && foundT && foundPercent && foundM30) return true;
  return false;
}

/**
 * The file types `LoadListOfGerberAndDrillFiles` switches on: 0 gerber,
 * 1 drill, 2 autodetect. Open Gerber File(s) passes 0 for every file, Open NC
 * Drill File(s) passes 1, and Open Autodetected File(s) passes 2 — so only the
 * third one sniffs, and the first two parse whatever they are given.
 */
export const GBR_FILE_TYPE = { GERBER: 0, DRILL: 1, AUTODETECT: 2 } as const;
export type GbrFileType = (typeof GBR_FILE_TYPE)[keyof typeof GBR_FILE_TYPE];

/**
 * Autodetect, resolved: the concrete type, or null when the file is neither
 * and upstream's `default:` branch would refuse it.
 */
export function detectFileType(text: string): 0 | 1 | null {
  if (testFileIsExcellon(text)) return GBR_FILE_TYPE.DRILL;
  if (testFileIsRS274(text)) return GBR_FILE_TYPE.GERBER;
  return null;
}
