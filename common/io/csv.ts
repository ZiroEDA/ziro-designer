// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/csv.h` + `common/io/csv.cpp`: `CSV_WRITER` and `AutoDecodeCSV`.
 *
 * Upstream decodes through `rapidcsv::Document`; the part of it
 * `AutoDecodeCSV` reaches - `ParseCsv` with its `Trim` and `Unquote`, the
 * UTF-8 BOM skip, `GetColumnCount` and `GetRow` with no label row or column -
 * is ported inline below as {@link parseCsv}.
 */

/** `CSV_WRITER`: writes into a string where upstream writes a `wxOutputStream`. */
export class CSV_WRITER {
  private m_stream: string[];
  private m_delimiter = ',';
  private m_quote = '"';
  private m_lineTerminator = '\n';
  private m_escape = '';

  /** @param aStream receives each line as it is written. */
  constructor(aStream: string[]) {
    this.m_stream = aStream;
  }

  WriteLines(aRows: readonly (readonly string[])[]): void {
    for (const row of aRows) this.WriteLine(row);
  }

  WriteLine(aCols: readonly string[]): void {
    let line = '';

    for (let i = 0; i < aCols.length; ++i) {
      let colVal = aCols[i]!;

      if (i > 0) line += this.m_delimiter;

      const useEscape = this.m_escape.length > 0;

      if (useEscape) colVal = colVal.replaceAll(this.m_quote, this.m_escape + this.m_quote);
      else colVal = colVal.replaceAll(this.m_quote, this.m_quote + this.m_quote);

      // Always quote - if that's a problem, we can only quote if the
      // delimiter (or newlines?) are present in the string.
      colVal = this.m_quote + colVal + this.m_quote;

      line += colVal;
    }

    line += this.m_lineTerminator;

    this.m_stream.push(line);
  }

  SetDelimiter(aDelimiter: string): void {
    this.m_delimiter = aDelimiter;
  }

  SetEscape(aEscape: string): void {
    this.m_escape = aEscape;
  }
}

/** `isspace` in the C locale. A UTF-8 lead or trail byte is never a space. */
const isspace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\v' || ch === '\f' || ch === '\r';

/**
 * `rapidcsv::Document( stream, LabelParams( -1, -1 ), SeparatorParams(
 * aDelimiter, aTrim ), ConverterParams(), LineReaderParams( aSkipComments,
 * aCommentPrefix, aSkipEmpty ) )`, returning its `mData`. Every character it
 * tests is ASCII, so walking UTF-16 code units splits where upstream's walk
 * over UTF-8 bytes does.
 */
function parseCsv(
  aInput: string,
  aSeparator: string,
  aTrim: boolean,
  aSkipCommentLines: boolean,
  aCommentPrefix: string,
  aSkipEmptyLines: boolean,
): string[][] {
  const quoteChar = '"';

  const trim = (aStr: string): string => {
    if (!aTrim) return aStr;

    let b = 0;
    let e = aStr.length;

    while (b < e && isspace(aStr[b]!)) ++b;
    while (e > b && isspace(aStr[e - 1]!)) --e;

    return aStr.slice(b, e);
  };

  // `mAutoQuote` is on by default.
  const unquote = (aStr: string): string => {
    if (aStr.length >= 2 && aStr[0] === quoteChar && aStr[aStr.length - 1] === quoteChar)
      return aStr.slice(1, -1).replaceAll(quoteChar + quoteChar, quoteChar);

    return aStr;
  };

  const data: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endRow = (): void => {
    row.push(unquote(trim(cell)));

    if (!(aSkipCommentLines && row[0]!.length > 0 && row[0]![0] === aCommentPrefix)) data.push(row);

    cell = '';
    row = [];
    quoted = false;
  };

  // `ReadCsv`: a UTF-8 byte order mark is skipped.
  const input = aInput.startsWith('﻿') ? aInput.slice(1) : aInput;

  for (const ch of input) {
    if (ch === quoteChar) {
      if (cell.length === 0 || cell[0] === quoteChar) {
        quoted = !quoted;
      } else if (aTrim) {
        // allow whitespace before first mQuoteChar
        const firstQuote = cell.indexOf(quoteChar);
        const lead = firstQuote < 0 ? cell : cell.slice(0, firstQuote);

        if ([...lead].every(isspace)) quoted = !quoted;
      }

      cell += ch;
    } else if (ch === aSeparator) {
      if (!quoted) {
        row.push(unquote(trim(cell)));
        cell = '';
      } else {
        cell += ch;
      }
    } else if (ch === '\r') {
      // `mQuotedLinebreaks` is off: a CR is only counted.
    } else if (ch === '\n') {
      if (aSkipEmptyLines && row.length === 0 && cell.length === 0) {
        // skip empty line
      } else {
        endRow();
      }
    } else {
      cell += ch;
    }
  }

  // Handle last row / cell without linebreak
  if (!(row.length === 0 && cell.length === 0)) endRow();

  return data;
}

/**
 * Decode a CSV or TSV string into rows: a tab anywhere makes it TSV. Every row
 * takes the first row's column count, padded with empty cells or cut short.
 *
 * @returns true when the first row has anything in it.
 */
export function AutoDecodeCSV(aInput: string, aData: string[][]): boolean {
  // Read the first line to determine the delimiter
  const trimCells = true;
  const skipCommentLines = true;
  const skipEmptyLines = true;
  const commentPrefix = '#';
  let delimiter = ',';

  // Assume if we find a tab, we are dealing with a TSV file
  if (aInput.includes('\t')) delimiter = '\t';

  const doc = parseCsv(
    aInput,
    delimiter,
    trimCells,
    skipCommentLines,
    commentPrefix,
    skipEmptyLines,
  );

  // Read the data into aData
  aData.length = 0;

  const rowCount = doc.length;
  const colCount = doc.length > 0 ? doc[0]!.length : 0;

  for (let i = 0; i < rowCount; ++i) {
    const docRow = doc[i]!;
    const outRow: string[] = new Array<string>(colCount).fill('');

    for (let j = 0; j < Math.min(colCount, docRow.length); ++j) outRow[j] = docRow[j]!;

    aData.push(outRow);
  }

  // Anything in the first row?
  return aData.length > 0 && aData[0]!.length > 0;
}
