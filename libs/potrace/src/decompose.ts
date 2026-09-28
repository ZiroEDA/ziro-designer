// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/src/decompose.cpp`: decompose a bitmap into closed
 * boundary paths, then order them into a tree (`pathlist_to_tree`) so that
 * every positive path is followed by its negative children. KiCad's
 * `createOutputData` depends on that order: it closes a group of outline and
 * holes whenever the next path's sign is `'+'`.
 *
 * Scan order is potrace's: rows from `h - 1` down to 0, left to right. KiCad
 * fills row `y` of the image into row `y` of the bitmap, so potrace's "top" is
 * the image's last row.
 */
import { BM_WORDBITS, BM_GET, bm_clear, bm_dup, bm_free, BM_UINV } from '../include/bitmap.js';
import { idiv, type point_t } from '../include/auxiliary.js';
import {
  hookGet,
  hookOf,
  hookSet,
  list_append,
  list_insert_beforehook,
  type HOOK,
} from '../include/lists.js';
import { path_new, type path_t } from './curve.js';
import {
  POTRACE_TURNPOLICY_BLACK,
  POTRACE_TURNPOLICY_MAJORITY,
  POTRACE_TURNPOLICY_MINORITY,
  POTRACE_TURNPOLICY_RANDOM,
  POTRACE_TURNPOLICY_RIGHT,
  POTRACE_TURNPOLICY_WHITE,
  type potrace_bitmap_t,
  type potrace_param_t,
} from './potracelib.js';

const INT_MAX = 2147483647;

/**
 * "non-linear sequence: constant term of inverse in GF(8), mod
 * x^8+x^4+x^3+x+1" — `detrand`'s table. [data]
 */
// biome-ignore format: the C's table, 32 to a row
const DETRAND_T: readonly number[] = [
  0,
  1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1,
  1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0,
  1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1,
  0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0,
  1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0,
  1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1,
  0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1,
  0, 1, 0, 1, 0, 1, 0,
];

/**
 * `detrand( x, y )`: deterministically and efficiently hash (x,y) into a
 * pseudo-random bit. `unsigned int` arithmetic, so 32-bit wrapping products.
 */
function detrand(x: number, y: number): number {
  let z = Math.imul(Math.imul(0x04b3e375, x) ^ y, 0x05a8ef93) >>> 0;

  z =
    DETRAND_T[z & 0xff]! ^
    DETRAND_T[(z >>> 8) & 0xff]! ^
    DETRAND_T[(z >>> 16) & 0xff]! ^
    DETRAND_T[(z >>> 24) & 0xff]!;
  return z;
}

/** `bbox_t`. */
interface bbox_t {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * `clear_bm_with_bbox( bm, bbox )`: clear rows `y0 .. y1-1` over the words
 * spanning `x0 .. x1`, i.e. the pixels `[imin * 64, imax * 64)` clipped to the
 * bitmap.
 */
function clear_bm_with_bbox(bm: potrace_bitmap_t, bbox: bbox_t): void {
  const imin = idiv(bbox.x0, BM_WORDBITS);
  const imax = idiv(bbox.x1 + BM_WORDBITS - 1, BM_WORDBITS);
  const xEnd = Math.min(bm.w, imax * BM_WORDBITS);

  for (let y = bbox.y0; y < bbox.y1; y++) {
    for (let x = imin * BM_WORDBITS; x < xEnd; x++) bm.map[y * bm.dy + x] = 0;
  }
}

/**
 * `majority( bm, x, y )`: the "majority" value of bitmap bm at intersection
 * (x,y). We assume that the bitmap is balanced at "radius" 1.
 */
function majority(bm: potrace_bitmap_t, x: number, y: number): number {
  for (let i = 2; i < 5; i++) {
    // check at "radius" i
    let ct = 0;

    for (let a = -i + 1; a <= i - 1; a++) {
      ct += BM_GET(bm, x + a, y + i - 1) ? 1 : -1;
      ct += BM_GET(bm, x + i - 1, y + a - 1) ? 1 : -1;
      ct += BM_GET(bm, x + a - 1, y - i) ? 1 : -1;
      ct += BM_GET(bm, x - i, y + a) ? 1 : -1;
    }

    if (ct > 0) return 1;
    else if (ct < 0) return 0;
  }

  return 0;
}

/**
 * `xor_to_ref( bm, x, y, xa )`: invert bits [x,infty) and [xa,infty) in line
 * y, i.e. the pixels between x and xa. xa must be a multiple of BM_WORDBITS.
 */
function xor_to_ref(bm: potrace_bitmap_t, x: number, y: number, xa: number): void {
  const lo = Math.min(x, xa);
  const hi = Math.min(Math.max(x, xa), bm.w);

  for (let i = lo; i < hi; i++) BM_UINV(bm, i, y);
}

/**
 * `xor_path( bm, p )`: xor the given pixmap with the interior of the given
 * path. The path must be within the dimensions of the pixmap.
 */
function xor_path(bm: potrace_bitmap_t, p: path_t): void {
  if (p.priv.len <= 0) return; // a path of length 0 is silly, but legal

  let y1 = p.priv.pt[p.priv.len - 1]!.y;
  const xa = p.priv.pt[0]!.x & -BM_WORDBITS;

  for (let k = 0; k < p.priv.len; k++) {
    const x = p.priv.pt[k]!.x;
    const y = p.priv.pt[k]!.y;

    if (y !== y1) {
      // efficiently invert the rectangle [x,xa] x [y,y1]
      xor_to_ref(bm, x, Math.min(y, y1), xa);
      y1 = y;
    }
  }
}

/** `setbbox_path( bbox, p )`: the bounding box of a non-empty path. */
function setbbox_path(bbox: bbox_t, p: path_t): void {
  bbox.y0 = INT_MAX;
  bbox.y1 = 0;
  bbox.x0 = INT_MAX;
  bbox.x1 = 0;

  for (let k = 0; k < p.priv.len; k++) {
    const x = p.priv.pt[k]!.x;
    const y = p.priv.pt[k]!.y;

    if (x < bbox.x0) bbox.x0 = x;
    if (x > bbox.x1) bbox.x1 = x;
    if (y < bbox.y0) bbox.y0 = y;
    if (y > bbox.y1) bbox.y1 = y;
  }
}

/**
 * `findpath( bm, x0, y0, sign, turnpolicy )`: compute a path in the given
 * pixmap, separating black from white, starting at the upper left corner
 * (x0,y0). Also compute the area enclosed by the path. Sign is required for
 * correct interpretation of turnpolicies.
 */
function findpath(
  bm: potrace_bitmap_t,
  x0: number,
  y0: number,
  sign: string,
  turnpolicy: number,
): path_t {
  let x = x0;
  let y = y0;
  let dirx = 0;
  let diry = -1;
  const pt: point_t[] = [];
  /* `uint64_t area += uint64_t( x ) * uint64_t( diry )`, modular 64-bit. The
   * running sum is kept exact as a signed double (it is bounded by the bitmap's
   * area, far inside 2^53), and reduced the way the C's modular value would
   * compare against INT_MAX at the end: a negative sum wraps to a huge one. */
  let area = 0;

  while (true) {
    // add point to path
    pt.push({ x, y });

    // move to next point
    x += dirx;
    y += diry;
    area += x * diry;

    // path complete?
    if (x === x0 && y === y0) break;

    // determine next direction
    const c = BM_GET(bm, x + idiv(dirx + diry - 1, 2), y + idiv(diry - dirx - 1, 2));
    const d = BM_GET(bm, x + idiv(dirx - diry - 1, 2), y + idiv(diry + dirx - 1, 2));

    if (c && !d) {
      // ambiguous turn
      if (
        turnpolicy === POTRACE_TURNPOLICY_RIGHT ||
        (turnpolicy === POTRACE_TURNPOLICY_BLACK && sign === '+') ||
        (turnpolicy === POTRACE_TURNPOLICY_WHITE && sign === '-') ||
        (turnpolicy === POTRACE_TURNPOLICY_RANDOM && detrand(x, y)) ||
        (turnpolicy === POTRACE_TURNPOLICY_MAJORITY && majority(bm, x, y)) ||
        (turnpolicy === POTRACE_TURNPOLICY_MINORITY && !majority(bm, x, y))
      ) {
        const tmp = dirx; // right turn
        dirx = diry;
        diry = -tmp;
      } else {
        const tmp = dirx; // left turn
        dirx = -diry;
        diry = tmp;
      }
    } else if (c) {
      // right turn
      const tmp = dirx;
      dirx = diry;
      diry = -tmp;
    } else if (!d) {
      // left turn
      const tmp = dirx;
      dirx = -diry;
      diry = tmp;
    }
  }

  // allocate new path object
  const p = path_new();
  p.priv.pt = pt;
  p.priv.len = pt.length;
  p.area = area >= 0 && area <= INT_MAX ? area : INT_MAX; // avoid overflow
  p.sign = sign;
  return p;
}

/**
 * `pathlist_to_tree( plist, bm )`: give a tree structure to the given path
 * list, based on "insideness" testing, and relink the list so negative path
 * components follow their positive parent. The bm argument is scratch space.
 *
 * The C passes `plist` by value and relinks through it: the caller's head
 * pointer still names the first path, which stays first.
 */
function pathlist_to_tree(plist: path_t | null, bm: potrace_bitmap_t): void {
  bm_clear(bm, 0);

  // save original "next" pointers
  for (let p = plist; p !== null; p = p.next) {
    p.sibling = p.next;
    p.childlist = null;
  }

  let heap: path_t | null = plist;

  /* the heap holds a list of lists of paths. Use "childlist" field for outer
   * list, "next" field for inner list. Each of the sublists is to be turned
   * into a tree. */
  while (heap) {
    // unlink first sublist
    let cur: path_t | null = heap;
    heap = heap.childlist;
    cur.childlist = null;

    // unlink first path
    const head: path_t = cur;
    cur = cur.next;
    head.next = null;

    // render path
    xor_path(bm, head);
    const bbox: bbox_t = { x0: 0, x1: 0, y0: 0, y1: 0 };
    setbbox_path(bbox, head);

    /* now do insideness test for each element of cur; append it to
     * head->childlist if it's inside head, else append it to head->next. */
    let hook_in: HOOK<path_t> = hookOf(head, 'childlist');
    let hook_out: HOOK<path_t> = hookOf(head, 'next');

    // list_forall_unlink( p, cur )
    for (let p = cur; p !== null; p = cur) {
      cur = p.next;
      p.next = null;

      if (p.priv.pt[0]!.y <= bbox.y0) {
        hook_out = list_insert_beforehook(p, hook_out);
        // append the remainder of the list to hook_out
        hookSet(hook_out, cur);
        break;
      }

      if (BM_GET(bm, p.priv.pt[0]!.x, p.priv.pt[0]!.y - 1))
        hook_in = list_insert_beforehook(p, hook_in);
      else hook_out = list_insert_beforehook(p, hook_out);
    }

    // clear bm
    clear_bm_with_bbox(bm, bbox);

    /* now schedule head->childlist and head->next for further processing.
     * (Both were written through the hooks, which the compiler cannot see.) */
    const headNext = head.next as path_t | null;
    const headChildlist = head.childlist as path_t | null;

    if (headNext) {
      headNext.childlist = heap;
      heap = headNext;
    }

    if (headChildlist) {
      headChildlist.childlist = heap;
      heap = headChildlist;
    }
  }

  // copy sibling structure from "next" to "sibling" component
  let p = plist;

  while (p) {
    const p1: path_t | null = p.sibling;
    p.sibling = p.next;
    p = p1;
  }

  /* reconstruct a new linked list ("next") structure from tree ("childlist",
   * "sibling") structure. The heap contains a list of childlists which still
   * need to be processed. */
  heap = plist;

  if (heap) heap.next = null; // heap is a linked list of childlists

  const head = { next: null as path_t | null };
  let plist_hook: HOOK<path_t> = hookOf(head, 'next');

  while (heap) {
    const heap1Box = { next: heap.next };

    for (let q: path_t | null = heap; q; q = q.sibling) {
      // q is a positive path; append to linked list
      plist_hook = list_insert_beforehook(q, plist_hook);

      // go through its children
      for (let p1 = q.childlist; p1; p1 = p1.sibling) {
        // append to linked list
        plist_hook = list_insert_beforehook(p1, plist_hook);

        // append its childlist to heap, if non-empty
        if (p1.childlist) list_append(hookOf<path_t>(heap1Box, 'next'), p1.childlist);
      }
    }

    heap = hookGet(hookOf<path_t>(heap1Box, 'next'));
  }
}

/**
 * `findnext( bm, xp, yp )`: find the next set pixel in a row <= y. Pixels are
 * searched first left-to-right, then top-down: (x,y) < (x',y') if y > y' or
 * y = y' and x < x'. The first row is searched from the start of the word
 * holding `*xp`.
 */
function findnext(bm: potrace_bitmap_t, at: { x: number; y: number }): boolean {
  let x0 = at.x & ~(BM_WORDBITS - 1);

  for (let y = at.y; y >= 0; y--) {
    for (let x = x0; x < bm.w && x >= 0; x++) {
      if (BM_GET(bm, x, y)) {
        // found
        at.x = x;
        at.y = y;
        return true;
      }
    }

    x0 = 0;
  }

  // not found
  return false;
}

/**
 * `bm_to_pathlist( bm, plistp, param, progress )`: decompose the given bitmap
 * into paths, with len, pt, area and sign filled in. Returns the list (null
 * when there is none), or `undefined` where the C returns -1.
 */
export function bm_to_pathlist(
  bm: potrace_bitmap_t,
  param: potrace_param_t,
): path_t | null | undefined {
  const head = { next: null as path_t | null };
  let plist_hook: HOOK<path_t> = hookOf(head, 'next'); // used to speed up appending

  const bm1 = bm_dup(bm);

  if (!bm1) return undefined;

  // iterate through components
  const at = { x: 0, y: bm1.h - 1 };

  while (findnext(bm1, at)) {
    // calculate the sign by looking at the original
    const sign = BM_GET(bm, at.x, at.y) ? '+' : '-';

    // calculate the path
    const p = findpath(bm1, at.x, at.y + 1, sign, param.turnpolicy);

    // update buffered image
    xor_path(bm1, p);

    // if it's a turd, eliminate it, else append it to the list
    if (p.area > param.turdsize) plist_hook = list_insert_beforehook(p, plist_hook);
  }

  pathlist_to_tree(head.next, bm1);
  bm_free(bm1);

  return head.next;
}
