/**
 * SPICE netlist exporter. Counterparts: `eeschema/netlist_exporters/
 * netlist_exporter_spice.cpp` (NETLIST_EXPORTER_SPICE), `SIM_MODEL::
 * InferSimModel` (sim/sim_model.cpp) and the SPICE_GENERATOR item-line
 * builders (sim/spice_generator.cpp, sim_model_ideal/behavioral/source.cpp).
 *
 * Scope: the inference pipeline, 2-pin R/L/C (ideal values or behavioural
 * expressions) and V/I sources (DC/AC), from the reference prefix and the
 * Value / `Sim.*` fields, plus schematic-text directive collection and
 * ngspice-safe net-name conversion. Symbols carrying explicit `Sim.Library`/
 * `Sim.Name` models (or other unrecognised devices) are reported and skipped;
 * the full SIM_MODEL registry is the simulator project's next chunk.
 */

import type { LibSymbol, Schematic } from '../types.js';
import { refId } from '../tools/hittest.js';
import { enumeratePins, computeNetlist, type Netlist } from '../connectivity/nets.js';

// SIM_MODEL's field names (sim_model.h).
const SIM_DEVICE_FIELD = 'Sim.Device';
const SIM_DEVICE_SUBTYPE_FIELD = 'Sim.Type';
const SIM_PINS_FIELD = 'Sim.Pins';
const SIM_PARAMS_FIELD = 'Sim.Params';
const SIM_LIBRARY_FIELD = 'Sim.Library';
const SIM_NAME_FIELD = 'Sim.Name';

export interface SpiceExportOptions {
  /** OPTION_SAVE_ALL_VOLTAGES → `.save all`. */
  saveAllVoltages?: boolean;
  /** OPTION_SAVE_ALL_CURRENTS → `.probe alli`. */
  saveAllCurrents?: boolean;
  /** OPTION_SAVE_ALL_DISSIPATIONS → `.probe p(<item>)` per item. */
  saveAllDissipations?: boolean;
  /** GetShownText's `${VAR}` resolver for field/text values. */
  resolve?: (text: string) => string;
}

/**
 * NETLIST_EXPORTER_SPICE::ConvertToSpiceMarkup, flatten KiCad text markup
 * (`~{X}` negation keeps a leading '~' before the sanitiser turns it into '_';
 * `_{X}`/`^{X}` print as plain X), replace ngspice-hostile characters with
 * '_', and apply the ground aliases (`…/0` → `0`, `/gnd` → `gnd`, leading
 * `//` → `/root/`).
 */
export function convertToSpiceMarkup(name: string): string {
  // Markup flattening: ~{...} contributes '~' + content; _{...}/^{...} just
  // their content. Nested constructs flatten recursively.
  let out = '';
  let i = 0;
  const flatten = (end: string | null): string => {
    let acc = '';
    while (i < name.length) {
      const c = name[i]!;
      if (end && c === end) {
        i++;
        return acc;
      }
      if ((c === '~' || c === '_' || c === '^') && name[i + 1] === '{') {
        i += 2;
        const inner = flatten('}');
        acc += (c === '~' ? '~' : '') + inner;
        continue;
      }
      acc += c;
      i++;
    }
    return acc;
  };
  out = flatten(null);

  out = out.replace(/[%(),[\]<>~ ]/g, '_');

  // SPICE zero is zero anywhere: any signal ending in '/0' (but not '//0').
  if (out.endsWith('/0') && !out.endsWith('//0')) out = '0';
  // A local '/gnd' is global ground.
  if (out.toLowerCase() === '/gnd') out = out.slice(1);
  // '//' would open an ngspice line comment.
  if (out.startsWith('//')) out = out.replace('//', '/root/');
  return out;
}

/** SIM_VALUE::ToSpice, SI notation to SPICE notation ('M' → 'Meg', µ → 'u');
 *  plain numbers and unparsable strings (behavioural expressions) pass
 *  through untouched. */
export function toSpice(value: string): string {
  if (/^[\d.]+$/.test(value)) return value;
  const m = value.match(/^([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-zA-Zµμ]+)?$/);
  if (!m) return value;
  const mantissa = m[1]!;
  let suffix = m[2] ?? '';
  if (suffix === 'µ' || suffix === 'μ') suffix = 'u';
  else if (suffix === 'M') suffix = 'Meg';
  return mantissa + suffix;
}

interface InferredModel {
  /** R | L | C | V | I. */
  deviceType: string;
  /** '' (ideal / DC) | '=' (behavioural) | 'DC'. */
  modelType: string;
  /** The primary value: r/c/l or dc, SI notation. */
  value: string;
  /** Source AC magnitude ('' = none). */
  ac: string;
  /** Symbol pin numbers in (+, −) order. */
  pinPlus: string;
  pinMinus: string;
}

/** convertSeparators (InferSimModel): normalise a mantissa's thousands and
 *  decimal separators to plain '.'; returns null when ambiguity is fatal. */
function convertSeparators(mantissaIn: string): string | null {
  const mantissa = mantissaIn.replace(/ /g, '');
  let ambiguous = '?';
  let thousands = '?';
  let thousandsFound = false;
  let decimal = '?';
  let decimalFound = false;
  let digits = 0;
  for (let i = mantissa.length - 1; i >= 0; i--) {
    const c = mantissa[i]!;
    if (c >= '0' && c <= '9') {
      digits += 1;
    } else if (c === '.' || c === ',') {
      if (decimal !== '?' || thousands !== '?') {
        if (c === decimal) {
          if (thousandsFound) return null; // decimal before thousands
          if (decimalFound) return null; // more than one decimal
          decimalFound = true;
        } else if (c === thousands) {
          if (digits !== 3) return null; // thousands not followed by 3 digits
          thousandsFound = true;
        }
      } else if (ambiguous !== '?') {
        if (c === ambiguous) {
          thousands = ambiguous;
          thousandsFound = true;
          decimal = c === '.' ? ',' : '.';
        } else {
          decimal = ambiguous;
          decimalFound = true;
          thousands = c;
          thousandsFound = true;
        }
      } else if ((i === 1 && mantissa[0] === '0') || digits !== 3) {
        decimal = c;
        decimalFound = true;
        thousands = c === '.' ? ',' : '.';
      } else {
        ambiguous = c;
      }
      digits = 0;
    } else {
      digits = 0;
    }
  }
  if (decimal === '?' && thousands === '?') {
    decimal = '.';
    thousands = ',';
  }
  let out = '';
  for (const c of mantissa) {
    if (c === thousands) continue;
    out += c === decimal ? '.' : c;
  }
  return out;
}

/** InferSimModel's µ/M SI-notation conversion for the exponent letter. */
function convertNotationSI(units: string): string {
  if (units === 'µ' || units === 'μ') return 'u';
  if (units.length > 0 && units[0]!.toUpperCase() + units.slice(1).toLowerCase() === 'Meg')
    return 'M';
  return units;
}

const IDEAL_VAL =
  /^([0-9,. ]+)([fFpPnNuUmMkKgGtTμµ ]|M(?:e|E)(?:g|G))?([fFhHΩrR]|ohm)?([-1-9 ]*)([fFhHΩrR]|ohm)?$/;
const SOURCE_VAL =
  /^([0-9,. ]+)([fFpPnNuUmMkKgGtTμµ ]|M(?:e|E)(?:g|G))?([vVaA])?([-1-9 ]*)([vVaA])?$/;

/**
 * SIM_MODEL::InferSimModel, infer a model for 2-pin passives (R/L/C) and
 * sources (V/I) from the reference prefix and the Value / Sim.* fields.
 * Returns null when no inference applies (explicit models, other devices).
 */
export function inferSimModel(
  prefix: string,
  fields: ReadonlyMap<string, string>,
  pinNumbers: readonly string[],
): InferredModel | null {
  const get = (name: string): string => fields.get(name) ?? '';
  const library = get(SIM_LIBRARY_FIELD);
  const modelName = get(SIM_NAME_FIELD);
  const value = get('Value');
  let deviceType = get(SIM_DEVICE_FIELD);
  const modelType = get(SIM_DEVICE_SUBTYPE_FIELD);
  const explicitParams = get(SIM_PARAMS_FIELD);
  const pinMap = get(SIM_PINS_FIELD);

  if (pinNumbers.length !== 2) return null;
  const sorted = [...pinNumbers].sort();
  let pinPlus = sorted[0]!;
  let pinMinus = sorted[1]!;
  const pm = pinMap.match(/^(\S+)=\+ (\S+)=-$/);
  if (pm) {
    pinPlus = pm[1]!;
    pinMinus = pm[2]!;
  }

  const passiveByField =
    (deviceType === 'R' || deviceType === 'L' || deviceType === 'C') && modelType === '';
  const passiveByPrefix =
    library === '' &&
    modelName === '' &&
    deviceType === '' &&
    modelType === '' &&
    value !== '' &&
    (prefix.startsWith('R') || prefix.startsWith('L') || prefix.startsWith('C'));

  if (passiveByField || passiveByPrefix) {
    let outValue = '';
    let outType = '';
    if (explicitParams === '') {
      const m = value.match(IDEAL_VAL);
      if (m) {
        const mantissa = convertSeparators(m[1]!);
        if (mantissa === null) return null;
        const exponent = convertNotationSI(m[2] ?? '');
        const fraction = (m[4] ?? '').trim();
        outValue =
          mantissa.includes('.') || fraction === ''
            ? `${mantissa}${exponent}`
            : `${mantissa}.${fraction}${exponent}`;
      } else {
        outType = '=';
        outValue = value;
      }
    } else {
      // Explicit Sim.Params: r/c/l="…" carries the value verbatim.
      const pv = explicitParams.match(/^[rcl]="([^"]*)"$/);
      if (!pv) return null;
      outValue = pv[1]!;
    }
    if (deviceType === '') deviceType = prefix.slice(0, 1);
    return { deviceType, modelType: outType, value: outValue, ac: '', pinPlus, pinMinus };
  }

  const sourceByField =
    (deviceType === 'V' || deviceType === 'I') && (modelType === '' || modelType === 'DC');
  const sourceByPrefix =
    deviceType === '' &&
    modelType === '' &&
    value !== '' &&
    (prefix.startsWith('V') || prefix.startsWith('I'));

  if (sourceByField || sourceByPrefix) {
    let dc = '';
    let ac = '';
    if (value !== '') {
      let v = value;
      let param: 'dc' | 'ac' = 'dc';
      if (v.startsWith('DC ')) v = v.slice(3);
      else if (v.startsWith('AC ')) {
        v = v.slice(3);
        param = 'ac';
      }
      const m = v.match(SOURCE_VAL);
      let formatted = v;
      if (m) {
        const mantissa = convertSeparators(m[1]!);
        if (mantissa === null) return null;
        const exponent = convertNotationSI(m[2] ?? '');
        const fraction = (m[4] ?? '').trim();
        formatted =
          mantissa.includes('.') || fraction === ''
            ? `${mantissa}${exponent}`
            : `${mantissa}.${fraction}${exponent}`;
      }
      if (param === 'dc') dc = formatted;
      else ac = formatted;
    }
    if (deviceType === '') deviceType = prefix.slice(0, 1);
    return { deviceType, modelType: 'DC', value: dc, ac, pinPlus, pinMinus };
  }

  return null;
}

// NETLIST_EXPORTER_SPICE::ReadDirectives' recognised directive list.
const DIRECTIVES = [
  '.AC',
  '.CONTROL',
  '.CSPARAM',
  '.DISTO',
  '.DC',
  '.ELSE',
  '.ELSEIF',
  '.END',
  '.ENDC',
  '.ENDIF',
  '.ENDS',
  '.FOUR',
  '.FUNC',
  '.GLOBAL',
  '.IC',
  '.IF',
  '.INCLUDE',
  '.LIB',
  '.MEAS',
  '.MODEL',
  '.NODESET',
  '.NOISE',
  '.OP',
  '.OPTIONS',
  '.PARAM',
  '.PLOT',
  '.PRINT',
  '.PROBE',
  '.PZ',
  '.SAVE',
  '.SENS',
  '.SP',
  '.SUBCKT',
  '.TEMP',
  '.TF',
  '.TITLE',
  '.TRAN',
  '.WIDTH',
];

/** ReadDirectives, schematic text (and text boxes) whose lines contain SPICE
 *  directives (or K-line mutual-inductor declarations) pass into the netlist. */
export function collectSpiceDirectives(sch: Schematic, resolve?: (t: string) => string): string[] {
  const out: string[] = [];
  const texts = [
    ...sch.labels.filter((l) => l.kind === 'text').map((l) => l.text),
    ...sch.textBoxes.map((tb) => tb.text),
  ];
  const isDirective = (line: string, dir: string): boolean =>
    line === dir || line.startsWith(`${dir} `);
  for (const raw of texts) {
    const text = resolve ? resolve(raw) : raw;
    let found = false;
    for (const rawLine of text.split(/[\r\n]+/)) {
      if (rawLine === '') continue;
      const line = rawLine.toUpperCase();
      if (line.startsWith('.')) {
        if (DIRECTIVES.some((d) => isDirective(line, d))) {
          found = true;
          break;
        }
      } else if (line.startsWith('K')) {
        // Mutual-inductor declaration: K… L… L… <value>.
        const t = line.split(/[ \t]+/).filter(Boolean);
        if (
          t.length >= 4 &&
          t[0]!.startsWith('K') &&
          t[1]!.startsWith('L') &&
          t[2]!.startsWith('L')
        ) {
          found = true;
          break;
        }
      }
    }
    if (found) out.push(text);
  }
  return out;
}

export interface SpiceItem {
  refName: string;
  /** The full item line, '\n'-terminated ('' = model contributes no line). */
  line: string;
  /** SPICE_GENERATOR::ItemName, refName prefixed with the item type letter
   *  when it doesn't already start with it. */
  itemName: string;
}

/** SPICE sim-command directives (WriteDirectives' isSimCommand list). */
const SIM_COMMANDS = ['.AC', '.DC', '.TRAN', '.OP', '.DISTO', '.NOISE', '.PZ', '.SENS', '.TF'];

/**
 * NETLIST_EXPORTER_SPICE::DoWriteNetlist, the full netlist text plus any
 * skipped symbols (explicit/unsupported models, this chunk's boundary).
 */
export function generateSpiceNetlist(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  netlist?: Netlist | null,
  opts: SpiceExportOptions = {},
): { text: string; errors: string[] } {
  const nl = netlist ?? computeNetlist(sch, libById);
  const errors: string[] = [];
  const items: SpiceItem[] = [];
  let ncCounter = 1;

  const pins = enumeratePins(sch, libById);
  const bySym = new Map<string, typeof pins>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }
  const netName = (code: number | undefined): string =>
    code !== undefined ? (nl.nets.find((n) => n.code === code)?.name ?? '') : '';

  sch.symbols.forEach((sym, si) => {
    // ResolveExcludedFromSim: skipped symbols never reach the netlist.
    if (sym.excludedFromSim) return;
    const fields = new Map<string, string>();
    for (const f of sym.fields)
      fields.set(f.key, opts.resolve && f.value.includes('${') ? opts.resolve(f.value) : f.value);
    const ref = fields.get('Reference') ?? '?';
    if (ref.startsWith('#')) return; // power symbols never netlist
    const prefix = ref.replace(/\d+$/, '');
    const pinsOf = bySym.get(refId('symbol', sym.uuid, si)) ?? [];

    const model = inferSimModel(
      prefix,
      fields,
      pinsOf.map((p) => p.number),
    );
    if (!model) {
      errors.push(
        `Symbol '${ref}': no simulation model could be inferred (explicit Sim.* models are not supported yet); skipped.`,
      );
      return;
    }

    // GenerateItemPinNetName per model pin, (+,−) order (ItemPins).
    const netOf = (pinNumber: string): string => {
      const pin = pinsOf.find((p) => p.number === pinNumber);
      const raw = pin ? netName(nl.netByItem.get(pin.id)) : '';
      const converted = convertToSpiceMarkup(raw);
      return converted === '' ? `NC-${ncCounter++}` : converted;
    };
    const nodes = ` ${netOf(model.pinPlus)} ${netOf(model.pinMinus)}`;

    // ItemName: prefix the type letter unless the reference already has it.
    const typeLetter =
      model.modelType === '=' && (model.deviceType === 'V' || model.deviceType === 'I')
        ? 'B'
        : model.deviceType;
    const itemName = ref.startsWith(typeLetter) ? ref : `${typeLetter}${ref}`;

    // The model-name part of the line, per the concrete SPICE_GENERATOR.
    let modelPart = '';
    if (model.modelType === '=') {
      // SPICE_GENERATOR_BEHAVIORAL: R/C/L emit the raw expression; V/I wrap
      // it as V={…} / I={…} on a B element.
      modelPart =
        model.deviceType === 'V'
          ? `V={${toSpice(model.value)}}`
          : model.deviceType === 'I'
            ? `I={${toSpice(model.value)}}`
            : toSpice(model.value);
    } else if (model.deviceType === 'V' || model.deviceType === 'I') {
      // SPICE_GENERATOR_SOURCE: 'DC {dc} ' then 'AC {ac} {ph} '.
      let s = '';
      if (model.value !== '') s += `DC ${toSpice(model.value)} `;
      if (model.ac !== '') s += `AC ${toSpice(model.ac)}  `;
      modelPart = s !== '' ? s.trimEnd() : toSpice(model.value);
    } else {
      // SPICE_GENERATOR_IDEAL: the value is the model name; empty = no line.
      modelPart = toSpice(model.value);
      if (modelPart === '') {
        items.push({ refName: ref, line: '', itemName });
        return;
      }
    }

    items.push({ refName: ref, line: `${itemName}${nodes} ${modelPart}\n`, itemName });
  });

  const directives = collectSpiceDirectives(sch, opts.resolve);

  // DoWriteNetlist assembly order: head, includes, models, directives, items, tail.
  let text = '.title KiCad schematic\n';
  if (items.length > 0) {
    if (opts.saveAllVoltages) text += '.save all\n';
    if (opts.saveAllCurrents) text += '.probe alli\n';
    if (opts.saveAllDissipations) {
      for (const item of items) {
        if (item.itemName !== '' && !item.itemName.startsWith('A'))
          text += `.probe p(${item.itemName})\n`;
      }
    }
    for (const directive of directives) text += `${directive}\n`;
  }
  for (const item of items) text += item.line;
  text += '.end\n';

  return { text, errors };
}

export { SIM_COMMANDS };
