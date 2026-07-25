/**
 * VECTOR2I, the integer 2D vector KiCad uses for board coordinates
 * (libs/kimath/include/math/vector2.h). KiCad's VECTOR2<T> is a rich template;
 * this port provides the mutable {x,y} struct plus the operations the pcbnew
 * classes actually call. Coordinates are internal units (nanometres in KiCad;
 * see units.ts for our IU).
 */

/** 2D point/vector in integer internal units (100 nm). Immutable variant. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface VECTOR2I {
  x: number;
  y: number;
}

export const VECTOR2I = (x = 0, y = 0): VECTOR2I => ({ x, y });

export const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
export const equal = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** Euclidean length (KiCad VECTOR2::EuclideanNorm). */
export const EuclideanNorm = (v: VECTOR2I): number => Math.hypot(v.x, v.y);
/** Squared length (KiCad VECTOR2::SquaredEuclideanNorm). */
export const SquaredEuclideanNorm = (v: VECTOR2I): number => v.x * v.x + v.y * v.y;
/** Distance between two points (KiCad VECTOR2::Distance). */
export const Distance = (a: VECTOR2I, b: VECTOR2I): number => Math.hypot(a.x - b.x, a.y - b.y);
