// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `.pcbcalc` regulator data file.
 * Counterpart: KiCad `pcb_calculator/datafile_read_write.cpp` and its dedicated
 * lexer `pcb_calculator_datafile.keywords`.
 *
 * The file is an s-expression, not JSON — `PANEL_REGULATOR::WriteDataFile`
 * writes
 *
 *   (datafile
 *    (version 2)
 *    (date "...")
 *    (tool "...")
 *    (regulators
 *     (regulator "LM317"
 *      (reg_vref_min 1.2)
 *      (reg_vref_typ 1.25)
 *      (reg_vref_max 1.3)
 *      (reg_iadj_typ 50)
 *      (reg_iadj_max 100)
 *      (reg_type 3terminal)
 *     )
 *    )
 *   )
 *
 * with the Iadj values in MICROAMPS, as `DIALOG_REGULATOR_FORM` takes them
 * (dialog_regulator_form.cpp:138-150 stores the field verbatim and
 * `PANEL_REGULATOR::RegulatorsSolve` scales by 1e-6 at solve time). We hold
 * amps, so the conversion happens here, at the file boundary.
 *
 * `reg_iadj_*` and `reg_type` are written only for a 3-terminal regulator, and
 * the parser also accepts the legacy single-valued `reg_vref` / `reg_iadj`
 * (datafile_read_write.cpp:270-291).
 */

import { type RegulatorData, RegulatorType } from './regulators_funct.js';

/** `DataFileNameExt` (panel_regulator.cpp:36). */
export const REGULATOR_DATA_FILE_EXT = 'pcbcalc';

/** The wildcard `OnDataFileSelection` builds (panel_regulator.cpp:191-192). */
export const REGULATOR_DATA_FILE_WILDCARD = `PCB Calculator data file (*.${REGULATOR_DATA_FILE_EXT})`;

/** `regtype_str[]` (datafile_read_write.cpp:122). */
const REG_TYPE_STR = ['normal', '3terminal'] as const;

type Tok = { kind: 'open' | 'close' | 'atom' | 'string'; text: string };

/** The lexer PCB_CALCULATOR_DATAFILE_LEXER is generated from: parens, quoted
 *  strings with `\` escapes, and bare atoms. */
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '(') {
      out.push({ kind: 'open', text: '(' });
      i++;
    } else if (c === ')') {
      out.push({ kind: 'close', text: ')' });
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        s += src[i];
        i++;
      }
      i++; // closing quote
      out.push({ kind: 'string', text: s });
    } else if (/\s/.test(c)) {
      i++;
    } else {
      let s = '';
      while (i < src.length && !/[\s()]/.test(src[i]!)) {
        s += src[i];
        i++;
      }
      out.push({ kind: 'atom', text: s });
    }
  }
  return out;
}

/**
 * `PCB_CALCULATOR_DATAFILE_PARSER::Parse`: it walks for `(regulators …)` and
 * ignores everything else in the file, including the version, date and tool.
 * Throws on a file that holds no `regulators` list at all, which is what makes
 * `ReadDataFile` return false and the panel raise "Unable to read data file".
 */
export function parseRegulatorDataFile(src: string): RegulatorData[] {
  const toks = lex(src);
  const out: RegulatorData[] = [];
  let seenList = false;

  for (let i = 0; i < toks.length; i++) {
    if (toks[i]?.kind !== 'open' || toks[i + 1]?.text !== 'regulators') continue;
    seenList = true;
    let depth = 1;
    i += 2;
    while (i < toks.length && depth > 0) {
      const t = toks[i]!;
      if (t.kind === 'close') {
        depth--;
        i++;
        continue;
      }
      if (t.kind === 'open' && toks[i + 1]?.text === 'regulator') {
        const reg = parseRegulator(toks, i + 2);
        if (reg.data) out.push(reg.data);
        i = reg.next;
        continue;
      }
      if (t.kind === 'open') depth++;
      i++;
    }
    break;
  }

  if (!seenList) throw new Error('no regulators list');
  return out;
}

function parseRegulator(toks: Tok[], start: number): { data: RegulatorData | null; next: number } {
  let i = start;
  const name = toks[i]?.text ?? '';
  i++;
  let vrefMin = 0;
  let vrefTyp = 0;
  let vrefMax = 0;
  let iadjTyp = 0;
  let iadjMax = 0;
  let type = RegulatorType.STANDARD;

  while (i < toks.length && toks[i]?.kind !== 'close') {
    if (toks[i]?.kind !== 'open') {
      i++;
      continue;
    }
    const key = toks[i + 1]?.text ?? '';
    const val = toks[i + 2]?.text ?? '';
    const num = Number.parseFloat(val);
    switch (key) {
      // The legacy single-valued entries set all three / both.
      case 'reg_vref':
        vrefMin = vrefTyp = vrefMax = num;
        break;
      case 'reg_vref_min':
        vrefMin = num;
        break;
      case 'reg_vref_typ':
        vrefTyp = num;
        break;
      case 'reg_vref_max':
        vrefMax = num;
        break;
      case 'reg_iadj':
        iadjTyp = iadjMax = num;
        break;
      case 'reg_iadj_typ':
        iadjTyp = num;
        break;
      case 'reg_iadj_max':
        iadjMax = num;
        break;
      case 'reg_type':
        type =
          val.toLowerCase() === REG_TYPE_STR[1]
            ? RegulatorType.THREE_TERMINAL
            : RegulatorType.STANDARD;
        break;
      default:
        break;
    }
    // skip to this entry's closing paren
    let d = 1;
    i++;
    while (i < toks.length && d > 0) {
      if (toks[i]?.kind === 'open') d++;
      else if (toks[i]?.kind === 'close') d--;
      i++;
    }
  }
  i++; // the regulator's own closing paren

  // "if( ! name.IsEmpty() )" — an unnamed entry is dropped, not an error.
  if (!name) return { data: null, next: i };
  return {
    data: {
      name,
      vrefMin,
      vrefTyp,
      vrefMax,
      // µA in the file, amps in memory.
      iadjTyp: iadjTyp * 1e-6,
      iadjMax: iadjMax * 1e-6,
      type,
    },
    next: i,
  };
}

const quote = (s: string): string => `"${s.replace(/(["\\])/g, '\\$1')}"`;

/** fmt "{:g}", i.e. C's %g. */
function g(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const s = v.toPrecision(6);
  const n = Number(s);
  return String(n).replace(/e([+-])(\d)$/, 'e$10$2');
}

/**
 * `WriteHeader` + `Format` (datafile_read_write.cpp:127-174). The date is
 * ISO 8601 and the tool is the application's name and version, exactly as
 * `GetISO8601CurrentDateTime()` and `Pgm().App().GetAppName()` produce them.
 */
export function formatRegulatorDataFile(
  regulators: readonly RegulatorData[],
  tool: string,
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push('(datafile');
  lines.push('  (version 2)');
  lines.push(`  (date ${quote(now.toISOString().replace(/\.\d+Z$/, 'Z'))})`);
  lines.push(`  (tool ${quote(tool)})`);
  lines.push('  (regulators');
  for (const r of regulators) {
    lines.push(`   (regulator ${quote(r.name)}`);
    lines.push(`    (reg_vref_min ${g(r.vrefMin)})`);
    lines.push(`    (reg_vref_typ ${g(r.vrefTyp)})`);
    lines.push(`    (reg_vref_max ${g(r.vrefMax)})`);
    if (r.type === RegulatorType.THREE_TERMINAL) {
      lines.push(`    (reg_iadj_typ ${g(r.iadjTyp * 1e6)})`);
      lines.push(`    (reg_iadj_max ${g(r.iadjMax * 1e6)})`);
    }
    lines.push(`    (reg_type ${REG_TYPE_STR[r.type]})`);
    lines.push('   )');
  }
  lines.push('  )');
  lines.push(' )');
  lines.push(')');
  return `${lines.join('\n')}\n`;
}
