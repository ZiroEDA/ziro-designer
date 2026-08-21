// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two content sniffs GerbView's Open Autodetected File(s) runs.
 *
 * Ours had an invented heuristic instead — it looked for `%FS`, `FMAT`,
 * `;FILE_FORMAT` and the filename's extension, none of which either upstream
 * function reads — and, worse, it could not say "no": a file matching neither
 * fell through to the gerber parser and loaded as an empty layer. A live
 * GerbView refuses it and names it in an Errors box.
 */
import { describe, expect, it } from 'vitest';
import { detectFileType, testFileIsExcellon, testFileIsRS274 } from '@ziroeda/gerbview';

const GERBER = [
  'G04 test*',
  '%FSLAX46Y46*%',
  '%MOMM*%',
  '%ADD10C,0.5*%',
  'D10*',
  'X0Y0D03*',
  'M02*',
].join('\n');

/** A drill file with a header, a tool and a hole. */
const DRILL = [
  'M48',
  'FMAT,2',
  'METRIC,TZ',
  'T1C0.800',
  '%',
  'G90',
  'T1',
  'X10.0Y20.0',
  'M30',
].join('\n');

describe('TestFileIsRS274', () => {
  it('accepts a plain RS-274X plot', () => {
    expect(testFileIsRS274(GERBER)).toBe(true);
  });

  it('needs a command, a star and a coordinate — all three', () => {
    // ( foundD0 || foundD2 || foundM0 || foundM2 ) && foundStar && ( foundX || foundY )
    //
    // Every flag is file-wide, not per line, so dropping the star means
    // dropping it EVERYWHERE — the aperture line carries one too. Getting that
    // wrong is how this test first claimed a gerber was not a gerber.
    expect(testFileIsRS274('%ADD10C,0.5*%\nX0Y0D03*\n')).toBe(true); // D0 via D03
    expect(testFileIsRS274('%ADD10C,0.5*%\nM02*\n')).toBe(false); // no X/Y
    expect(testFileIsRS274('%ADD10C,0.5%\nX0Y0D03\n')).toBe(false); // no star at all
    expect(testFileIsRS274('%ADD10C,0.5*%\nX0Y0*\n')).toBe(false); // no D/M command
  });

  it('accepts RS-274D, which is the same test without %ADD', () => {
    // Upstream keeps the two returns separate — "someday we might want to test
    // for them separately" — so a file with no aperture definitions is still a
    // gerber.
    expect(testFileIsRS274('X0Y0D02*\n')).toBe(true);
  });

  it('rejects a file with any non-ASCII byte', () => {
    expect(testFileIsRS274(`${GERBER}\nG04 café*`)).toBe(false);
  });

  it('reads only the FIRST X on a line, as strstr does', () => {
    // `letter = strstr( line, "X" ); if( isdigit( letter[1] ) )` — a later X
    // with a digit does not rescue a first one without.
    //
    // Both axes have to fail for the file to fail, since the condition is
    // ( foundX || foundY ): `XY5` sets foundY off the same line and the file
    // passes anyway, which is why the negative case gives each axis its own
    // line and a non-digit after each.
    expect(testFileIsRS274('D02*\nXA*\nYB*\n')).toBe(false);
    expect(testFileIsRS274('D02*\nX5*\n')).toBe(true);
    expect(testFileIsRS274('D02*\nXY5*\n')).toBe(true); // rescued by Y
  });

  it('refuses a gerber job file, which is JSON', () => {
    // The case that started this: a .gbrjob has no star and no D/M command.
    expect(testFileIsRS274('{\n "FileFunction": "Copper,L1,Top"\n}\n')).toBe(false);
  });

  it('refuses a drill file', () => {
    expect(testFileIsRS274(DRILL)).toBe(false);
  });
});

describe('TestFileIsExcellon', () => {
  it('accepts a drill file with a header, a tool and a hole', () => {
    expect(testFileIsExcellon(DRILL)).toBe(true);
  });

  it('needs M48, a tool SELECT and a coordinate', () => {
    // ( foundX || foundY ) && foundT && foundM48
    //
    // `foundT` comes from `ToCDouble( letter + 1 )` over everything after the
    // first T, and wx requires the WHOLE string to parse — so a tool
    // *definition* line, `T1C0.800`, leaves "1C0.800" and does NOT set it. It
    // takes a bare `T1` select line further down. A header-only file therefore
    // fails on foundT as well as on the dead branch below.
    expect(testFileIsExcellon('M48\nT1C0.800\nX1Y1\nM30')).toBe(false); // definition only
    expect(testFileIsExcellon('M48\nT1C0.800\nT1\nX1Y1\nM30')).toBe(true); // + select
    expect(testFileIsExcellon('FMAT,2\nT1C0.8\nT1\nX1Y1\nM30')).toBe(false); // no M48
  });

  /**
   * The reason Akshay's NPTH file was refused by a real GerbView, and it is a
   * quirk rather than a rule.
   *
   * `foundPercent` is set by
   * `if( ( letter = strstr( line, "%" ) ) ) if( letter[1] == '\r' || letter[1]
   * == '\n' ) foundPercent = true;` — but the line has already been through
   * `StrPurge`, which strips exactly those two characters off the end, so a
   * lone `%` line has `letter[1] == '\0'` and the flag can never be set.
   * `foundM30` is gated on it, so the whole second return — upstream's
   * "pathological case of drill file with valid header and EOF but no drill XY
   * locations" — is unreachable.
   *
   * Which means a drill file with a real header, a real tool list and NO holes
   * is refused. That is what "Not loaded: ...-NPTH.drl" was, on a board with no
   * non-plated holes.
   */
  it('refuses a header-only drill file, because the branch that would save it is dead', () => {
    const noHoles = ['M48', 'FMAT,2', 'METRIC,TZ', 'T1C0.800', '%', 'T1', 'M30'].join('\n');
    expect(testFileIsExcellon(noHoles)).toBe(false);
    // And it is not a gerber either, so autodetect refuses it outright.
    expect(detectFileType(noHoles)).toBeNull();
  });

  it('stops looking at a line once a comment starts', () => {
    // `char* buf = strstr( line, ";" ); if( buf ) *buf = 0;`
    expect(testFileIsExcellon('M48\nT1C0.800\nT1\nX1Y1\n;M30 T9 X9')).toBe(true);
    expect(testFileIsExcellon(';M48\nT1C0.800\nT1\nX1Y1')).toBe(false);
  });

  it('rejects a file with any non-ASCII byte', () => {
    expect(testFileIsExcellon(`${DRILL}\n; café`)).toBe(false);
  });

  it('refuses a gerber plot', () => {
    expect(testFileIsExcellon(GERBER)).toBe(false);
  });
});

describe('autodetect', () => {
  it('tries Excellon FIRST, then RS-274, which is upstream’s order', () => {
    // if( TestFileIsExcellon ) type = 1; else if( TestFileIsRS274 ) type = 0;
    expect(detectFileType(DRILL)).toBe(1);
    expect(detectFileType(GERBER)).toBe(0);
  });

  it('returns null when a file is neither, rather than guessing', () => {
    // The type stays 2 upstream and falls to `default:` — the file is refused.
    // Ours used to fall through to the gerber parser and load an empty layer.
    expect(detectFileType('{ "Header": {} }')).toBeNull();
    expect(detectFileType('hello world\n')).toBeNull();
    expect(detectFileType('')).toBeNull();
  });
});
