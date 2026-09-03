// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every prop `SchematicCanvas` reads has to be one `SchematicEditor` passes.
 *
 * This is a whole bug class, and it is invisible: a prop that is declared,
 * destructured and used, but never passed, is simply `undefined` forever. There
 * is no type error — the prop is optional, which is what makes it optional in
 * the first place — no console warning, and no failing test, because `qa`'s
 * tsconfig cannot compile either file.
 *
 * It cost the directive-label tool entirely. `pendingDirective` was declared on
 * the canvas, destructured, and read in three places, including the one that
 * decides what a click does:
 *
 *     if (activeTool === 'placeClassLabel') {
 *       if (pendingDirective) { ...place the flag... }
 *       else { onLabelPrompt?.(snapConn(world)); }
 *     }
 *
 * `SchematicEditor` never passed it, so the tool asked for a netclass, accepted
 * one, and then took the "ask again" branch on every single click. Placing a
 * netclass directive label was impossible, and nothing anywhere said so.
 *
 * The two files are read as text because that is the only way to see them from
 * here; it is a crude check and it is the one that would have caught this.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS_EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const CANVAS = read('../../../designer/src/editors/schematic/components/SchematicCanvas.tsx');
const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');

/** The prop names declared in the canvas's `interface Props { … }`. */
function declaredProps(src: string): string[] {
  const start = src.indexOf('interface Props {');
  expect(start, 'SchematicCanvas must declare an interface Props').toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  // Two-space indented `name?:` / `name:` entries are the props themselves;
  // anything deeper belongs to an inline object type.
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
}

/** The prop names the canvas actually destructures out of its props object. */
function usedProps(src: string): Set<string> {
  const i = src.indexOf('export const SchematicCanvas');
  const from = i === -1 ? 0 : i;
  // The destructuring block that opens the component body.
  const m = /\{\s*([^}]*?)\}\s*:\s*Props/s.exec(src.slice(from));
  if (!m) return new Set();
  return new Set([...m[1]!.matchAll(/^\s*(\w+)\s*(?:=|,|$)/gm)].map((x) => x[1]!));
}

describe('SchematicCanvas props are all wired up', () => {
  const declared = declaredProps(CANVAS);

  it('the canvas declares a substantial prop list, so this test has teeth', () => {
    expect(declared.length).toBeGreaterThan(20);
  });

  it('every declared prop is passed by SchematicEditor', () => {
    // `<SchematicCanvas … name={…} />` — the JSX attribute is what we look for.
    const missing = declared.filter((p) => !new RegExp(`\\b${p}=\\{`).test(EDITOR));
    expect(missing, `declared on the canvas but never passed: ${missing.join(', ')}`).toEqual([]);
  });

  it('and the ones it destructures are all declared', () => {
    // The mirror image: reading a prop the interface never promised.
    const used = usedProps(CANVAS);
    const undeclared = [...used].filter((p) => !declared.includes(p));
    expect(undeclared, `destructured but not declared: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('pendingDirective in particular, since that is the one that broke', () => {
    expect(declared).toContain('pendingDirective');
    expect(EDITOR).toMatch(/pendingDirective=\{/);
  });
});

/**
 * The GL layer sits *above* the 2D one, so a buffer left on it keeps showing
 * through. The paint function clears it before every 2D path — and it has to
 * do that through the context, not through the `gl` local.
 *
 * The local used to be `doc.images.length === 0 ? glRef.current : null`,
 * deliberately null whenever that render might not use GL. So the clear was a
 * no-op in exactly the case that needed it: attaching an image to the cursor
 * flipped the backend off mid-session and froze the sheet's last GL frame on
 * top of the live one — two sheets on screen, one of them stuck.
 *
 * That gate is gone: images go on the GPU now, so a document holding one is no
 * longer a reason to fall off the layer, and the local is plain
 * `glRef.current`. The assertion that pinned the gate went with it. This one
 * stays, because the rule it protects outlives the reason: whatever the local
 * comes to hold, the clear reaches the context.
 */
describe('the GL layer is cleared through the context, not a local', () => {
  it('clears via glRef, never via the local', () => {
    expect(CANVAS).toContain('glRef.current?.clear()');
    // Matched as a statement so the prose above it in the source does not count.
    expect(CANVAS.includes('\n    gl?.clear();')).toBe(false);
  });
});

/**
 * The ERC run has to keep yielding to the browser.
 *
 * `runErcSteps` is a generator so the frame can repaint between phases, and the
 * loop awaits a task yield each time. That yield was guarded on "is this phase
 * name new", and every sheet emits the *same* phase names — so from the second
 * sheet onwards nothing was new, the loop never yielded again, and sheets 2..N
 * ran in one unbroken synchronous block. The tab stopped repainting, the
 * progress panel froze on its first line, and Cancel could not be reached: a
 * 30-90 s freeze on a three-sheet demo (#446).
 *
 * The message list may still be deduplicated. The yield may not.
 */
describe('the ERC progress loop yields on every step', () => {
  it('awaits the frame outside the new-message branch', () => {
    const at = CANVAS_EDITOR.indexOf('const steps = runErcSteps');
    expect(at, 'the ERC run should still be here').toBeGreaterThan(-1);
    const loop = CANVAS_EDITOR.slice(at, at + 2500);
    const guard = loop.indexOf('if (!messages.includes(line))');
    const yieldAt = loop.indexOf('await frame();', guard);
    const branchEnd = loop.indexOf('}', loop.indexOf('setErcRunning([...messages]);', guard));
    expect(guard, 'the dedupe guard should still be here').toBeGreaterThan(-1);
    expect(yieldAt, 'the yield should still be here').toBeGreaterThan(-1);
    // The yield must sit *after* the guarded block closes, not inside it.
    expect(yieldAt).toBeGreaterThan(branchEnd);
  });
});
