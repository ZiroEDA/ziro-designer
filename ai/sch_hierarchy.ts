// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * zsch's hierarchy lines, run on the live model (KiCad's own classes) through the frame:
 *
 *   sheet "NAME" FILE @x,y w,h    a new sheet on the sheet being edited (SCH_DRAWING_TOOLS::DrawSheet)
 *   in "NAME" | in root           the lines after it edit that sheet (a path: "Power/Reg")
 *   port NAME DIR REF.PIN | @x,y  a hierarchical label in the sheet being edited, on a pin or a point,
 *                                 turned as KiCad turns a label placed there (AutoRotateItem)
 *   pins "NAME"                   a sheet pin for every hierarchical label inside that sheet
 *                                 (SCH_DRAWING_TOOLS::AutoPlaceAllSheetPins)
 *
 * and, on the parent, a `net` line names a sheet pin as SHEET.PIN: the net's label goes on it.
 *
 * Every edit is one KiCad does from its own tools; the edits come back to the window as one undo
 * step (SchScriptApi.editLive). Positions are mm on the 50 mil grid, as in the rest of zsch.
 */
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { parseColor4d } from '@ziroeda/common/gal/color4d.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { currentEeschemaSettings } from '@ziroeda/eeschema/eeschema_settings.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import { AUTOPLACE_ALGO } from '@ziroeda/eeschema/sch_item.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SHEET_SIDE } from '@ziroeda/eeschema/sch_sheet_pin.js';
import type { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_DRAWING_TOOLS } from '@ziroeda/eeschema/tools/sch_drawing_tools.js';

const IU_PER_MM = 10000;
/** KiCad's default schematic grid, 50 mil. */
const GRID = 12700;
const toIU = (s: string) => Math.round((Number.parseFloat(s) * IU_PER_MM) / GRID) * GRID;
const mm = (iu: number) => {
  const v = Math.round((iu / IU_PER_MM) * 100) / 100;
  return Number.isInteger(v) ? `${v}` : v.toFixed(2).replace(/0+$/, '');
};
const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

/** zsch's port directions, to KiCad's label shapes. */
export const PORT_SHAPES: Readonly<Record<string, LABEL_FLAG_SHAPE>> = {
  in: LABEL_FLAG_SHAPE.L_INPUT,
  out: LABEL_FLAG_SHAPE.L_OUTPUT,
  bidi: LABEL_FLAG_SHAPE.L_BIDI,
  tri: LABEL_FLAG_SHAPE.L_TRISTATE,
  passive: LABEL_FLAG_SHAPE.L_UNSPECIFIED,
};
const SHAPE_NAMES = new Map(Object.entries(PORT_SHAPES).map(([k, v]) => [v, k]));

/** One hierarchy line, parsed; `at` is the sheet being edited when it runs. */
export type HierOp =
  | {
      kind: 'sheet';
      name: string;
      file: string;
      at: { x: number; y: number };
      end: { x: number; y: number };
    }
  | {
      kind: 'port';
      name: string;
      shape: LABEL_FLAG_SHAPE;
      pin?: string;
      at?: { x: number; y: number };
    }
  | { kind: 'pins'; sheet: string }
  | { kind: 'sheetnet'; name: string; pin: string };

const POINT = /^@(-?[\d.]+),(-?[\d.]+)$/;

/** Parse a hierarchy line's tokens (after the keyword), or throw what is wrong with it. */
export function parseHierLine(kw: string, tokens: string[]): HierOp {
  if (kw === 'sheet') {
    const [name, file, at, size] = tokens;
    const m = POINT.exec(at ?? '');
    const z = /^w?([\d.]+)[,x]h?([\d.]+)$/.exec(size ?? '');
    if (!name || !file || !m || !z) throw new Error('sheet needs "NAME" FILE.kicad_sch @x,y w,h');
    const f = unquote(file);
    if (!/^[^/\\]+\.kicad_sch$/.test(f))
      throw new Error('sheet FILE must be a plain NAME.kicad_sch');
    const x = toIU(m[1] ?? '0');
    const y = toIU(m[2] ?? '0');
    return {
      kind: 'sheet',
      name: unquote(name),
      file: f,
      at: { x, y },
      end: { x: x + toIU(z[1] ?? '0'), y: y + toIU(z[2] ?? '0') },
    };
  }
  if (kw === 'port') {
    const [name, dir, where] = tokens;
    const shape = dir === undefined ? undefined : PORT_SHAPES[dir];
    if (!name || shape === undefined || !where)
      throw new Error(`port needs NAME ${Object.keys(PORT_SHAPES).join('|')} REF.PIN or @x,y`);
    const m = POINT.exec(where);
    if (m) return { kind: 'port', name, shape, at: { x: toIU(m[1] ?? '0'), y: toIU(m[2] ?? '0') } };
    if (!where.includes('.')) throw new Error('port needs a REF.PIN or @x,y to sit on');
    return { kind: 'port', name, shape, pin: where };
  }
  if (kw === 'pins') {
    const [sheet] = tokens;
    if (!sheet) throw new Error('pins needs "SHEETNAME"');
    return { kind: 'pins', sheet: unquote(sheet) };
  }
  throw new Error(`unknown keyword ${kw}`);
}

/** The root's path. */
function rootPath(aFrame: SCH_EDIT_FRAME): SCH_SHEET_PATH {
  return (
    aFrame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1) ?? aFrame.GetCurrentSheet()
  );
}

/** The names from the root down to \a aPath's sheet ("" for the root). */
export function sheetPathName(aPath: SCH_SHEET_PATH): string {
  const names: string[] = [];
  for (let i = 1; i < aPath.size(); i++) names.push(aPath.at(i)!.GetName());
  return names.join('/');
}

/** The path named "A/B" below the root (or "root"), or null. */
export function findSheetPath(aFrame: SCH_EDIT_FRAME, aName: string): SCH_SHEET_PATH | null {
  if (aName === 'root' || aName === '') return rootPath(aFrame);
  return (
    aFrame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() > 1 && sheetPathName(p) === aName) ?? null
  );
}

/** The items of class \a aClass on \a aScreen (the ai package does not see KICAD_T). */
function itemsOf<T>(aScreen: SCH_SCREEN, aClass: abstract new (...args: never[]) => T): T[] {
  return [...aScreen.Items()].filter((i): i is T & typeof i => i instanceof aClass) as T[];
}

/** The sheet named \a aName placed on \a aScreen. */
function sheetOn(aScreen: SCH_SCREEN, aName: string): SCH_SHEET | null {
  for (const sheet of itemsOf(aScreen, SCH_SHEET)) if (sheet.GetName() === aName) return sheet;
  return null;
}

/** The connection point of REF.PIN (number or name) on the sheet \a aPath shows. */
function pinPoint(aPath: SCH_SHEET_PATH, aRef: string): { x: number; y: number } | string {
  const dot = aRef.lastIndexOf('.');
  const ref = aRef.slice(0, dot);
  const pin = aRef.slice(dot + 1);
  const screen = aPath.LastScreen()!;
  for (const symbol of itemsOf(screen, SCH_SYMBOL)) {
    if (symbol.GetRef(aPath, false) !== ref) continue;
    const pins = symbol.GetPins(aPath);
    const hit =
      pins.find((p) => p.GetNumber() === pin) ??
      pins.find((p) => p.GetName() === pin || p.GetShownName() === pin);
    if (hit) return hit.GetPosition();
    return `no pin ${aRef}. Its pins: ${pins.map((p) => `${p.GetNumber()}=${p.GetName() || '~'}`).join(' ')}`;
  }
  return `no part ${ref} on this sheet`;
}

/** The file of the sheet \a aPathName and the names of the sheets placed on it, or null. */
export function sheetFileAndSheets(
  aFrame: SCH_EDIT_FRAME,
  aPathName: string,
): { file: string; sheets: Set<string> } | null {
  const path = findSheetPath(aFrame, aPathName);
  const screen = path?.LastScreen();
  if (!screen) return null;
  return {
    file: screen.GetFileName(),
    sheets: new Set(itemsOf(screen, SCH_SHEET).map((s) => s.GetName())),
  };
}

/**
 * `SCH_DRAWING_TOOLS::DrawSheet`'s two clicks without the cursor: the sheet from its top-left
 * \a aPos to \a aEnd, given the name and file the sheet properties dialog would have been given
 * (the file linked through ChangeSheetFile, as EditSheetProperties does), on the next free page,
 * added to the current screen in one commit. Null when the file change was refused.
 */
export async function drawSheet(
  aFrame: SCH_EDIT_FRAME,
  aTools: SCH_DRAWING_TOOLS,
  aPos: VECTOR2I,
  aEnd: VECTOR2I,
  aName: string,
  aFileName: string,
): Promise<SCH_SHEET | null> {
  const cfg = currentEeschemaSettings();
  const sheet = new SCH_SHEET(aFrame.GetCurrentSheet().Last(), aPos);
  sheet.SetScreen(null);

  sheet.GetField(FIELD_T.SHEET_NAME)!.SetText(aName);
  sheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(aFileName);

  sheet.SetFlags(IS_NEW | IS_MOVING);
  sheet.SetBorderWidth(schIUScale.milsToIU(cfg.drawing.default_line_thickness));
  sheet.SetBorderColor(parseColor4d(cfg.drawing.default_sheet_border_color));
  sheet.SetBackgroundColor(parseColor4d(cfg.drawing.default_sheet_background_color));
  aTools.sizeSheet(sheet, aEnd);

  const hierarchy = aFrame.Schematic().Hierarchy();
  const instance = aFrame.GetCurrentSheet().Clone();
  instance.push_back(sheet);

  // Find the next available page number by checking all existing page numbers
  const usedPageNumbers = new Set<number>();

  for (const path of hierarchy) {
    const pageNum = Number.parseInt(path.GetPageNumber(), 10);

    if (`${pageNum}` === path.GetPageNumber().trim() && pageNum > 0) usedPageNumbers.add(pageNum);
  }

  let nextAvailable = 1;

  while (usedPageNumbers.has(nextAvailable)) nextAvailable++;

  instance.SetPageNumber(`${nextAvailable}`);

  // EditSheetProperties: the dialog's file name goes through ChangeSheetFile.
  if (!(await aFrame.ChangeSheetFile(sheet, aFileName))) return null;

  sheet.ClearFlags(IS_NEW | IS_MOVING);
  sheet.AutoplaceFields(aFrame.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

  const commit = new SCH_COMMIT(aFrame);

  // We need to manually add the sheet to the screen otherwise annotation will not be able to find
  // the sheet and its symbols to annotate.
  aFrame.AddToScreen(sheet, aFrame.GetScreen());
  commit.Added(sheet, aFrame.GetScreen());

  // Refresh the hierarchy so the new sheet and its symbols are found during annotation.
  aFrame.Schematic().RefreshHierarchy();

  commit.Push('Draw Sheet');
  return sheet;
}

/**
 * `SCH_DRAWING_TOOLS::createNewLabel( aPosition, LAYER_HIERLABEL, … )` with the text and shape
 * the label properties dialog would have been given; the caller places it (TwoClickPlace's
 * second click). The tool remembers the choices as the dialog makes it.
 */
export function newHierLabel(
  aFrame: SCH_EDIT_FRAME,
  aTools: SCH_DRAWING_TOOLS,
  aPosition: VECTOR2I,
  aText: string,
  aShape: LABEL_FLAG_SHAPE,
): SCH_LABEL_BASE {
  const settings = aFrame.Schematic().Settings();
  const labelItem = new SCH_HIERLABEL(aPosition);
  labelItem.SetShape(aTools.m_lastGlobalLabelShape);
  labelItem.SetAutoRotateOnPlacement(aTools.m_lastAutoLabelRotateOnPlacement);

  // The normal parent is the current screen for these labels, set by SCH_SCREEN::Append()
  // but it is also used during placement for SCH_HIERLABEL before beeing appended
  labelItem.SetParent(aFrame.GetScreen());

  labelItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });

  // Must be after SetTextSize()
  labelItem.SetBold(aTools.m_lastTextBold);
  labelItem.SetItalic(aTools.m_lastTextItalic);

  labelItem.SetSpinStyle(aTools.m_lastTextOrientation);
  labelItem.SetFlags(IS_NEW | IS_MOVING);

  // DIALOG_LABEL_PROPERTIES: the text and shape it would have been given.
  labelItem.SetText(aText);
  labelItem.SetShape(aShape);

  aTools.m_lastTextBold = labelItem.IsBold();
  aTools.m_lastTextItalic = labelItem.IsItalic();
  aTools.m_lastTextOrientation = labelItem.GetSpinStyle();
  aTools.m_lastGlobalLabelShape = labelItem.GetShape();
  aTools.m_lastAutoLabelRotateOnPlacement = labelItem.AutoRotateOnPlacement();

  return labelItem;
}

/**
 * Run \a aOps on the sheet \a aPathName ("" or "root" for the root), in order, on the live frame.
 * Returns the screens changed, or throws with every line that failed (nothing is changed then:
 * the caller's editLive discards a thrown edit with the live model rebuilt from the window).
 */
export async function runHierOps(
  aFrame: SCH_EDIT_FRAME,
  aPathName: string,
  aOps: readonly { line: string; op: HierOp }[],
): Promise<SCH_SCREEN[]> {
  const schematic = aFrame.Schematic();
  // A copy: SetCurrentSheet assigns into the schematic's own path (*m_currentSheet = aPath).
  const before = schematic.CurrentSheet().Clone();
  const path = findSheetPath(aFrame, aPathName);
  if (!path) throw new Error(`in ${aPathName}: no such sheet`);

  const tools = new SCH_DRAWING_TOOLS(aFrame);
  const changed = new Set<SCH_SCREEN>();
  const errors: string[] = [];
  schematic.SetCurrentSheet(path);

  try {
    for (const { line, op } of aOps) {
      // Every op works on the sheet the batch is editing, whatever an earlier op entered.
      schematic.SetCurrentSheet(path);
      const screen = path.LastScreen()!;
      try {
        if (op.kind === 'sheet') {
          if (sheetOn(screen, op.name)) throw new Error(`a sheet ${op.name} is already here`);
          const sheet = await drawSheet(aFrame, tools, op.at, op.end, op.name, op.file);
          if (!sheet) throw new Error(`sheet ${op.file} could not be used`);
          changed.add(screen);
          changed.add(sheet.GetScreen()!);
        } else if (op.kind === 'port') {
          const at = op.at ?? pinPoint(path, op.pin ?? '');
          if (typeof at === 'string') throw new Error(at);
          const label = newHierLabel(aFrame, tools, at, op.name, op.shape);
          // TwoClickPlace's second click: AutoRotateItem on a connectable item, then the commit.
          label.SetAutoRotateOnPlacement(true);
          label.ClearFlags();
          aFrame.AutoRotateItem(screen, label);
          const commit = new SCH_COMMIT(aFrame);
          aFrame.AddToScreen(label, screen);
          commit.Added(label, screen);
          commit.Push('Place Label');
          changed.add(screen);
        } else if (op.kind === 'pins') {
          const sheet = sheetOn(screen, op.sheet);
          if (!sheet) throw new Error(`no sheet ${op.sheet} on this sheet`);
          if (!tools.autoPlaceSheetPins(sheet))
            throw new Error(
              `no new hierarchical labels found in ${op.sheet}: add port lines inside it first`,
            );
          changed.add(screen);
        } else {
          // A net's label on a sheet pin: the side tells the label which way to face.
          const dot = op.pin.lastIndexOf('.');
          const sheet = sheetOn(screen, op.pin.slice(0, dot));
          const pin = sheet?.GetPins().find((p) => p.GetText() === op.pin.slice(dot + 1));
          if (!sheet || !pin)
            throw new Error(
              sheet
                ? `no pin ${op.pin}. Its pins: ${
                    sheet
                      .GetPins()
                      .map((p) => p.GetText())
                      .join(' ') || '(none: run pins first)'
                  }`
                : `no sheet ${op.pin.slice(0, dot)} here`,
            );
          const label = new SCH_LABEL(pin.GetPosition(), op.name);
          label.SetTextSize({
            x: schematic.Settings().m_DefaultTextSize,
            y: schematic.Settings().m_DefaultTextSize,
          });
          const side = pin.GetSide();
          label.SetSpinStyle(
            new SPIN_STYLE(
              side === SHEET_SIDE.LEFT
                ? SPIN_STYLE.LEFT
                : side === SHEET_SIDE.RIGHT
                  ? SPIN_STYLE.RIGHT
                  : side === SHEET_SIDE.TOP
                    ? SPIN_STYLE.UP
                    : SPIN_STYLE.BOTTOM,
            ),
          );
          const commit = new SCH_COMMIT(aFrame);
          aFrame.AddToScreen(label, screen);
          commit.Added(label, screen);
          commit.Push('Place Label');
          changed.add(screen);
        }
      } catch (e) {
        errors.push(`${line}: ${(e as Error).message}`);
      }
    }
  } finally {
    schematic.SetCurrentSheet(before);
  }

  if (errors.length) throw new Error(errors.join('\n'));
  return [...changed];
}

/**
 * The hierarchy as zsch, from the live model: every sheet with its file and page, and the sheets
 * placed on \a aPathName's sheet with their pins.
 */
export function readHierarchy(aFrame: SCH_EDIT_FRAME, aPathName: string): string {
  const lines: string[] = [];
  const all = aFrame.Schematic().Hierarchy();
  if (all.length > 1) {
    lines.push('; hierarchy (page, sheet, file):');
    for (const p of all)
      lines.push(
        `;   ${p.GetPageNumber()} ${p.size() === 1 ? 'root' : JSON.stringify(sheetPathName(p))} ${p.LastScreen()?.GetFileName().replace(/^.*\//, '') ?? ''}`,
      );
  }
  const path = findSheetPath(aFrame, aPathName);
  if (!path) return lines.join('\n');
  const screen = path.LastScreen()!;
  for (const sheet of itemsOf(screen, SCH_SHEET)) {
    const pos = sheet.GetPosition();
    const size = sheet.GetSize();
    lines.push(
      `sheet ${JSON.stringify(sheet.GetName())} ${sheet.GetFileName()} @${mm(pos.x)},${mm(pos.y)} ${mm(size.x)},${mm(size.y)}`,
    );
    const pins = sheet.GetPins();
    if (pins.length)
      lines.push(
        `;   pins: ${pins.map((p) => `${p.GetText()}(${SHAPE_NAMES.get(p.GetShape()) ?? '?'})`).join(' ')}`,
      );
  }
  for (const label of itemsOf(screen, SCH_HIERLABEL)) {
    const pos = label.GetPosition();
    lines.push(
      `port ${label.GetText()} ${SHAPE_NAMES.get(label.GetShape()) ?? 'passive'} @${mm(pos.x)},${mm(pos.y)}`,
    );
  }
  return lines.join('\n');
}
