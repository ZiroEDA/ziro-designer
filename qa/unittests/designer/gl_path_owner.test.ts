/**
 * Every subpath the GL path builder makes must carry its owner.
 *
 * `Scene.itemRanges` is keyed on that owner, and `PcbGl.moveItems` — the
 * in-place drag, KiCad's `VIEW::Update` against our buffer — can only translate
 * vertices it can find there. A subpath that reaches the buffer untagged is
 * invisible to the drag: it stays at the old position for the whole gesture and
 * only snaps into place on the drop, when the committed board is re-recorded.
 *
 * That shipped. A dragged footprint left its courtyard box behind, and only its
 * courtyard, because the courtyard is the one part of a footprint drawn as an
 * `fp_rect` — and `rect()` built its subpath directly instead of through
 * `startNew`, which is the method that tags the owner.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY, GlPath, setPathOwner } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';
import { Scene, SEGMENT_STRIDE } from '@ziroeda/designer/src/render/gl/scene.js';

const MM = 1e6;

describe('GlPath subpath ownership', () => {
  // Not a loop over the two methods: each is a separate `subpaths.push` with
  // its own literal, and a loop would let one regress while the other carried
  // the test.
  it('rect() tags the open owner', () => {
    setPathOwner('footprint:7');
    const p = new GlPath();
    p.rect(0, 0, 10, 10);
    setPathOwner(undefined);
    expect(p.subpaths.length).toBeGreaterThan(0);
    expect(p.subpaths.map((s) => s.owner)).toEqual(p.subpaths.map(() => 'footprint:7'));
  });

  it('roundRect() tags the open owner', () => {
    setPathOwner('footprint:7');
    const p = new GlPath();
    p.roundRect(0, 0, 10, 10, 2);
    setPathOwner(undefined);
    expect(p.subpaths.length).toBeGreaterThan(0);
    expect(p.subpaths.map((s) => s.owner)).toEqual(p.subpaths.map(() => 'footprint:7'));
  });

  it('leaves a subpath built with no owner open untagged', () => {
    // The tag is the *current* owner, not a constant: board-level graphics are
    // built with none and must stay unowned, or they would be dragged along
    // with whichever footprint was recorded before them.
    setPathOwner(undefined);
    const p = new GlPath();
    p.rect(0, 0, 10, 10);
    expect(p.subpaths.every((s) => s.owner === undefined)).toBe(true);
  });
});

describe('board graphics are owned by themselves, not by the last via', () => {
  // Tagging `rect` exposed this: the board-shape loop ran with whatever owner
  // the via loop left open, so a board graphic was attributed to the last via
  // and would have translated with it. Rectangles hid it by being untagged.
  const scene = (): Scene => {
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
        (net 0 "")
        (via (at 50 50) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))
        (gr_rect (start 10 10) (end 20 20) (stroke (width 0.1) (type solid)) (fill no) (layer "Edge.Cuts"))
        (gr_line (start 30 30) (end 40 40) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts")))`),
    );
    const sc = new Scene();
    recordBoardScene(
      sc,
      {
        scene: buildScene(board, {}, GL_PATH_FACTORY),
        visible: new Set(['F.Cu', 'B.Cu', 'Edge.Cuts']),
      } as never,
      20 / MM,
      false,
    );
    return sc;
  };

  it('gives each board shape its own range', () => {
    const sc = scene();
    expect(sc.itemRanges.has('shape:0')).toBe(true);
    expect(sc.itemRanges.has('shape:1')).toBe(true);
  });

  it('does not drag board graphics along with the via', () => {
    const sc = scene();
    const snap = (): number[] =>
      Array.from(sc.segments.view().slice(0, sc.segmentCount * SEGMENT_STRIDE));
    const before = snap();
    sc.translateItem('via:0', 500 * MM, 0);
    const after = snap();
    // The rect and the line both live out at x = 10..40 mm; the via is at 50.
    let boardMoved = 0;
    for (let i = 0; i < sc.segmentCount; i++) {
      const o = i * SEGMENT_STRIDE;
      if (before[o]! < 45 * MM && after[o] !== before[o]) boardMoved++;
    }
    expect(boardMoved).toBe(0);
  });
});

describe('a dragged footprint takes its courtyard with it', () => {
  /**
   * The courtyard is a real `fp_rect`, copied from the LED_D5.0mm the capture
   * caught this on (`/usr/share/kicad/footprints/LED_THT.pretty`): an fp_line
   * courtyard goes through `startNew` and would pass however `rect` behaved.
   */
  const fp = (ref: string, x: number): string => `
   (footprint "LED" (layer "F.Cu") (at ${x} 100)
    (fp_rect (start -1.94 -3.21) (end 4.49 3.21) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))
    (fp_line (start -2 -2) (end 2 -2) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
    (fp_text reference "${ref}" (at 0 -4) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at -1.25 0) (size 2 2) (drill 1) (layers "*.Cu")))`;

  /** Three of them, so a range covering the whole buffer cannot pass for one. */
  const record = (): Scene => {
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
        (net 0 "")${fp('A', 100)}${fp('B', 130)}${fp('C', 160)})`),
    );
    const scene = new Scene();
    recordBoardScene(
      scene,
      {
        scene: buildScene(board, {}, GL_PATH_FACTORY),
        visible: new Set(['F.Cu', 'B.Cu', 'F.CrtYd', 'F.SilkS']),
      } as never,
      20 / MM,
      false,
    );
    return scene;
  };

  /** Segments bucketed by the footprint whose x-band they started in. */
  const translateAndTally = (): Record<string, number> => {
    const scene = record();
    const snap = (): number[] =>
      Array.from(scene.segments.view().slice(0, scene.segmentCount * SEGMENT_STRIDE));
    const before = snap();
    scene.translateItem('footprint:1', 500 * MM, 0);
    const after = snap();
    const band = (x: number): number => (x < 115 * MM ? 0 : x < 145 * MM ? 1 : 2);
    const tally: Record<string, number> = {};
    for (let i = 0; i < scene.segmentCount; i++) {
      const o = i * SEGMENT_STRIDE;
      const k = `fp${band(before[o]!)}_${after[o] !== before[o] ? 'moved' : 'stayed'}`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    return tally;
  };

  it('translates every segment of the dragged footprint and only those', () => {
    const t = translateAndTally();
    // The four that used to stay were exactly the courtyard rectangle's corners.
    expect(t.fp1_stayed ?? 0).toBe(0);
    expect(t.fp1_moved ?? 0).toBeGreaterThan(0);
    expect(t.fp0_moved ?? 0).toBe(0);
    expect(t.fp2_moved ?? 0).toBe(0);
    // And the neighbours really were in the buffer to be got wrong.
    expect(t.fp0_stayed ?? 0).toBeGreaterThan(0);
    expect(t.fp2_stayed ?? 0).toBeGreaterThan(0);
  });

  it('leaves no segment in the buffer unattributed', () => {
    // The invariant, and the one that cannot be satisfied by coincidence: this
    // fixture is nothing but footprints, so every segment in the buffer has to
    // belong to one of them. The untagged build left the four sides of each
    // courtyard rect owned by nobody -- twelve orphans across the three -- and
    // an orphan is exactly what `moveItems` cannot find.
    const scene = record();
    const owned = new Set<number>();
    for (const [, r] of scene.itemRanges)
      for (const [first, count] of r.seg) for (let i = 0; i < count; i++) owned.add(first + i);
    const orphans: number[] = [];
    for (let i = 0; i < scene.segmentCount; i++) if (!owned.has(i)) orphans.push(i);
    expect(orphans).toEqual([]);
  });

  it('counts the courtyard rect into its footprint range', () => {
    const scene = record();
    const total = (r?: { seg: readonly (readonly [number, number])[] }): number =>
      (r?.seg ?? []).reduce((n, [, c]) => n + c, 0);
    // Derived, not read off the new output: the untagged build attributed 113
    // segments to this footprint, and a rectangle stroke is 4 more -- one per
    // side. 113 + 4 = 117.
    expect(total(scene.itemRanges.get('footprint:1'))).toBe(117);
  });
});
