/**
 * What the AI cannot see in a netlist: where things sit on the sheet.
 *
 * - `partSize`: a symbol's body with its pins, so placements can be spaced.
 * - `overlaps`: parts, their fields, labels and power symbols that collide
 *   (reported as text after every edit, so layout is fixed without a picture).
 * - `strays`: labels on nothing and wires with a loose end. A netlist view
 *   lists only what connects, so these were invisible - and undeletable -
 *   while ERC complained about them.
 *
 * Geometry is the editor's own: `symbolBodyBBox` (the autoplacer's body box),
 * `symbolFieldBoxes` (what selection picks) and `labelBox`.
 */
import {
  type BBox,
  type LibSymbol,
  type SchLabel,
  type SchLine,
  type SchSymbol,
  type Schematic,
  enumeratePins,
  labelBox,
  refId,
  schSymbolLibraryName,
  symbolBodyBBox,
  symbolFieldBoxes,
} from '@ziroeda/eeschema';

type Pt = { x: number; y: number };

const IU_PER_MM = 10000;
export const mm = (iu: number) => String(Math.round((iu / IU_PER_MM) * 100) / 100);
const at = (p: Pt) => `@${mm(p.x)},${mm(p.y)}`;
const key = (p: Pt) => `${p.x},${p.y}`;

const field = (s: SchSymbol, k: string) => s.fields.find((f) => f.key === k)?.value;
const reference = (s: SchSymbol) => field(s, 'Reference') ?? '?';

export function libMap(doc: Schematic): Map<string, LibSymbol> {
  return new Map(doc.libSymbols.map((l) => [l.libId, l]));
}

/** A part's body and pins, w x h in mm. */
export function partSize(sym: SchSymbol, lib: LibSymbol | undefined): string {
  const b = symbolBodyBBox(sym, lib);
  return `${mm(b.maxX - b.minX)}x${mm(b.maxY - b.minY)}`;
}

/** Something on the sheet that takes room, and whose it is. */
interface Placed {
  what: string;
  owner: string;
  box: BBox;
}

/**
 * [ours] How far two boxes must cross to count: a touch along an edge, or
 * the hairline a text's pen width adds, is not a collision.
 */
const MIN_OVERLAP = 0.2 * IU_PER_MM;

function crosses(a: BBox, b: BBox): boolean {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > MIN_OVERLAP && h > MIN_OVERLAP;
}

function placedItems(doc: Schematic): Placed[] {
  const libs = libMap(doc);
  const out: Placed[] = [];
  for (const s of doc.symbols) {
    const lib = libs.get(schSymbolLibraryName(s));
    const ref = reference(s);
    const power = lib?.isPower === true || ref.startsWith('#');
    // A power symbol is named by its rail, not its #PWR reference.
    const name = power ? `power ${field(s, 'Value') ?? ref}` : ref;
    out.push({ what: name, owner: ref, box: symbolBodyBBox(s, lib, { includePins: false }) });
    if (power) continue;
    for (const f of symbolFieldBoxes(s, lib)) {
      out.push({
        what: `${ref} ${f.key.toLowerCase()} "${f.shown}"`,
        owner: ref,
        box: { minX: f.box.x, minY: f.box.y, maxX: f.box.x + f.box.w, maxY: f.box.y + f.box.h },
      });
    }
  }
  doc.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    out.push({ what: `label ${l.text} ${at(l.at)}`, owner: `label${i}`, box: labelBox(l) });
  });
  return out;
}

/** Collisions between different owners, at most `limit` of them. */
export function overlaps(doc: Schematic, limit = 15): string[] {
  const items = placedItems(doc);
  const out: string[] = [];
  for (let i = 0; i < items.length && out.length < limit; i++)
    for (let j = i + 1; j < items.length && out.length < limit; j++) {
      const a = items[i] as Placed;
      const b = items[j] as Placed;
      if (a.owner === b.owner || !crosses(a.box, b.box)) continue;
      out.push(`overlap: ${a.what} / ${b.what}`);
    }
  return out;
}

/** Whether `p` lies on segment a-b (axis-aligned or not), ends included. */
function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

export interface Stray {
  /** The editor id, for deletion. */
  id: string;
  text: string;
}

/** Labels connected to nothing and wires with an end that touches nothing. */
export function strays(doc: Schematic): Stray[] {
  const pinsAt = new Set(enumeratePins(doc, libMap(doc)).map((p) => key(p.at)));
  const wires = doc.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'wire');
  const ncAt = new Set(doc.noConnects.map((n) => key(n.at)));
  const labelAt = new Set(doc.labels.filter((l) => l.kind !== 'text').map((l) => key(l.at)));
  /** An end is held by a pin, a no-connect, or any other wire touching it. */
  const held = (p: Pt, self: number) =>
    pinsAt.has(key(p)) ||
    ncAt.has(key(p)) ||
    wires.some(({ l, i }) => i !== self && onSegment(p, l.start, l.end));
  const out: Stray[] = [];
  doc.labels.forEach((l: SchLabel, i) => {
    if (l.kind === 'text') return;
    if (pinsAt.has(key(l.at)) || wires.some(({ l: w }) => onSegment(l.at, w.start, w.end))) return;
    out.push({ id: refId('label', l.uuid, i), text: `stray label ${l.text} ${at(l.at)}` });
  });
  for (const { l, i } of wires) {
    const loose = [l.start, l.end].filter((e) => !held(e, i) && !labelAt.has(key(e)));
    if (loose.length)
      out.push({
        id: refId('line', (l as SchLine).uuid, i),
        text: `stray wire ${at(l.start)} ${at(l.end)} (loose end ${loose.map(at).join(' ')})`,
      });
  }
  return out;
}

/** An editor item id as the AI reads it: a label by name and place, a wire by its ends. */
export function itemName(doc: Schematic, id: string): string | undefined {
  for (let i = 0; i < doc.labels.length; i++) {
    const l = doc.labels[i] as SchLabel;
    if (refId('label', l.uuid, i) === id) return `label ${l.text} ${at(l.at)}`;
  }
  for (let i = 0; i < doc.lines.length; i++) {
    const l = doc.lines[i] as SchLine;
    if (refId('line', l.uuid, i) === id) return `wire ${at(l.start)} ${at(l.end)}`;
  }
  for (let i = 0; i < doc.noConnects.length; i++) {
    const n = doc.noConnects[i];
    if (n && refId('noconnect', n.uuid, i) === id) return `no-connect ${at(n.at)}`;
  }
  return undefined;
}
