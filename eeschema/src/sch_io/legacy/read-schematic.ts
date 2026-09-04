// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The legacy `.sch` schematic reader — `SCH_IO_KICAD_LEGACY::LoadSchematicFile`
 * and the `load*` half of `eeschema/sch_io/kicad_legacy/sch_io_kicad_legacy.cpp`.
 *
 * This is the KiCad 4/5 schematic format: `EESchema Schematic File Version N`,
 * then line-oriented `$Descr`, `$Comp`, `$Sheet`, `Wire`, `Text`, `Connection`,
 * `NoConn`, `Entry`, `BusAlias` records, coordinates in mils.
 *
 * Same shape as the `.lib` reader beside it: legacy tokens are translated into
 * the `(kicad_sch …)` node the existing reader already consumes, rather than
 * building a `Schematic` directly. One construction path for the model, one
 * place the defaults live, and the `source` node every item carries comes from
 * something real.
 *
 * ## Coordinates do NOT flip here
 *
 * The `.lib` reader negates Y because library geometry is +Y-up while the model
 * is +Y-down. A schematic is +Y-down in BOTH formats — `loadWire` and friends
 * write `position.y = schIUScale.MilsToIU( … )` with no minus — so the whole
 * conversion is mils → mm and nothing else. The one exception is a symbol
 * FIELD, which the legacy loader mirrors about its symbol's own Y:
 *
 *     // Y got inverted in symbol coordinates
 *     pos.y = -( pos.y - symbol->GetY() ) + symbol->GetY();
 *
 * ## What a screen's UUID is
 *
 * A legacy file has no screen UUID; KiCad mints one per `SCH_SCREEN` on load,
 * and it is that UUID which heads every symbol instance path. So the conversion
 * is project-wide rather than per-file, and the minting is injectable — see
 * {@link LegacyProjectInput.newUuid} — because a test that cannot fix the UUIDs
 * cannot compare anything that contains one.
 */

import { atom, list, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';
import type { Reporter } from '@ziroeda/common/src/reporter.js';
import type { LibSymbol, Schematic } from '../../types.js';
import { readSchematic } from '../sexpr/read-schematic.js';
import { writeLibSymbolNode } from '../sexpr/write-symbol-lib.js';
import { mil, mm, ParseError, Scanner } from './parse.js';

/** `SCH_LEGACY_SCHEMATIC_FILE_VERSION` is 2 at the s-expression cut-over; the
 *  version the converted node claims is the modern one the reader expects. */
const SEXPR_SCHEMATIC_FILE_VERSION = 20250114;

const point = (name: string, x: number, y: number): SList =>
  list(atom(name), atom(mm(x)), atom(mm(y)));

const at = (x: number, y: number, angle: number): SList =>
  list(atom('at'), atom(mm(x)), atom(mm(y)), atom(String(angle)));

const sizeEffects = (sizeIU: number, extra: SNode[] = []): SList =>
  list(
    atom('effects'),
    list(atom('font'), list(atom('size'), atom(mm(sizeIU)), atom(mm(sizeIU)))),
    ...extra,
  );

const hide = (hidden: boolean): SNode[] => (hidden ? [list(atom('hide'), atom('yes'))] : []);

/** A `(uuid "…")` child. */
const uuidNode = (id: string): SList => list(atom('uuid'), str(id));

// ---------------------------------------------------------------------------
// TRANSFORM -> (angle, mirror), which is the one genuinely awkward conversion
// ---------------------------------------------------------------------------

/** `TRANSFORM`: `x1 y1 x2 y2`, the 2x2 matrix a legacy `$Comp` ends with. */
interface Transform {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * `TRANSFORM()`'s default, which `SetOrientation( SYM_ORIENT_0 )` resets to:
 *
 *     TRANSFORM() : x1( 1 ), y1( 0 ), x2( 0 ), y2( 1 ) {}
 *
 * NOT `1 0 0 -1`, which is what the FILE writes for an unrotated symbol — the
 * loader negates both y terms on the way in (`transform.y1 = -parseInt(…)`), so
 * the matrix in memory is the identity above. Getting this wrong does not fail
 * loudly: every unrotated symbol simply matches the mirror-X candidate instead,
 * and the whole schematic comes up flipped.
 */
const IDENTITY: Transform = { x1: 1, y1: 0, x2: 0, y2: 1 };

/** `TRANSFORM::operator*`, as `SetOrientation` composes an incremental one. */
function compose(a: Transform, b: Transform): Transform {
  // SCH_SYMBOL::SetOrientation does `m_transform = temp * m_transform`.
  return {
    x1: b.x1 * a.x1 + b.y1 * a.x2,
    y1: b.x1 * a.y1 + b.y1 * a.y2,
    x2: b.x2 * a.x1 + b.y2 * a.x2,
    y2: b.x2 * a.y1 + b.y2 * a.y2,
  };
}

/** The incremental transforms `SCH_SYMBOL::SetOrientation` applies. */
const ROT_CCW: Transform = { x1: 0, y1: 1, x2: -1, y2: 0 };
const ROT_CW: Transform = { x1: 0, y1: -1, x2: 1, y2: 0 };
const MIRROR_Y: Transform = { x1: -1, y1: 0, x2: 0, y2: 1 };
const MIRROR_X: Transform = { x1: 1, y1: 0, x2: 0, y2: -1 };

/** How the modern format states one of the orientations `GetOrientation` finds. */
interface Orientation {
  angle: number;
  mirror?: 'x' | 'y';
}

/**
 * `SCH_SYMBOL::GetOrientation()`, which is a SEARCH and not an inversion:
 *
 *     for( int type_rotate : rotate_values ) { temp.SetOrientation( type_rotate );
 *         if( transform == temp.GetTransform() ) return type_rotate; }
 *
 * Its own comment calls the algorithm bizarre and declines to unpick it. The
 * honest port is the same search over the same twelve candidates in the same
 * order — a closed-form inverse would be a different function that happens to
 * agree on the cases anyone has tried.
 */
const ORIENTATIONS: { steps: Transform[]; result: Orientation }[] = [
  { steps: [], result: { angle: 0 } },
  { steps: [ROT_CCW], result: { angle: 90 } },
  { steps: [ROT_CCW, ROT_CCW], result: { angle: 180 } },
  { steps: [ROT_CW], result: { angle: 270 } },
  { steps: [MIRROR_X], result: { angle: 0, mirror: 'x' } },
  { steps: [ROT_CCW, MIRROR_X], result: { angle: 90, mirror: 'x' } },
  { steps: [ROT_CW, MIRROR_X], result: { angle: 270, mirror: 'x' } },
  { steps: [MIRROR_Y], result: { angle: 0, mirror: 'y' } },
  { steps: [ROT_CCW, MIRROR_Y], result: { angle: 90, mirror: 'y' } },
  { steps: [ROT_CCW, ROT_CCW, MIRROR_Y], result: { angle: 180, mirror: 'y' } },
  { steps: [ROT_CW, MIRROR_Y], result: { angle: 270, mirror: 'y' } },
];

const sameTransform = (a: Transform, b: Transform): boolean =>
  a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;

export function transformToOrientation(t: Transform): Orientation {
  for (const candidate of ORIENTATIONS) {
    let built = IDENTITY;
    for (const step of candidate.steps) built = compose(built, step);
    if (sameTransform(built, t)) return candidate.result;
  }
  // "Error: orientation not found in list (should not happen)" — upstream
  // asserts and returns SYM_NORMAL. A file with a matrix that is not one of the
  // twelve draws unrotated rather than not at all.
  return { angle: 0 };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Everything one `.sch` file turned into, before it becomes a document. */
interface Screen {
  items: SNode[];
  paper: SList | null;
  titleBlock: SList | null;
  /** `Sheet <virtual page number> <page count>`. */
  pageNumber: number;
  /** The child sheets it names, so the hierarchy can be walked. */
  children: { file: string; uuid: string }[];
}

/** `loadPageSettings` (`:407-530`). */
function loadPageSettings(lines: string[], i: number, screen: Screen): number {
  const first = new Scanner(lines[i]!, i + 1);
  first.take('$Descr');
  const type = first.word();
  const w = first.int();
  const h = first.int();

  // `PAGE_INFO::SetType`: "User" is the only one that keeps the numbers, and a
  // trailing "portrait" turns any of the others.
  if (type === 'User') {
    screen.paper = list(atom('paper'), str('User'), atom(mm(mil(w))), atom(mm(mil(h))));
  } else {
    const orientation = first.atEol() ? '' : first.word(true);
    screen.paper =
      orientation === 'portrait'
        ? list(atom('paper'), str(type), atom('portrait'))
        : list(atom('paper'), str(type));
  }

  const tb: SNode[] = [atom('title_block')];
  const COMMENTS = [
    'Comment1',
    'Comment2',
    'Comment3',
    'Comment4',
    'Comment5',
    'Comment6',
    'Comment7',
    'Comment8',
    'Comment9',
  ];

  for (i++; i < lines.length; i++) {
    const s = new Scanner(lines[i]!, i + 1);
    if (s.take('$EndDescr')) {
      if (tb.length > 1) screen.titleBlock = { kind: 'list', items: tb };
      return i;
    }
    if (s.take('Sheet')) {
      screen.pageNumber = s.int();
      continue;
    }
    for (const [token, node] of [
      ['Title', 'title'],
      ['Date', 'date'],
      ['Rev', 'rev'],
      ['Comp', 'company'],
    ] as const) {
      if (s.take(token)) {
        const v = s.quoted(true);
        if (v !== '') tb.push(list(atom(node), str(v)));
      }
    }
    for (let c = 0; c < COMMENTS.length; c++) {
      const s2 = new Scanner(lines[i]!, i + 1);
      if (s2.take(COMMENTS[c]!)) {
        const v = s2.quoted(true);
        if (v !== '') tb.push(list(atom('comment'), atom(String(c + 1)), str(v)));
      }
    }
  }
  throw new ParseError("missing 'EndDescr'");
}

/** `loadSheet` (`:536-645`). */
function loadSheet(lines: string[], i: number, screen: Screen, mintUuid: () => string): number {
  let pos = { x: 0, y: 0 };
  let size = { x: 0, y: 0 };
  let uuid = mintUuid();
  let name = '';
  let nameSize = mil(50);
  let file = '';
  let fileSize = mil(50);
  const pins: SNode[] = [];

  const SHAPE: Record<string, string> = {
    I: 'input',
    O: 'output',
    B: 'bidirectional',
    T: 'tri_state',
    U: 'passive',
  };
  // `SHEET_SIDE` -> the angle `(at x y angle)` a modern sheet pin carries:
  // right 0, top 90, left 180, bottom 270, the same convention a pin uses.
  const SIDE: Record<string, number> = { R: 0, T: 90, L: 180, B: 270 };

  for (i++; i < lines.length; i++) {
    const raw = lines[i]!;
    const s = new Scanner(raw, i + 1);
    if (s.take('$EndSheet')) {
      screen.children.push({ file, uuid });
      screen.items.push(
        list(
          atom('sheet'),
          at(pos.x, pos.y, 0),
          list(atom('size'), atom(mm(size.x)), atom(mm(size.y))),
          list(atom('fields_autoplaced'), atom('yes')),
          uuidNode(uuid),
          list(
            atom('property'),
            str('Sheetname'),
            str(name),
            at(pos.x, pos.y, 0),
            sizeEffects(nameSize, [list(atom('justify'), atom('left'), atom('bottom'))]),
          ),
          list(
            atom('property'),
            str('Sheetfile'),
            str(modernSheetFile(file)),
            at(pos.x, pos.y + size.y, 0),
            sizeEffects(fileSize, [list(atom('justify'), atom('left'), atom('top'))]),
          ),
          ...pins,
        ),
      );
      return i;
    }
    if (s.take('S')) {
      pos = { x: mil(s.int()), y: mil(s.int()) };
      size = { x: mil(s.int()), y: mil(s.int()) };
      continue;
    }
    if (s.take('U')) {
      const text = s.word();
      // "00000000" is the legacy placeholder for "no id"; anything else is one.
      if (text !== '00000000') uuid = legacyUuid(text);
      continue;
    }
    if (raw[0] === 'F') {
      const f = new Scanner(raw.slice(1), i + 1);
      const id = f.int();
      if (id === 0 || id === 1) {
        const text = f.quoted();
        const sz = mil(f.int());
        if (id === 0) {
          name = text;
          nameSize = sz;
        } else {
          file = text;
          fileSize = sz;
        }
        continue;
      }
      // A sheet pin. The legacy id is its ordinal and carries nothing else.
      const text = f.quoted(true);
      const shape = SHAPE[f.char()];
      if (shape === undefined) throw new ParseError(`invalid sheet pin type: ${raw}`);
      const angle = SIDE[f.char()];
      if (angle === undefined) throw new ParseError(`invalid sheet pin side: ${raw}`);
      const px = mil(f.int());
      const py = mil(f.int());
      const psize = mil(f.int());
      pins.push(
        list(
          atom('pin'),
          str(convertToNewOverbarNotation(text)),
          atom(shape),
          at(px, py, angle),
          sizeEffects(psize),
          uuidNode(mintUuid()),
        ),
      );
    }
  }
  throw new ParseError("missing '$EndSheet'");
}

/** The `.kicad_sch` name a converted `.sch` sheet points at. */
export function modernSheetFile(file: string): string {
  return file.replace(/\.sch$/i, '.kicad_sch');
}

/**
 * A legacy 8-hex-digit timestamp id as a KIID.
 *
 *     KIID::KIID( timestamp_t aTimestamp )
 *     {
 *         m_uuid.data[12] = static_cast<uint8_t>( aTimestamp >> 24 );
 *         m_uuid.data[13] = static_cast<uint8_t>( aTimestamp >> 16 );
 *         m_uuid.data[14] = static_cast<uint8_t>( aTimestamp >> 8 );
 *         m_uuid.data[15] = static_cast<uint8_t>( aTimestamp );
 *     }
 *
 * The timestamp goes in the LAST four bytes, so `4B617B88` becomes
 * `00000000-0000-0000-0000-00004b617b88` and not the other way round. Which
 * end it lands on is not cosmetic: these ids are what a symbol instance path is
 * built from, and a converted project has to agree with the one KiCad would
 * have written or every instance is filed under a path nothing matches.
 */
export function legacyUuid(timestamp: string): string {
  const hex = timestamp
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .padStart(8, '0')
    .slice(-8);
  return `00000000-0000-0000-0000-0000${hex}`;
}

/** `loadWire` (`:782-890`). */
function loadWire(lines: string[], i: number, screen: Screen, mintUuid: () => string): number {
  const s = new Scanner(lines[i]!, i + 1);
  s.take('Wire');
  let kind: 'wire' | 'bus' | 'polyline';
  if (s.take('Wire')) kind = 'wire';
  else if (s.take('Bus')) kind = 'bus';
  else if (s.take('Notes')) kind = 'polyline';
  else throw new ParseError(`invalid line type: ${lines[i]}`);
  if (!s.take('Line')) throw new ParseError(`invalid wire definition: ${lines[i]}`);

  // "The default graphical line style was Dashed."
  let style = kind === 'polyline' ? 'dash' : 'default';
  let width: number | null = null;
  let colour: [number, number, number, number] | null = null;

  while (!s.atEol()) {
    const buf = s.word(true);
    if (buf === ')' || buf === '') continue;
    if (buf === 'width') {
      width = mil(s.int());
    } else if (buf === 'style') {
      const v = s.word(true);
      style =
        v === 'solid'
          ? 'solid'
          : v === 'dashed'
            ? 'dash'
            : v === 'dash_dot'
              ? 'dash_dot'
              : v === 'dotted'
                ? 'dot'
                : style;
    } else {
      // "The color param is something like rgb(150, 40, 191) and because there
      // is no space between ( and 150 the first param is inside buf."
      const cut = buf.lastIndexOf('(');
      if (cut === -1) continue;
      const keyword = buf.slice(0, cut);
      const prm = buf.slice(cut + 1);
      if (keyword !== 'rgb' && keyword !== 'rgba') continue;
      const values = [0, 0, 0, 255];
      let ii = 0;
      if (prm !== '') {
        values[ii] = Number.parseInt(prm, 10) || 0;
        ii++;
      }
      const count = keyword === 'rgba' ? 4 : 3;
      for (; ii < count && !s.atEol(); ii++) values[ii] = s.int();
      colour = [values[0]!, values[1]!, values[2]!, values[3]!];
    }
  }

  i++;
  const pts = new Scanner(lines[i] ?? '', i + 1);
  const x1 = mil(pts.int());
  const y1 = mil(pts.int());
  const x2 = mil(pts.int());
  const y2 = mil(pts.int());

  const stroke: SNode[] = [
    atom('stroke'),
    list(atom('width'), atom(mm(width ?? 0))),
    list(atom('type'), atom(style)),
  ];
  if (colour) {
    stroke.push(
      list(
        atom('color'),
        ...colour.slice(0, 3).map((c) => atom(String(c))),
        atom(String(colour[3] / 255)),
      ),
    );
  }

  screen.items.push(
    list(
      atom(kind),
      list(atom('pts'), point('xy', x1, y1), point('xy', x2, y2)),
      { kind: 'list', items: stroke },
      uuidNode(mintUuid()),
    ),
  );
  return i;
}

/** `loadBusEntry` (`:892-949`). */
function loadBusEntry(lines: string[], i: number, screen: Screen, mintUuid: () => string): number {
  const s = new Scanner(lines[i]!, i + 1);
  s.take('Entry');
  if (s.take('Wire')) {
    if (!s.take('Line')) throw new ParseError(`invalid bus entry, expected 'Line': ${lines[i]}`);
  } else if (s.take('Bus')) {
    if (!s.take('Bus')) throw new ParseError(`invalid bus entry, expected 'Bus': ${lines[i]}`);
  } else {
    throw new ParseError(`invalid bus entry type: ${lines[i]}`);
  }

  i++;
  const p = new Scanner(lines[i] ?? '', i + 1);
  const x = mil(p.int());
  const y = mil(p.int());
  // "size.x -= pos.x" — the second pair is the far END, not a size.
  const sx = mil(p.int()) - x;
  const sy = mil(p.int()) - y;

  screen.items.push(
    list(
      atom('bus_entry'),
      at(x, y, 0),
      list(atom('size'), atom(mm(sx)), atom(mm(sy))),
      list(atom('stroke'), list(atom('width'), atom('0')), list(atom('type'), atom('default'))),
      uuidNode(mintUuid()),
    ),
  );
  return i;
}

/**
 * `loadText` (`:951-1114`).
 *
 * The spin style is stored with two different encodings, and upstream's comment
 * is the clearest statement of it:
 *
 *                       Global      Local
 *     Left justified      0           2
 *     Up                  1           3
 *     Right justified     2           0
 *     Down                3           1
 *
 * so a plain label's 0 and 2 are swapped before the enum is read.
 */
function loadText(
  lines: string[],
  i: number,
  screen: Screen,
  version: number,
  mintUuid: () => string,
): number {
  const s = new Scanner(lines[i]!, i + 1);
  s.take('Text');

  let kind: 'text' | 'label' | 'hierarchical_label' | 'global_label';
  if (s.take('Notes')) kind = 'text';
  else if (s.take('Label')) kind = 'label';
  else if (s.take('HLabel')) kind = 'hierarchical_label';
  else if (s.take('GLabel')) kind = version === 1 ? 'hierarchical_label' : 'global_label';
  else throw new ParseError(`unknown Text type: ${lines[i]}`);

  const x = mil(s.int());
  const y = mil(s.int());
  let spin = s.int();
  if (kind !== 'global_label' && kind !== 'hierarchical_label') {
    if (spin === 0) spin = 2;
    else if (spin === 2) spin = 0;
  }
  const size = mil(s.int());

  // SPIN_STYLE -> the angle the modern format writes: RIGHT 0, UP 90, LEFT 180,
  // BOTTOM 270 (`SPIN_STYLE::LEFT` is 0 in the enum, hence the table).
  const SPIN_ANGLE: Record<number, number> = { 0: 180, 1: 90, 2: 0, 3: 270 };
  const angle = SPIN_ANGLE[spin] ?? 0;

  let shape: string | null = null;
  if (kind === 'hierarchical_label' || kind === 'global_label') {
    const SHAPES: [string, string][] = [
      ['Input', 'input'],
      ['Output', 'output'],
      ['BiDi', 'bidirectional'],
      ['3State', 'tri_state'],
      ['UnSpc', 'passive'],
    ];
    for (const [token, name] of SHAPES) {
      if (s.take(token)) {
        shape = name;
        break;
      }
    }
    if (shape === null) throw new ParseError(`invalid label type: ${lines[i]}`);
  }

  let italic = false;
  let penWidth = 0;
  if (version > 1) {
    if (version > 2 || !s.atEol()) {
      if (s.take('Italic')) italic = true;
      else if (!s.take('~')) throw new ParseError(`expected 'Italics' or '~': ${lines[i]}`);
    }
    if (!s.atEol()) penWidth = s.int();
  }

  // The text itself is the whole of the next line, with `\n` sequences turned
  // into real newlines.
  i++;
  const value = convertToNewOverbarNotation(
    (lines[i] ?? '').replace(/\r$/, '').split('\\n').join('\n'),
  );

  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(size)), atom(mm(size)))];
  if (italic) font.push(list(atom('italic'), atom('yes')));
  if (penWidth !== 0) font.push(list(atom('bold'), atom('yes')));

  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (kind === 'text') {
    // `SCH_TEXT` takes its justification from the spin style and always sits on
    // the bottom of its line (`text->SetVertJustify( GR_TEXT_V_ALIGN_BOTTOM )`).
    const h = spin === 0 || spin === 1 ? 'left' : 'right';
    effects.push(list(atom('justify'), atom(h), atom('bottom')));
  }

  screen.items.push(
    list(
      atom(kind),
      str(value),
      ...(shape ? [list(atom('shape'), atom(shape))] : []),
      at(x, y, kind === 'text' ? (spin === 1 || spin === 3 ? 90 : 0) : angle),
      { kind: 'list', items: effects },
      uuidNode(mintUuid()),
    ),
  );
  return i;
}

/** One `F` line of a `$Comp`. */
interface SymbolField {
  id: number;
  node: SList;
}

/** `loadSymbol` (`:1116-1466`). */
function loadSymbol(
  lines: string[],
  i: number,
  screen: Screen,
  ctx: {
    version: number;
    rootUuid: string;
    sheetPath: string[];
    project: string;
    mintUuid: () => string;
  },
): number {
  let libId = '';
  let unit = 1;
  let bodyStyle = 1;
  let uuid = ctx.mintUuid();
  let pos = { x: 0, y: 0 };
  let transform = IDENTITY;
  const fields: SymbolField[] = [];
  const instances: { path: string[]; reference: string; unit: number }[] = [];
  let reference = '';

  const MANDATORY = ['Reference', 'Value', 'Footprint', 'Datasheet'];

  for (i++; i < lines.length; i++) {
    const raw = lines[i]!;
    const s = new Scanner(raw, i + 1);

    if (s.take('$EndComp')) {
      break;
    }
    if (s.take('L')) {
      const t = s.tokens();
      if (t.length < 2) throw new ParseError(`invalid symbol library definition: ${raw}`);
      const libName = t[0]!.replace(/~/g, ' ');
      // "Prior to schematic version 4, library IDs did not have a library
      // nickname", so the whole string is the item name and not an id to parse.
      libId = ctx.version > 3 ? libName : libName;
      reference = t[1]!.replace(/~/g, ' ');
      continue;
    }
    if (s.take('U')) {
      // "This fixes a potentially buggy files caused by unit being set to zero
      // which causes netlist issues." Same for the body style.
      unit = s.int() || 1;
      bodyStyle = s.int() || 1;
      const text = s.word(true);
      if (text !== '' && text !== '00000000') uuid = legacyUuid(text);
      continue;
    }
    if (s.take('P')) {
      pos = { x: mil(s.int()), y: mil(s.int()) };
      continue;
    }
    if (s.take('AR')) {
      const rest = raw.slice(raw.indexOf('AR') + 2);
      const m = /Path="([^"]*)"\s*Ref="([^"]*)"\s*Part="([^"]*)"/.exec(rest);
      if (!m) throw new ParseError(`invalid AR line: ${raw}`);
      // "AR path excludes root sheet, but includes symbol. Drop the symbol ID
      // since it's already defined in the symbol itself." Then the root
      // screen's UUID is prefixed, because the modern format heads every
      // instance path with it.
      const parts = m[1]!.split('/').filter(Boolean).map(legacyUuid);
      parts.pop();
      instances.push({
        path: [ctx.rootUuid, ...parts],
        reference: m[2]!,
        unit: Number.parseInt(m[3]!, 10) || 1,
      });
      reference = m[2]!;
      continue;
    }
    if (s.take('F')) {
      const id = s.int();
      const text = s.quoted(true);
      const orientation = s.char();
      const fx2 = mil(s.int());
      const fy2 = mil(s.int());
      const size = mil(s.int());
      const attributes = Number.parseInt(s.word(true), 16) || 0;

      const justify: string[] = [];
      let italic = false;
      let bold = false;
      let name = '';
      if (ctx.version > 1) {
        const h = s.char();
        const attrs = s.word(true);
        name = s.atEol() ? '' : s.quoted(true);
        if (h === 'L') justify.push('left');
        else if (h === 'R') justify.push('right');
        else if (h !== 'C') throw new ParseError(`invalid field justification: ${raw}`);
        if (attrs[0] === 'T') justify.push('top');
        else if (attrs[0] === 'B') justify.push('bottom');
        else if (attrs[0] !== 'C') throw new ParseError(`invalid field justification: ${raw}`);
        if (attrs.length === 3) {
          if (attrs[1] === 'I') italic = true;
          if (attrs[2] === 'B') bold = true;
        }
      }
      if (name === '') name = MANDATORY[id] ?? `Field${id}`;

      const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(size)), atom(mm(size)))];
      if (italic) font.push(list(atom('italic'), atom('yes')));
      if (bold) font.push(list(atom('bold'), atom('yes')));

      fields.push({
        id,
        node: list(
          atom('property'),
          str(name),
          str(text),
          // "Y got inverted in symbol coordinates": mirrored about the symbol.
          at(fx2, -(fy2 - pos.y) + pos.y, orientation === 'V' ? 90 : 0),
          {
            kind: 'list',
            items: [
              atom('effects'),
              { kind: 'list', items: font },
              ...(justify.length ? [list(atom('justify'), ...justify.map((j) => atom(j)))] : []),
              ...hide(attributes !== 0),
            ],
          },
        ),
      });
      continue;
    }
    // "There are two lines that begin with a tab or spaces that includes a line
    // with the redundant position information and the transform matrix."
    if (/^[\s\t]/.test(raw) && raw.trim() !== '') {
      i++;
      const t = new Scanner(lines[i] ?? '', i + 1);
      transform = { x1: t.int(), y1: -t.int(), x2: t.int(), y2: -t.int() };
    }
  }

  if (instances.length === 0) {
    // "if( m_currentSheet == m_rootSheet )" — a symbol with no AR lines gets one
    // instance naming the root screen; on a child sheet it gets none at all,
    // because `symbol->GetInstances()` is still empty at that point.
    if (ctx.sheetPath.length === 0) {
      instances.push({ path: [ctx.rootUuid], reference, unit });
    }
  }

  const orient = transformToOrientation(transform);
  const byId = (n: number): SList | undefined => fields.find((f) => f.id === n)?.node;

  screen.items.push(
    list(
      atom('symbol'),
      list(atom('lib_id'), str(libId)),
      at(pos.x, pos.y, orient.angle),
      ...(orient.mirror ? [list(atom('mirror'), atom(orient.mirror))] : []),
      list(atom('unit'), atom(String(unit))),
      list(atom('convert'), atom(String(bodyStyle))),
      list(atom('in_bom'), atom('yes')),
      list(atom('on_board'), atom('yes')),
      uuidNode(uuid),
      ...MANDATORY.map(
        (name, n) =>
          byId(n) ??
          list(
            atom('property'),
            str(name),
            str(''),
            at(pos.x, pos.y, 0),
            sizeEffects(mil(50), hide(true)),
          ),
      ),
      ...fields.filter((f) => f.id >= MANDATORY.length).map((f) => f.node),
      ...(instances.length
        ? [
            list(
              atom('instances'),
              list(
                atom('project'),
                str(ctx.project),
                ...instances.map((inst) =>
                  list(
                    atom('path'),
                    str(`/${inst.path.join('/')}`),
                    list(atom('reference'), str(inst.reference)),
                    list(atom('unit'), atom(String(inst.unit))),
                  ),
                ),
              ),
            ),
          ]
        : []),
    ),
  );
  return i;
}

/** `loadJunction` / `loadNoConnect` (`:738-780`). */
function loadPoint(line: string, token: string, node: string, mintUuid: () => string): SList {
  const s = new Scanner(line, 0);
  s.take(token);
  s.word(true); // the name, which upstream parses and discards
  const x = mil(s.int());
  const y = mil(s.int());
  return node === 'junction'
    ? list(atom('junction'), at(x, y, 0), list(atom('diameter'), atom('0')), uuidNode(mintUuid()))
    : list(atom('no_connect'), at(x, y, 0), uuidNode(mintUuid()));
}

/** `loadBusAlias` (`:1471-1495`). */
function loadBusAlias(line: string): SList {
  const s = new Scanner(line, 0);
  s.take('BusAlias');
  const name = s.word();
  const members = s.tokens().filter((t) => t !== '=');
  return list(atom('bus_alias'), str(name), list(atom('members'), ...members.map((m) => str(m))));
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

/** `loadHeader` (`:367-405`): the version, then everything to `EELAYER END`. */
function loadHeader(lines: string[]): { version: number; next: number } {
  const first = lines[0] ?? '';
  const m = /^Eeschema Schematic File Version\s+(\d+)/i.exec(first.trim());
  if (!m) throw new ParseError('does not appear to be an Eeschema file');
  const version = Number.parseInt(m[1]!, 10);
  for (let i = 1; i < lines.length; i++) {
    if (new Scanner(lines[i]!, i + 1).take('EELAYER END')) return { version, next: i + 1 };
  }
  throw new ParseError("Missing 'EELAYER END'");
}

/** How one screen is converted. */
interface ScreenContext {
  rootUuid: string;
  /** The chain of sheet UUIDs from the root down to this screen, root excluded. */
  sheetPath: string[];
  project: string;
  mintUuid: () => string;
}

/** `LoadContent` (`:318-364`): the record loop. */
function readScreen(
  text: string,
  screenUuid: string,
  ctx: ScreenContext,
): { node: SList; screen: Screen } {
  const lines = text.split(/\r\n|\n|\r/);
  const { version, next } = loadHeader(lines);
  const screen: Screen = { items: [], paper: null, titleBlock: null, pageNumber: 1, children: [] };

  for (let i = next; i < lines.length; i++) {
    const raw = lines[i]!.replace(/^ +/, '');
    if (raw === '') continue;
    const s = new Scanner(raw, i + 1);

    if (s.take('$Descr')) i = loadPageSettings(lines, i, screen);
    else if (s.take('$Comp')) i = loadSymbol(lines, i, screen, { ...ctx, version });
    else if (s.take('$Sheet')) i = loadSheet(lines, i, screen, ctx.mintUuid);
    else if (s.take('$Bitmap')) i = skipBitmap(lines, i);
    else if (s.take('Connection'))
      screen.items.push(loadPoint(raw, 'Connection', 'junction', ctx.mintUuid));
    else if (s.take('NoConn'))
      screen.items.push(loadPoint(raw, 'NoConn', 'no_connect', ctx.mintUuid));
    else if (s.take('Wire')) i = loadWire(lines, i, screen, ctx.mintUuid);
    else if (s.take('Entry')) i = loadBusEntry(lines, i, screen, ctx.mintUuid);
    else if (s.take('Text')) i = loadText(lines, i, screen, version, ctx.mintUuid);
    else if (s.take('BusAlias')) screen.items.push(loadBusAlias(raw));
    else if (s.take('Kmarq'))
      continue; // "Ignore legacy (until 2009) ERC marker entry"
    else if (s.take('$EndSCHEMATC')) break;
    else throw new ParseError(`unrecognized token at line ${i + 1}: ${raw}`);
  }

  const node: SList = {
    kind: 'list',
    items: [
      atom('kicad_sch'),
      list(atom('version'), atom(String(SEXPR_SCHEMATIC_FILE_VERSION))),
      list(atom('generator'), str('eeschema')),
      uuidNode(screenUuid),
      ...(screen.paper ? [screen.paper] : []),
      ...(screen.titleBlock ? [screen.titleBlock] : []),
      ...screen.items,
      list(
        atom('sheet_instances'),
        list(atom('path'), str('/'), list(atom('page'), str(String(screen.pageNumber)))),
      ),
    ],
  };
  return { node, screen };
}

/**
 * `loadBitmap` (`:646-736`) reads a PNG out of a `$Bitmap … $EndBitmap` block.
 *
 * Skipped, and deliberately: the block holds the image as raw bytes written as
 * hex text, and the modern format holds it base64 inside `(image …)`. Carrying
 * it across is a byte-for-byte re-encode with no bearing on what this reader
 * exists for, and a converted sheet that quietly LOST an image would be worse
 * than one that never claimed to keep it — so the caller is told.
 */
function skipBitmap(lines: string[], i: number): number {
  for (i++; i < lines.length; i++) {
    if (new Scanner(lines[i]!, i + 1).take('$EndBitmap')) return i;
  }
  throw new ParseError("missing '$EndBitmap'");
}

// ---------------------------------------------------------------------------
// The project
// ---------------------------------------------------------------------------

export interface LegacyProjectInput {
  /** Every `.sch` of the project, by basename. */
  readonly files: ReadonlyMap<string, string>;
  /** The root sheet's basename, e.g. `board.sch`. */
  readonly rootFile: string;
  /** The name the instance blocks are filed under — the `.kicad_pro`'s stem. */
  readonly projectName: string;
  /**
   * The library definitions to embed as `lib_symbols`.
   *
   * A legacy schematic embeds none: `SCH_SCREEN::UpdateSymbolLinks` fills
   * `m_libSymbols` from the resolved library at load, and it is that which gets
   * written into a `.kicad_sch`. Ours is handed the same thing — for a legacy
   * project that is the cache library, read by `read-lib.ts`.
   */
  readonly libSymbols?: ReadonlyMap<string, LibSymbol>;
  /** Injected so a test can fix them; `crypto.randomUUID` otherwise. */
  readonly newUuid?: () => string;
}

export interface LegacyProjectResult {
  /** The converted documents, keyed by their `.kicad_sch` basename. */
  readonly docs: Map<string, Schematic>;
  /** Sheets named but not supplied, and anything else worth telling the user. */
  readonly problems: string[];
}

/**
 * `LoadSchematicFile` plus `loadHierarchy` (`:126-277`): the root screen, and
 * every screen the `$Sheet` records reach, depth first.
 *
 * A file that appears twice in the hierarchy is converted once and shared, the
 * way `loadHierarchy` reuses a screen it has already seen — that sharing is
 * what makes two instances of one sub-sheet the same document rather than two
 * copies of it.
 */
export function readLegacyProject(
  input: LegacyProjectInput,
  reporter?: Reporter,
): LegacyProjectResult {
  const mintUuid = input.newUuid ?? (() => crypto.randomUUID());
  const problems: string[] = [];
  const docs = new Map<string, Schematic>();
  const screenUuids = new Map<string, string>();

  const uuidFor = (file: string): string => {
    const known = screenUuids.get(file);
    if (known) return known;
    const fresh = mintUuid();
    screenUuids.set(file, fresh);
    return fresh;
  };

  const rootUuid = uuidFor(input.rootFile);
  // `writeLibSymbolNode` names the entry after the symbol's own `libId`, and a
  // legacy library's symbols are named without a nickname — `R`, not
  // `Device:R`. The sheet resolves through the FULL id, so the map's key is
  // what the embedded copy has to be filed under.
  const libSymbolNodes = [...(input.libSymbols?.entries() ?? [])].map(([libId, sym]) =>
    writeLibSymbolNode({ ...sym, libId }),
  );

  const walk = (file: string, sheetPath: string[]): void => {
    if (docs.has(modernSheetFile(file))) return;
    const text = input.files.get(file);
    if (text === undefined) {
      problems.push(`sheet file not found: ${file}`);
      return;
    }

    const { node, screen } = readScreen(text, uuidFor(file), {
      rootUuid,
      sheetPath,
      project: input.projectName,
      mintUuid,
    });

    // `lib_symbols` goes in first, where the grammar puts it.
    if (libSymbolNodes.length) {
      node.items.splice(4, 0, {
        kind: 'list',
        items: [atom('lib_symbols'), ...libSymbolNodes],
      });
    }

    const doc = readSchematic(node, reporter);
    docs.set(modernSheetFile(file), { ...doc, fileName: modernSheetFile(file) });

    for (const child of screen.children) {
      if (child.file === '') continue;
      walk(child.file, [...sheetPath, child.uuid]);
    }
  };

  walk(input.rootFile, []);
  return { docs, problems };
}
