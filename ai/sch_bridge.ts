/**
 * zsch over the live schematic: `read` projects the sheet on screen into the
 * compact language, `apply` turns a zsch block into ONE composed EditCommand,
 * so whatever the AI does is a single Ctrl+Z.
 *
 * Pilot scope: the current sheet only, no buses, no hierarchy.
 */
import { pageSizeMM } from '@ziroeda/common/page_info.js';
import {
  type EditCommand,
  type LibGraphic,
  type LibSymbol,
  type PinNode,
  type SchLine,
  type SchLabel,
  type SchNoConnect,
  type SchScriptApi,
  type SchSymbol,
  type Schematic,
  addItems,
  autoplacePlacedSymbol,
  composeCommands,
  computeNetlist,
  deleteByIds,
  enumeratePins,
  getPageSettings,
  makeLabel,
  makeNoConnect,
  makeRectangle,
  makeSymbol,
  makeWire,
  moveSymbolTo,
  placeSymbolInstance,
  refId,
  replaceSymbol,
  schSymbolLibraryName,
  setPageSettingsCommand,
} from '@ziroeda/eeschema';
import { pinBodyEnd } from '@ziroeda/eeschema/symbol_editor/symbol_renderer.js';
import { localToWorld, symbolTransform } from '@ziroeda/kimath/src/transform.js';
import type { AiBridge, ApplyResult, ToolOutput } from './ai_bridge.js';
import { itemName, overlaps, partSize, strays } from './sch_layout.js';

const IU_PER_MM = 10000;
/** KiCad's default schematic grid, 50 mil. */
const GRID = 12700;
/** Length of the wire stub a connection hangs its label or power symbol on. */
const STUB = 25400;

const mm = (iu: number) => {
  const v = Math.round((iu / IU_PER_MM) * 100) / 100;
  return String(v);
};
const toIU = (s: string) => Math.round((Number.parseFloat(s) * IU_PER_MM) / GRID) * GRID;

const field = (s: SchSymbol, key: string) => s.fields.find((f) => f.key === key)?.value;
const reference = (s: SchSymbol) => field(s, 'Reference') ?? '?';

function libMap(doc: Schematic): Map<string, LibSymbol> {
  return new Map(doc.libSymbols.map((l) => [l.libId, l]));
}

function isPower(s: SchSymbol, libs: Map<string, LibSymbol>): boolean {
  return libs.get(schSymbolLibraryName(s))?.isPower === true || reference(s).startsWith('#');
}

/** `REF.PIN`, by pin name when the name is unique on that part, else by number. */
function pinLabels(pins: readonly PinNode[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of pins) {
    const k = `${p.ref}\u0000${p.name}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const p of pins) {
    const named =
      p.name &&
      p.name !== '~' &&
      /^[\w+\-/]+$/.test(p.name) &&
      count.get(`${p.ref}\u0000${p.name}`) === 1;
    out.set(p.id, `${p.ref}.${named ? p.name : p.number}`);
  }
  return out;
}

export function readZsch(doc: Schematic): string {
  const libs = libMap(doc);
  const lines: string[] = [];
  const ps = getPageSettings(doc);
  // The paper first: it is how much room the sheet has (pageSizeMM gives the drawing area).
  const size = pageSizeMM(ps.paper);
  lines.push(
    size
      ? `page ${ps.paper} ; ${Math.round(size.w)} x ${Math.round(size.h)} mm`
      : `page ${ps.paper}`,
  );
  if (ps.title || ps.rev || ps.company) {
    let t = `title ${JSON.stringify(ps.title)}`;
    if (ps.rev) t += ` rev=${JSON.stringify(ps.rev)}`;
    if (ps.company) t += ` company=${JSON.stringify(ps.company)}`;
    lines.push(t);
  }
  for (const g of doc.graphics) {
    if (g.kind !== 'rectangle' || !g.start || !g.end) continue;
    const x0 = Math.min(g.start.x, g.end.x);
    const y0 = Math.min(g.start.y, g.end.y);
    const x1 = Math.max(g.start.x, g.end.x);
    const y1 = Math.max(g.start.y, g.end.y);
    // Its heading is the text sitting in its top-left corner.
    const heading = doc.labels.find(
      (l) =>
        l.kind === 'text' &&
        l.at.x >= x0 &&
        l.at.x <= x0 + 5 * GRID &&
        l.at.y >= y0 &&
        l.at.y <= y0 + 5 * GRID,
    );
    lines.push(
      `box ${JSON.stringify(heading?.text ?? '')} @${mm(x0)},${mm(y0)} ${mm(x1 - x0)},${mm(y1 - y0)}`,
    );
  }
  for (const s of doc.symbols) {
    if (isPower(s, libs)) continue;
    let l = `sym ${reference(s)} ${schSymbolLibraryName(s)} @${mm(s.at.x)},${mm(s.at.y)}`;
    l += ` size ${partSize(s, libs.get(schSymbolLibraryName(s)))}`;
    if (s.angle) l += ` r${s.angle}`;
    if (s.mirror) l += ` m${s.mirror}`;
    const v = field(s, 'Value');
    if (v) l += ` val=${/\s/.test(v) ? JSON.stringify(v) : v}`;
    const fp = field(s, 'Footprint');
    if (fp) l += ` fp=${fp}`;
    lines.push(l);
  }
  // Free text that is not a box heading: the designer's notes.
  const headings = new Set(
    doc.graphics.flatMap((g) => {
      if (g.kind !== 'rectangle' || !g.start || !g.end) return [];
      const x0 = Math.min(g.start.x, g.end.x);
      const y0 = Math.min(g.start.y, g.end.y);
      return doc.labels.filter(
        (l) =>
          l.kind === 'text' &&
          l.at.x >= x0 &&
          l.at.x <= x0 + 5 * GRID &&
          l.at.y >= y0 &&
          l.at.y <= y0 + 5 * GRID,
      );
    }),
  );
  for (const t of doc.labels)
    if (t.kind === 'text' && !headings.has(t))
      lines.push(
        `note ${JSON.stringify(t.text.replace(/\n/g, '\\n'))} @${mm(t.at.x)},${mm(t.at.y)}`,
      );
  const pins = enumeratePins(doc, libs);
  const byId = new Map(pins.map((p) => [p.id, p]));
  const names = pinLabels(pins);
  const netlist = computeNetlist(doc, libs);
  for (const net of netlist.nets) {
    const members = net.items
      .map((id) => byId.get(id))
      .filter((p): p is PinNode => !!p && !p.isPowerSymbol)
      .map((p) => names.get(p.id) ?? '');
    if (members.length < 1) continue;
    let name = net.name.replace(/^\//, '');
    if (/^(Net|unconnected)-\(/.test(name)) name = '~';
    if (members.length < 2 && name === '~') continue;
    lines.push(`net ${name} ${members.join(' ')}`);
  }
  // What connects to nothing: invisible in the nets above, so listed here.
  for (const x of strays(doc)) lines.push(x.text);
  return lines.join('\n');
}

interface SymLine {
  ref: string;
  lib: string;
  at?: { x: number; y: number };
  angle?: number;
  mirror?: 'x' | 'y';
  val?: string;
  fp?: string;
  /** Imperial chip size (0603...) for a generic passive; resolves `fp`. */
  pkg?: string;
}

function parseSym(tokens: string[]): SymLine | string {
  const [ref, lib, ...rest] = tokens;
  if (!ref || !lib) return 'sym needs REF and Lib:Part';
  const out: SymLine = { ref, lib };
  for (const t of rest) {
    const at = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(t);
    if (at) out.at = { x: toIU(at[1] ?? '0'), y: toIU(at[2] ?? '0') };
    else if (/^r(0|90|180|270)$/.test(t)) out.angle = Number(t.slice(1));
    else if (t === 'mx' || t === 'my') out.mirror = t[1] as 'x' | 'y';
    else if (t.startsWith('val=')) out.val = t.slice(4).replace(/^"(.*)"$/, '$1');
    else if (t.startsWith('fp=')) out.fp = t.slice(3);
    else if (t.startsWith('pkg=')) out.pkg = t.slice(4);
  }
  return out;
}

/** Split a line on spaces, keeping "quoted values" whole. */
const tokenize = (line: string) => line.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];

function withFields(s: SchSymbol, set: Record<string, string | undefined>): SchSymbol {
  const fields = s.fields.map((f) => {
    const v = set[f.key];
    return v === undefined ? f : { ...f, value: v };
  });
  return { ...s, fields };
}

function nextRef(doc: Schematic, prefix: string): string {
  let max = 0;
  for (const s of doc.symbols) {
    const m = new RegExp(`^${prefix.replace(/[#+]/g, '\\$&')}(\\d+)$`).exec(reference(s));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

type Pt = { x: number; y: number };

const segments = (path: readonly Pt[]): SchLine[] =>
  path.slice(1).map((b, i) => makeWire(path[i] as Pt, b));

/**
 * The direction a pin points away from its part: from the pin's body end to
 * its connection point, both through the symbol's own transform (as
 * enumeratePins places the connection point). Guessing from the part's
 * centre sent a corner pin of a tall IC's side into the body.
 */
function outward(sym: SchSymbol, p: PinNode, lib: LibSymbol | undefined): Pt {
  const pin = lib?.units
    .filter(
      (u) =>
        (u.unit === 0 || u.unit === sym.unit) &&
        (u.bodyStyle === 0 || u.bodyStyle === sym.bodyStyle),
    )
    .flatMap((u) => u.pins)
    .find((q) => q.number === p.number);
  if (pin) {
    const body = localToWorld(sym.at, symbolTransform(sym.angle, sym.mirror), pinBodyEnd(pin));
    const dx = p.at.x - body.x;
    const dy = p.at.y - body.y;
    if (dx !== 0 || dy !== 0)
      return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  }
  const dx = p.at.x - sym.at.x;
  const dy = p.at.y - sym.at.y;
  if (dx === 0 && dy === 0) return { x: -1, y: 0 };
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

/**
 * SCH_LABEL_BASE::SetSpinStyle: a label's text angle is only ever 0 or 90,
 * and which side of its anchor the text runs is the horizontal justification
 * (RIGHT 0/left, LEFT 0/right, UP 90/left, BOTTOM 90/right; bottom always).
 * Writing 180/270 with left justification ran the text back over the stub
 * and the pin names.
 */
const labelSpin = (d: Pt): { angle: number; justify: string[] } =>
  d.x > 0
    ? { angle: 0, justify: ['left', 'bottom'] }
    : d.x < 0
      ? { angle: 0, justify: ['right', 'bottom'] }
      : d.y < 0
        ? { angle: 90, justify: ['left', 'bottom'] }
        : { angle: 90, justify: ['right', 'bottom'] };

const POWER_NAME = /^([+-]\d|GND|VCC|VDD|VSS|VEE|VBUS|PWR_FLAG)/;

/**
 * The symbol angle that turns a rail symbol's body to point along `d`.
 * Library rails point down (grounds) or up (supplies); an angle turns them
 * counter-clockwise on screen, so 90 sends down to the right and up to the left.
 */
export function railAngle(down: boolean, d: Pt): number {
  let v = down ? { x: 0, y: 1 } : { x: 0, y: -1 };
  for (let a = 0; a < 360; a += 90) {
    if (v.x === d.x && v.y === d.y) return a;
    v = { x: v.y, y: -v.x };
  }
  return 0;
}
/** Ground-like rails hang below their wire; supply rails stand above it. */
const hangsDown = (name: string) => /^(GND|VSS|VEE|-)/.test(name);

const key = (p: Pt) => `${p.x},${p.y}`;

/** What hangs off one pin: its run of wire and what sits at the ends. */
interface PinRun {
  ref: string;
  number: string;
  ids: Set<string>;
  /** The net label, power rail or no-connect that run carried. */
  label?: string;
  power?: string;
  nc: boolean;
}

/**
 * The runs hanging off a part's pins: the wire runs that lead only to it,
 * and the labels, power symbols and no-connects at their ends. A run stops
 * where it meets another part's pin or branches.
 */
function pinRuns(doc: Schematic, symId: string): PinRun[] {
  const libs = libMap(doc);
  const pins = enumeratePins(doc, libs);
  const powerAt = new Map<string, { id: string; name: string }>();
  const otherPin = new Set<string>();
  for (const p of pins) {
    if (p.symId === symId) continue;
    if (p.isPowerSymbol) {
      const ps = doc.symbols.find((s, i) => refId('symbol', s.uuid, i) === p.symId);
      powerAt.set(key(p.at), { id: p.symId, name: (ps && field(ps, 'Value')) ?? p.name });
    } else otherPin.add(key(p.at));
  }
  const ends = new Map<string, number[]>();
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'wire') return;
    for (const e of [l.start, l.end]) ends.set(key(e), [...(ends.get(key(e)) ?? []), i]);
  });
  const runs: PinRun[] = [];
  for (const pin of pins) {
    if (pin.symId !== symId) continue;
    const run: PinRun = { ref: pin.ref, number: pin.number, ids: new Set(), nc: false };
    const seen = new Set<string>();
    const walk = (at: Pt) => {
      const k = key(at);
      if (seen.has(k) || otherPin.has(k)) return;
      seen.add(k);
      const power = powerAt.get(k);
      if (power) {
        run.ids.add(power.id);
        run.power = power.name;
      }
      doc.labels.forEach((l, i) => {
        if (l.kind !== 'text' && key(l.at) === k) {
          run.ids.add(refId('label', l.uuid, i));
          run.label = l.text;
        }
      });
      doc.noConnects.forEach((n, i) => {
        if (key(n.at) === k) {
          run.ids.add(refId('noconnect', n.uuid, i));
          run.nc = true;
        }
      });
      const here = ends.get(k) ?? [];
      if (here.length > 2) return; // a branch belongs to the rest of the net
      for (const i of here) {
        const l = doc.lines[i] as SchLine;
        const id = refId('line', l.uuid, i);
        if (run.ids.has(id)) continue;
        run.ids.add(id);
        walk(key(l.start) === k ? l.end : l.start);
      }
    };
    walk(pin.at);
    runs.push(run);
  }
  return runs;
}

/** Delete a part with what hangs off its pins (see pinRuns). */
function deletePart(doc: Schematic, ref: string): EditCommand {
  const si = doc.symbols.findIndex((s) => reference(s) === ref);
  if (si < 0) throw new Error(`no symbol ${ref}`);
  const sym = doc.symbols[si] as SchSymbol;
  const symId = refId('symbol', sym.uuid, si);
  const ids = new Set([symId]);
  for (const r of pinRuns(doc, symId)) for (const id of r.ids) ids.add(id);
  return deleteByIds(ids);
}

/** [ours] How many symbol search hits list their pins, and how many pins each. */
const PIN_LISTED_HITS = 3;
const MAX_LISTED_PINS = 80;

/** A library symbol's pins as `number=name`, one per number, in number order. */
export function symbolPins(lib: LibSymbol): string {
  const byNumber = new Map<string, string>();
  for (const u of lib.units)
    for (const p of u.pins) if (!byNumber.has(p.number)) byNumber.set(p.number, p.name || '~');
  const all = [...byNumber].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const shown = all.slice(0, MAX_LISTED_PINS).map(([n, name]) => `${n}=${name}`);
  return all.length > MAX_LISTED_PINS
    ? `${shown.join(' ')} (+${all.length - MAX_LISTED_PINS} more)`
    : shown.join(' ');
}

/** `m_AutoplaceFields` as eeschema ships it: rejustify, align to grid. */
const AUTOPLACE = { allowRejustify: true, alignToGrid: true } as const;

const BOX_STROKE = { width: 0, type: 'dash' } as const;
/** Block headings: 2.54 mm text, twice KiCad's default 1.27 mm. */
const HEADING_SIZE = 25400;

/**
 * Generic passives: chip size to KiCad's stock SMD footprint, the way Diode's
 * stdlib generics map `package` (their generics/Resistor.zen). [data] The
 * names are KiCad's own library entries, `<prefix>_<imperial>_<metric>Metric`.
 */
const CHIP_METRIC: Record<string, string> = {
  '0201': '0603',
  '0402': '1005',
  '0603': '1608',
  '0805': '2012',
  '1206': '3216',
  '1210': '3225',
  '2010': '5025',
  '2512': '6332',
};
const CHIP_LIB: Record<string, [string, string]> = {
  R: ['Resistor_SMD', 'R'],
  R_Small: ['Resistor_SMD', 'R'],
  C: ['Capacitor_SMD', 'C'],
  C_Small: ['Capacitor_SMD', 'C'],
  L: ['Inductor_SMD', 'L'],
  L_Small: ['Inductor_SMD', 'L'],
  LED: ['LED_SMD', 'LED'],
  LED_Small: ['LED_SMD', 'LED'],
  D: ['Diode_SMD', 'D'],
  D_Small: ['Diode_SMD', 'D'],
};

export function chipFootprint(libId: string, pkg: string): string | undefined {
  const [lib, part] = libId.split(':');
  const fam = lib === 'Device' && part ? CHIP_LIB[part] : undefined;
  const metric = CHIP_METRIC[pkg];
  return fam && metric ? `${fam[0]}:${fam[1]}_${pkg}_${metric}Metric` : undefined;
}

type LibIndex = readonly { name: string; items: readonly string[] }[];

/** Name search over a library index: every term must appear; exact and short first. */
export function searchIndex(index: LibIndex, query: string, limit = 25): string[] {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (!terms.length) return [];
  const hits: { id: string; score: number }[] = [];
  for (const lib of index)
    for (const item of lib.items) {
      const id = `${lib.name}:${item}`;
      const low = id.toLowerCase();
      if (!terms.every((t) => low.includes(t))) continue;
      const exact = terms.some((t) => item.toLowerCase() === t) ? 0 : 1;
      hits.push({ id, score: exact * 10000 + id.length });
    }
  hits.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit).map((h) => h.id);
}

/** KiCad's footprint-filter match (`*`, `?`; a filter with `:` names the library too). */
function filterMatches(filter: string, libName: string, fp: string): boolean {
  const re = new RegExp(
    `^${filter
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );
  return filter.includes(':') ? re.test(`${libName}:${fp}`) : re.test(fp);
}

async function footprintIndex(api: SchScriptApi): Promise<LibIndex> {
  return (await api.footprintIndex()).map((l) => ({ name: l.name, items: l.footprints }));
}

/** The paper sizes `page` takes (PAGE_INFO's standard sizes). */
const PAPER_SIZES = new Set([
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
  'USLetter',
  'USLegal',
  'USLedger',
]);

/** The batch's lines, a quoted string that runs over a line break kept as one line. */
export function joinQuotedLines(text: string): string[] {
  const out: string[] = [];
  let pending: string | null = null;
  for (const raw of text.split('\n')) {
    const line: string = pending === null ? raw : `${pending}\\n${raw}`;
    const quotes = (line.replace(/;.*$/, '').match(/"/g) ?? []).length;
    if (quotes % 2 === 1) pending = line;
    else {
      out.push(line);
      pending = null;
    }
  }
  if (pending !== null) out.push(pending);
  return out;
}

export async function applyZsch(api: SchScriptApi, text: string): Promise<ApplyResult> {
  const doc = api.doc();
  if (!doc) return { applied: 0, errors: ['no schematic open'] };
  const errors: string[] = [];
  const hints: string[] = [];
  let fpIndex: LibIndex | undefined;
  let applied = 0;
  const phase1: EditCommand[] = [];
  const netLines: { name: string; pins: string[] }[] = [];
  const ncLines: string[][] = [];
  const graphics: LibGraphic[] = [];
  const texts: SchLabel[] = [];
  /** `R?` placeholders the AI wrote, to the reference they were given. */
  const renamed = new Map<string, string>();
  /** Parts placed, moved or turned: KiCad autoplaces their fields. */
  const touched = new Set<string>();
  let staged = doc;
  const stage = (cmd: EditCommand) => {
    phase1.push(cmd);
    staged = cmd.apply(staged);
  };
  const kv = (tokens: string[], key: string) =>
    tokens
      .find((t) => t.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .replace(/^"(.*)"$/, '$1');

  for (const raw of joinQuotedLines(text)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const [kw, ...tokens] = tokenize(line);
    try {
      if (kw === 'sym') {
        const p = parseSym(tokens);
        if (typeof p === 'string') throw new Error(p);
        if (!p.fp && p.pkg) {
          p.fp = chipFootprint(p.lib, p.pkg);
          if (!p.fp) throw new Error(`pkg=${p.pkg} is not a chip size for ${p.lib}`);
        }
        if (p.fp) {
          fpIndex ??= await footprintIndex(api);
          const [fl, fn] = p.fp.split(':');
          if (!fpIndex.some((l) => l.name === fl && l.items.includes(fn ?? ''))) {
            const near = searchIndex(fpIndex, fn ?? p.fp, 5);
            throw new Error(
              `unknown footprint ${p.fp}${near.length ? `; similar: ${near.join(' ')}` : ''}`,
            );
          }
        }
        const idx = staged.symbols.findIndex((s) => reference(s) === p.ref);
        const cur = idx >= 0 ? staged.symbols[idx] : undefined;
        if (cur) {
          let next = p.at ? moveSymbolTo(cur, p.at) : cur;
          if (p.angle !== undefined) next = { ...next, angle: p.angle };
          if (p.mirror) next = { ...next, mirror: p.mirror };
          next = withFields(next, { Value: p.val, Footprint: p.fp });
          const moved =
            next.at.x !== cur.at.x ||
            next.at.y !== cur.at.y ||
            next.angle !== cur.angle ||
            next.mirror !== cur.mirror;
          // A part moves with what hangs off its pins: the runs come off the old
          // pin positions and are hung again on the new ones, as the same net.
          const runs = moved ? pinRuns(staged, refId('symbol', cur.uuid, idx)) : [];
          stage(replaceSymbol(idx, next));
          const carried = new Set<string>();
          for (const r of runs) for (const id of r.ids) carried.add(id);
          if (carried.size) stage(deleteByIds(carried));
          for (const r of runs) {
            const pin = `${r.ref}.${r.number}`;
            if (r.power) netLines.push({ name: r.power, pins: [pin] });
            else if (r.label) netLines.push({ name: r.label, pins: [pin] });
            if (r.nc) ncLines.push([pin]);
          }
          if (moved) touched.add(p.ref);
        } else {
          const [libName, part] = p.lib.split(':');
          const lib = libName && part ? await api.loadSymbol(libName, part) : undefined;
          if (!lib) throw new Error(`unknown symbol ${p.lib}`);
          let sym = makeSymbol(lib, p.at ?? { x: 50 * IU_PER_MM, y: 50 * IU_PER_MM }, {
            angle: p.angle ?? 0,
            ...(p.mirror ? { mirror: p.mirror } : {}),
          });
          const ref = p.ref.endsWith('?') ? nextRef(staged, p.ref.slice(0, -1)) : p.ref;
          if (ref !== p.ref) renamed.set(p.ref, ref);
          sym = withFields(sym, { Reference: ref, Value: p.val, Footprint: p.fp });
          stage(placeSymbolInstance(lib, sym));
          touched.add(ref);
          // No footprint given and none in the library symbol: offer what its
          // own footprint filters allow, as KiCad's Assign Footprints would.
          if (!field(sym, 'Footprint')) {
            const filters = (lib.properties.find((q) => q.key === 'ki_fp_filters')?.value ?? '')
              .split(/\s+/)
              .filter(Boolean);
            fpIndex ??= await footprintIndex(api);
            const fits: string[] = [];
            for (const l of fpIndex)
              for (const f of l.items)
                if (fits.length < 12 && filters.some((flt) => filterMatches(flt, l.name, f)))
                  fits.push(`${l.name}:${f}`);
            hints.push(
              `${ref} has no footprint; ${fits.length ? `its filters allow: ${fits.join(' ')}` : 'search_footprints for one'}`,
            );
          }
        }
      } else if (kw === 'net') {
        const [name, ...pins] = tokens;
        if (!name || !pins.length) throw new Error('net needs NAME and pins');
        netLines.push({ name, pins });
      } else if (kw === 'nc') {
        ncLines.push(tokens);
      } else if (kw === 'del' && tokens[0] === 'strays') {
        // Every label on nothing and every wire with a loose end.
        const ids = new Set(strays(staged).map((x) => x.id));
        if (ids.size) stage(deleteByIds(ids));
      } else if (kw === 'del' && tokens[0] === 'label') {
        // `del label NAME` takes every label of that name; `del label NAME @x,y` the one there,
        // within a grid step (a position read before an undo can be one step off).
        const [, name, where] = tokens;
        if (!name) throw new Error('del label needs NAME [@x,y]');
        const m = where ? /^@(-?[\d.]+),(-?[\d.]+)$/.exec(where) : null;
        if (where && !m) throw new Error('del label needs NAME [@x,y]');
        const x = m ? toIU(m[1] ?? '0') : 0;
        const y = m ? toIU(m[2] ?? '0') : 0;
        const ids = new Set<string>();
        staged.labels.forEach((l, i) => {
          if (l.kind === 'text' || l.text !== name) return;
          if (!m || (Math.abs(l.at.x - x) <= GRID && Math.abs(l.at.y - y) <= GRID))
            ids.add(refId('label', l.uuid, i));
        });
        if (!ids.size)
          throw new Error(m ? `no label ${name} at @${m[1]},${m[2]}` : `no label ${name}`);
        stage(deleteByIds(ids));
      } else if (kw === 'del') {
        // In order, so a later `sym` line with the same REF makes a new part.
        for (const r of tokens) stage(deletePart(staged, r));
      } else if (kw === 'note') {
        const [body, where] = tokens;
        const m = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(where ?? '');
        if (!body || !m) throw new Error('note needs "TEXT" @x,y');
        texts.push(
          makeLabel('text', body.replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n'), {
            x: toIU(m[1] ?? '0'),
            y: toIU(m[2] ?? '0'),
          }),
        );
      } else if (kw === 'page') {
        // The sheet's paper: A4..A0, A..E, USLetter, USLegal, USLedger, optionally portrait.
        const [size, orient] = tokens;
        if (!size || !PAPER_SIZES.has(size))
          throw new Error(`page needs one of ${[...PAPER_SIZES].join(' ')}`);
        if (orient && orient !== 'portrait') throw new Error('page SIZE [portrait]');
        stage(
          setPageSettingsCommand({
            ...getPageSettings(staged),
            paper: orient ? `${size} portrait` : size,
          }),
        );
      } else if (kw === 'title') {
        const cur = getPageSettings(staged);
        const title =
          tokens[0] && !tokens[0].includes('=') ? tokens[0].replace(/^"(.*)"$/, '$1') : cur.title;
        stage(
          setPageSettingsCommand({
            ...cur,
            title,
            rev: kv(tokens, 'rev') ?? cur.rev,
            company: kv(tokens, 'company') ?? cur.company,
            date: kv(tokens, 'date') ?? (cur.date || new Date().toISOString().slice(0, 10)),
          }),
        );
      } else if (kw === 'box') {
        const [heading, at, size] = tokens;
        const m = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(at ?? '');
        // w,h - also as `w80,47` or `80x47`, the spellings a model writes for it
        const z = /^w?([\d.]+)[,x]h?([\d.]+)$/.exec(size ?? '');
        if (!heading || !m || !z) throw new Error('box needs "TITLE" @x,y w,h');
        const x = toIU(m[1] ?? '0');
        const y = toIU(m[2] ?? '0');
        const w = toIU(z[1] ?? '0');
        const h = toIU(z[2] ?? '0');
        graphics.push(makeRectangle({ x, y }, { x: x + w, y: y + h }, BOX_STROKE));
        texts.push(
          makeLabel(
            'text',
            heading.replace(/^"(.*)"$/, '$1'),
            { x: x + GRID, y: y + 2 * GRID + GRID },
            {
              fontSize: HEADING_SIZE,
            },
          ),
        );
      } else {
        throw new Error(`unknown keyword ${kw}`);
      }
      applied++;
    } catch (e) {
      errors.push(`${line}: ${(e as Error).message}`);
    }
  }

  // Connections are resolved against the doc with the new parts in it.
  const libs = libMap(staged);
  const pins = enumeratePins(staged, libs);
  const names = pinLabels(pins);
  const byName = new Map<string, PinNode>();
  // A pin name with an overbar (~{RST}) answers to itself and to the bare
  // name (RST), when that is unique on the part: search lists 4=~{RST}, and
  // either spelling is what a model writes back.
  const aliasCount = new Map<string, number>();
  const aliases = (p: PinNode) =>
    p.name && p.name !== '~' && p.name.includes('~{')
      ? [`${p.ref}.${p.name}`, `${p.ref}.${p.name.replace(/~\{([^}]*)\}/g, '$1')}`]
      : [];
  for (const p of pins) for (const a of aliases(p)) aliasCount.set(a, (aliasCount.get(a) ?? 0) + 1);
  for (const p of pins) {
    for (const a of aliases(p)) if (aliasCount.get(a) === 1 && !byName.has(a)) byName.set(a, p);
    byName.set(names.get(p.id) ?? '', p);
    byName.set(`${p.ref}.${p.number}`, p);
  }
  const lookup = (r: string): PinNode | undefined => {
    const dot = r.lastIndexOf('.');
    const ref = renamed.get(r.slice(0, dot)) ?? r.slice(0, dot);
    return byName.get(`${ref}.${r.slice(dot + 1)}`);
  };
  const netlist = computeNetlist(staged, libs);
  const netOfPin = new Map<string, string>();
  for (const n of netlist.nets)
    for (const id of n.items) netOfPin.set(id, n.name.replace(/^\//, ''));
  const symOf = (p: PinNode) => staged.symbols.find((s) => reference(s) === p.ref);

  const wires: SchLine[] = [];
  const labels: SchLabel[] = [];
  const ncs: SchNoConnect[] = [];
  const powerParts: { lib: LibSymbol; sym: SchSymbol }[] = [];
  const powerLibs = new Map<string, LibSymbol | undefined>();
  let pwrNext = Number(nextRef(staged, '#PWR').slice(4));

  /** A stub out of the pin, then a label or power symbol on its end. */
  const hang = (p: PinNode, sym: SchSymbol, name: string, powerLib: LibSymbol | undefined) => {
    const d = outward(sym, p, libs.get(schSymbolLibraryName(sym)));
    const end = { x: p.at.x + d.x * STUB, y: p.at.y + d.y * STUB };
    const path: Pt[] = [p.at, end];
    if (powerLib) {
      // A rail symbol points straight out of its pin, rotated as needed (a GND
      // on a connector's side pin lies on its side), rather than turning the
      // stub down across the next pin's label.
      wires.push(...segments(path));
      powerParts.push({
        lib: powerLib,
        sym: withFields(makeSymbol(powerLib, end, { angle: railAngle(hangsDown(name), d) }), {
          Reference: `#PWR${pwrNext++}`,
        }),
      });
    } else {
      wires.push(...segments(path));
      labels.push(makeLabel('label', name, end, labelSpin(d)));
    }
  };

  const stubEnd = (p: PinNode, d: Pt): Pt => ({ x: p.at.x + d.x * STUB, y: p.at.y + d.y * STUB });
  /**
   * A net's pins grouped by part and the side they leave it on, each group
   * ordered along that side with its head first: the end a rail symbol stands
   * at (the top for a supply, the bottom for a ground), so its stub runs clear
   * of the joining wire.
   */
  const sideGroups = (todo: { p: PinNode; sym: SchSymbol }[], down: boolean) => {
    const groups = new Map<string, { p: PinNode; sym: SchSymbol; d: Pt }[]>();
    for (const t of todo) {
      const d = outward(t.sym, t.p, libs.get(schSymbolLibraryName(t.sym)));
      const k = `${t.p.ref}|${d.x},${d.y}|${d.x !== 0 ? t.p.at.x : t.p.at.y}`;
      groups.set(k, [...(groups.get(k) ?? []), { ...t, d }]);
    }
    return [...groups.values()].map((g) =>
      g.sort((a, b) => {
        const along = a.d.x !== 0 ? a.p.at.y - b.p.at.y : a.p.at.x - b.p.at.x;
        return down ? -along : along;
      }),
    );
  };

  for (const { name, pins: refs } of netLines) {
    let powerLib: LibSymbol | undefined;
    if (POWER_NAME.test(name)) {
      if (!powerLibs.has(name)) powerLibs.set(name, await api.loadSymbol('power', name));
      powerLib = powerLibs.get(name);
    }
    const todo: { p: PinNode; sym: SchSymbol }[] = [];
    for (const r of refs) {
      const p = lookup(r);
      const sym = p && symOf(p);
      if (!p || !sym) errors.push(`net ${name}: no pin ${r}`);
      else if (netOfPin.get(p.id) !== name) todo.push({ p, sym });
    }
    const first = todo[0]?.p;
    if (!first || (!powerLib && todo.length < 2 && name === '~')) continue;
    // An unnamed net takes one generated name shared by all its pins.
    const label = powerLib ? name : name === '~' ? `N_${first.ref}_${first.number}` : name;
    for (const group of sideGroups(todo, powerLib ? hangsDown(name) : false)) {
      const [head, ...rest] = group;
      if (!head) continue;
      hang(head.p, head.sym, label, powerLib);
      // The other pins on that side join the head's stub: one label or rail
      // symbol for the run, not one per pin crowding each other.
      let prev = stubEnd(head.p, head.d);
      for (const { p, d } of rest) {
        const end = stubEnd(p, d);
        wires.push(makeWire(p.at, end), makeWire(prev, end));
        prev = end;
      }
    }
  }
  for (const refs of ncLines)
    for (const r of refs) {
      const p = lookup(r);
      if (p) ncs.push(makeNoConnect(p.at));
      else errors.push(`nc: no pin ${r}`);
    }

  // All or nothing: a batch with a failed line changes nothing, so sending it again (fixed)
  // cannot draw anything twice.
  if (errors.length)
    return {
      applied: 0,
      errors: [
        ...errors,
        'Nothing was applied: fix the lines above and send the whole batch again.',
      ],
      // The pins of parts the batch itself placed, so read from the staged sheet.
      hints: [...hints, ...pinHintsIn(staged, errors)],
    };

  const cmds = [...phase1, ...powerParts.map(({ lib, sym }) => placeSymbolInstance(lib, sym))];
  for (const { sym } of powerParts) touched.add(reference(sym));
  if (wires.length || labels.length || ncs.length || graphics.length || texts.length)
    cmds.push(addItems({ lines: wires, labels: [...labels, ...texts], noConnects: ncs, graphics }));
  if (!cmds.length) return { applied, errors, hints };
  // SCH_DRAWING_TOOLS::PlaceSymbol autoplaces a placed symbol's fields
  // (m_AutoplaceFields.enable, on by default), and a move or rotate of an
  // autoplaced symbol does it again; here on the finished sheet, so the
  // fields step around the labels and rails just hung.
  const after = composeCommands('AI edit', cmds).apply(doc);
  const libsAfter = libMap(after);
  after.symbols.forEach((sym, i) => {
    if (!touched.has(reference(sym))) return;
    const lib = libsAfter.get(schSymbolLibraryName(sym));
    cmds.push(
      replaceSymbol(
        i,
        autoplacePlacedSymbol(sym, lib, true, AUTOPLACE, { doc: after, libById: libsAfter }),
      ),
    );
  });
  api.runCommand(composeCommands('AI edit', cmds));
  return { applied, errors, hints };
}

/** The real pin list of every part a failed line named (usually a guessed pin). */
export function pinHints(api: SchScriptApi, applyErrors: readonly string[]): string[] {
  const doc = api.doc();
  return doc ? pinHintsIn(doc, applyErrors) : [];
}

/** {@link pinHints} on a given sheet: the batch's own staged one, when nothing was applied. */
function pinHintsIn(doc: Schematic, applyErrors: readonly string[]): string[] {
  const pins = enumeratePins(doc, libMap(doc));
  const named = new Set<string>();
  for (const e of applyErrors)
    for (const m of e.matchAll(/no pin ([^\s.]+)\./g)) named.add(m[1] ?? '');
  const out: string[] = [];
  for (const ref of named) {
    const own = pins.filter((p) => p.ref === ref);
    if (own.length)
      out.push(`pins ${ref}: ${own.map((p) => `${p.number}=${p.name || '~'}`).join(' ')}`);
  }
  return out;
}

/** The editor's ERC on the sheet as it stands, pins as REF.PIN. */
export function ercText(api: SchScriptApi): string {
  const doc = api.doc();
  if (!doc) return 'no schematic open';
  const pins = enumeratePins(doc, libMap(doc));
  const names = pinLabels(pins);
  const refOf = new Map<string, string>();
  doc.symbols.forEach((s, i) => refOf.set(refId('symbol', s.uuid, i), reference(s)));
  const lines = new Set<string>();
  for (const v of api.erc()) {
    const items = [
      ...new Set(v.items.map((id) => names.get(id) ?? refOf.get(id) ?? itemName(doc, id) ?? '')),
    ].filter(Boolean);
    lines.add(
      `${v.severity} ${v.code}: ${v.message}${items.length ? ` [${items.join(' ')}]` : ''}`,
    );
  }
  return lines.size ? [`${lines.size} ERC violations:`, ...lines].join('\n') : 'ERC clean';
}

export function schBridge(api: SchScriptApi): AiBridge {
  const read = () => {
    const d = api.doc();
    return d ? readZsch(d) : '(no schematic open)';
  };
  const search = async (kind: 'symbols' | 'footprints', query: string): Promise<ToolOutput> => {
    const index =
      kind === 'symbols'
        ? (await api.symbolIndex()).map((l) => ({ name: l.name, items: l.symbols }))
        : await footprintIndex(api);
    const hits = searchIndex(index, query);
    // The best symbol hits carry their pins, so a net line names real pins
    // the first time (a USB-C receptacle's are A4, A6, B6..., not VBUS, D+).
    const lines = [...hits];
    if (kind === 'symbols')
      for (let i = 0; i < Math.min(PIN_LISTED_HITS, hits.length); i++) {
        const [libName, part] = (hits[i] ?? '').split(':');
        const lib = libName && part ? await api.loadSymbol(libName, part) : undefined;
        if (lib) lines[i] = `${hits[i]}  pins: ${symbolPins(lib)}`;
      }
    return {
      text: hits.length ? lines.join('\n') : `no ${kind} match "${query}"`,
      note: `searched ${kind} "${query}": ${hits.length} found`,
    };
  };
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
    read_schematic: async () => ({ text: read(), note: 'read the schematic' }),
    apply_zsch: async (args) => {
      const r = await applyZsch(api, String(args.zsch ?? ''));
      const after = api.doc();
      // Layout, as text: what collides and what connects to nothing.
      const layout = after ? [...overlaps(after), ...strays(after).map((x) => x.text)] : [];
      const hints = [...(r.hints ?? []), ...layout];
      const failed = r.errors.length ? `\n${r.errors.length} failed:\n${r.errors.join('\n')}` : '';
      return {
        text: `Applied ${r.applied} lines.${failed}${hints.length ? `\n${hints.join('\n')}` : ''}`,
        note: `edited the schematic: ${r.applied} lines${r.errors.length ? `, ${r.errors.length} failed` : ''}`,
      };
    },
    run_erc: async () => {
      const text = ercText(api);
      return { text, note: text === 'ERC clean' ? 'ERC clean' : (text.split('\n')[0] ?? '') };
    },
    view_schematic: async () => {
      const png = api.snapshot();
      return png
        ? {
            text: 'The whole sheet, as the user sees it.',
            imagePng: png,
            note: 'looked at the schematic',
          }
        : { text: 'No schematic is open.', isError: true, note: 'no schematic to look at' };
    },
    undo_schematic: async () => {
      api.undo();
      return { text: 'Undid the last schematic edit.', note: 'undid the last schematic edit' };
    },
    search_symbols: (args) => search('symbols', String(args.query ?? '')),
    search_footprints: (args) => search('footprints', String(args.query ?? '')),
  };
  return {
    kind: 'sch',
    read,
    run: (name, args) => tools[name]?.(args) ?? null,
  };
}
