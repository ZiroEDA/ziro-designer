// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One action, one cursor, in every editor that offers it.
 *
 * Reported as "the delete tool doesn't have the right cursor — fix it app wide,
 * I guess the eeschema one already has the correct one". It did: eeschema and
 * the drawing-sheet editor showed KiCad's eraser and the board, footprint and
 * symbol editors showed a crosshair.
 *
 * Upstream a cursor belongs to the tool, and `ACTIONS::deleteTool` is one
 * action however many frames put it on a toolbar. Three different functions
 * implement its picker —
 *
 *     SCH_TOOL_BASE::InteractiveDelete   sch_tool_base.h:256   (eeschema + symbol editor)
 *     PCB_CONTROL::DeleteItemCursor      pcb_control.cpp:833
 *     PL_EDIT_TOOL::DeleteItemCursor     pl_edit_tool.cpp:424
 *
 * — and all three say `picker->SetCursor( KICURSOR::REMOVE )`.
 *
 * Ours was a ternary chain per canvas, five of them, and three had no delete
 * arm at all. This file pins the shared table and, more usefully, pins that
 * every canvas actually consults it: a sixth chain growing its own answer is
 * how the five drifted apart in the first place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sharedToolCursorName, toolCursorCss } from '@ziroeda/designer/src/ui/tool_cursors.js';
import { boardToolCursor } from '@ziroeda/designer/src/editors/pcb/cursors.js';
import { footprintToolCursor } from '@ziroeda/designer/src/editors/footprint/cursors.js';
import { symbolToolCursor } from '@ziroeda/designer/src/editors/symbol/cursors.js';
import { toolCursorName } from '@ziroeda/designer/src/editors/schematic/cursors.js';

describe('the delete tool wears the eraser everywhere', () => {
  // Our own three spellings for the one action. Upstream every one of these
  // toolbar rows is `ACTIONS::deleteTool`; the names are ours, and having three
  // of them is exactly how the frames came to disagree.
  it.each([
    ['delete', 'eeschema'],
    ['deleteTool', 'the board, symbol and footprint editors'],
    ['dsDelete', 'the drawing-sheet editor'],
  ])('%s (%s)', (id) => {
    expect(sharedToolCursorName(id)).toBe('REMOVE');
  });

  it('and eeschema answers through the same table, not its own copy', () => {
    // The schematic keeps a rich per-tool map for its own wire, bus and label
    // cursors. The shared ids must not be restated in it — a second copy is
    // what this whole file exists to prevent.
    expect(toolCursorName('delete')).toBe('REMOVE');
  });
});

describe('the other shared actions', () => {
  it.each([
    ['zoomTool', 'ZOOM_IN'],
    ['measureTool', 'MEASURE'],
    ['placePoint', 'PLACE'],
    ['gridSetOrigin', 'PLACE'],
    ['drillOrigin', 'PLACE'],
  ])('%s runs with %s', (id, want) => {
    expect(sharedToolCursorName(id)).toBe(want);
  });

  it('and the schematic agrees about the zoom tool', () => {
    expect(toolCursorName('zoomTool')).toBe('ZOOM_IN');
  });
});

describe('an editor keeps its own tools to itself', () => {
  it('answers null for a tool no other editor has', () => {
    // Not a fallback: what an editor shows for its own tools genuinely differs
    // — eeschema falls through to the pencil, the board editor to the plain
    // arrow — so a default here would quietly impose one on all of them.
    expect(sharedToolCursorName('drawWire')).toBeNull();
    expect(sharedToolCursorName('placeSymbol')).toBeNull();
    expect(sharedToolCursorName('')).toBeNull();
  });

  it('and the caller’s fallback is used for it', () => {
    expect(toolCursorCss('somethingLocal', 'crosshair')).toBe('crosshair');
  });

  it('while a shared tool ignores the fallback', () => {
    expect(toolCursorCss('deleteTool', 'crosshair')).not.toBe('crosshair');
  });
});

describe('every editor answers through the shared table', () => {
  // Called, not grepped. A source-text check was the first thing written here
  // and it could not fail: a mutant that made the footprint canvas
  // short-circuit to a crosshair *before* consulting the table kept the string
  // `toolCursorCss` in the file, so the grep passed while the eraser was gone.
  // That is CLAUDE.md's "file-level check where the rule is per-occurrence".
  //
  // So each editor's cursor decision is now a function in its own `cursors.ts`
  // — the shape eeschema already had — and this calls them.
  const ERASER = toolCursorCss('deleteTool', 'never');

  it.each([
    ['the board editor', boardToolCursor],
    ['the footprint editor', footprintToolCursor],
    ['the symbol editor', symbolToolCursor],
  ])('%s shows the eraser for its delete tool', (_name, cursorFor) => {
    expect(cursorFor('deleteTool')).toBe(ERASER);
    // …and not merely "something that is not the fallback": the crosshair is
    // what all three used to show.
    expect(cursorFor('deleteTool')).not.toBe('crosshair');
  });

  it.each([
    ['the board editor', boardToolCursor, 'default'],
    ['the footprint editor', footprintToolCursor, 'crosshair'],
    ['the symbol editor', symbolToolCursor, 'crosshair'],
  ])('%s keeps its own fallback for its own tools', (_name, cursorFor, fallback) => {
    expect(cursorFor('someToolOnlyThisEditorHas')).toBe(fallback);
  });

  it('and eeschema, whose map is the one the others were modelled on', () => {
    expect(toolCursorName('delete')).toBe('REMOVE');
  });

  it('the drawing-sheet canvas is the one still checked by source', () => {
    // Its cursor is a five-arm ternary over tools nothing else has, and pulling
    // it into a function is a change to that editor rather than to this one.
    // Named here so the exception is visible rather than an omission.
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx'),
      'utf8',
    );
    expect(src).toContain('sharedToolCursorName');
    expect(src, 'a local delete arm has grown back').not.toContain("'REMOVE'");
  });
});
