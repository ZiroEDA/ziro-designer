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
import { GlPath, setPathOwner } from '@ziroeda/designer/src/render/gl/gl_path.js';

const _MM = 1e6;

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
