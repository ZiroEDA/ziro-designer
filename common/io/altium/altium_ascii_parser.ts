// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/altium/altium_ascii_parser.cpp` / `.h`: `ALTIUM_ASCII_PARSER`, the reader for
 * Altium's ASCII schematic format (`|HEADER=Protel for Windows - Schematic Capture Ascii
 * File Version 5.0`): one `|KEY=value|KEY=value` record per line.
 *
 * It reads the bytes as `std::ifstream` + `std::getline` do: lines split on '\n' only (a CRLF
 * file keeps its '\r'), keys and values Latin-1 unless the key starts `%UTF8%`.
 */
import { AltiumPropertyToKiCadString } from './altium_parser_utils.js';

/** wxString::Trim( fromRight ): isspace. */
const trimRight = (s: string): string => s.replace(/[ \t\n\v\f\r]+$/, '');
const trimLeft = (s: string): string => s.replace(/^[ \t\n\v\f\r]+/, '');

export class ALTIUM_ASCII_PARSER {
  private readonly m_bytes: Uint8Array;
  private m_pos = 0;
  private m_error = false;

  /** `ALTIUM_ASCII_PARSER( aInputFile )`, over the file's bytes. */
  constructor(aFileBytes: Uint8Array) {
    this.m_bytes = aFileBytes;
  }

  /** `std::getline`: the next line's bytes as a Latin-1 string, or null at end of file. */
  private getline(): string | null {
    if (this.m_pos >= this.m_bytes.length) return null;

    let end = this.m_bytes.indexOf(0x0a, this.m_pos);
    const next = end < 0 ? this.m_bytes.length : end + 1;

    if (end < 0) end = this.m_bytes.length;

    let line = '';

    for (let i = this.m_pos; i < end; i++) line += String.fromCharCode(this.m_bytes[i]!);

    this.m_pos = next;
    return line;
  }

  ReadProperties(): Map<string, string> {
    const kv = new Map<string, string>();
    let str = '';

    // Lines ending with |> continue on the next line
    for (;;) {
      const line = this.getline();

      if (line === null) {
        this.m_error = true;
        return kv;
      }

      if (line.length > 2 && line[line.length - 2] === '|' && line[line.length - 1] === '>') {
        str += line.slice(0, line.length - 2);
      } else {
        str += line;
        break;
      }
    }

    const npos = -1;
    const find = (c: string, from: number): number => (from < 0 ? npos : str.indexOf(c, from));
    // `size_t` comparisons: npos is the largest value.
    const le = (a: number, b: number): boolean => (a === npos ? b === npos : b === npos || a <= b);
    const ge = (a: number, b: number): boolean => le(b, a);

    let token_end = 0;

    while (token_end < str.length && token_end !== npos) {
      const token_start = find('|', token_end);
      const token_equal = find('=', token_end);
      let key_start: number;

      if (le(token_start, token_equal)) {
        // `token_start + 1`: npos + 1 wraps to 0 in size_t.
        key_start = token_start === npos ? 0 : token_start + 1;
      } else {
        // Leading "|" before "RECORD=28" may be missing in older schematic versions.
        key_start = token_end;
      }

      token_end = find('|', key_start);

      if (ge(token_equal, token_end)) {
        continue; // this looks like an error: skip the entry. Also matches on std::string::npos
      }

      if (token_end === npos) {
        token_end = str.length + 1; // this is the correct offset
      }

      const keyS = str.substring(key_start, token_equal);
      const valueS = str.substr(token_equal + 1, token_end - token_equal - 1);

      // Altium stores keys either in Upper, or in CamelCase. Lets unify it.
      const canonicalKey = trimRight(trimLeft(keyS)).toUpperCase();

      // If the key starts with '%UTF8%' we have to parse the value using UTF8
      let value: string;

      if (canonicalKey.startsWith('%UTF8%')) {
        const bytes = Uint8Array.from(valueS, (c) => c.charCodeAt(0));
        value = new TextDecoder('utf-8').decode(bytes);
      } else {
        value = valueS;
      }

      if (canonicalKey !== 'PATTERN' && canonicalKey !== 'SOURCEFOOTPRINTLIBRARY') {
        // Breathless hack because I haven't a clue what the story is here (but this character
        // appears in a lot of radial dimensions and is rendered by Altium as a space).
        value = value.replaceAll('ÿ', ' ');
      }

      // Storage binary data do not need conversion.
      if (!str.startsWith('|BINARY')) {
        if (canonicalKey === 'DESIGNATOR' || canonicalKey === 'NAME' || canonicalKey === 'TEXT') {
          // `kv[ wxT( "RECORD" ) ]`: operator[] makes an empty entry when there is none.
          if (!kv.has('RECORD')) kv.set('RECORD', '');
          const recordType = kv.get('RECORD')!;

          // RECORD=33 (FILE_NAME) stores Windows-formatted paths; keep the backslashes intact.
          if (recordType !== '4' && recordType !== '33') value = AltiumPropertyToKiCadString(value);
        }
      }

      // `std::map::insert`: the first of a key stays.
      if (!kv.has(canonicalKey)) kv.set(canonicalKey, trimRight(value));
    }

    return kv;
  }

  CanRead(): boolean {
    return this.m_pos < this.m_bytes.length;
  }

  HasParsingError(): boolean {
    return this.m_error;
  }
}
