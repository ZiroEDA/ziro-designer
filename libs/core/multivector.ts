// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/core/include/core/multivector.h`: `MULTIVECTOR<T, FIRST_TYPE_VAL, LAST_TYPE_VAL>`,
 * a set of vectors, one per item type in [FIRST, LAST], iterated bucket by bucket in type
 * order. `LIB_SYMBOL` keeps its draw items in one (`LIB_ITEMS_CONTAINER`), and that
 * iteration order is the order its library file is written in.
 *
 * Iterators become the array API: `begin/end/erase(iterator)` are `items(aType)` and
 * `erase(aItem)`; `sort` takes the `operator<` of the element type, as `ptr_vector::sort`
 * uses it.
 */

/** `MULTIVECTOR::UNDEFINED_TYPE`. */
export const UNDEFINED_TYPE = 0;

export class MULTIVECTOR<T extends { Type(): number }> {
  readonly FIRST_TYPE: number;
  readonly LAST_TYPE: number;
  readonly TYPES_COUNT: number;

  private m_data: T[][];

  constructor(aFirstType: number, aLastType: number) {
    // static_assert( FIRST_TYPE_VAL > UNDEFINED_TYPE ) / ( FIRST_TYPE_VAL < LAST_TYPE_VAL )
    this.FIRST_TYPE = aFirstType;
    this.LAST_TYPE = aLastType;
    this.TYPES_COUNT = aLastType - aFirstType + 1;
    this.m_data = Array.from({ length: this.TYPES_COUNT }, () => []);
  }

  push_back(aItem: T): void {
    this.bucket(aItem.Type()).push(aItem);
  }

  /** `erase( iterator )`: remove \a aItem from its type's vector. */
  erase(aItem: T): boolean {
    const vec = this.bucket(aItem.Type());
    const idx = vec.indexOf(aItem);

    if (idx < 0) return false;

    vec.splice(idx, 1);
    return true;
  }

  /** Iterate one type (`begin( aType )..end( aType )`), or all of them in type order. */
  *items(aType: number = UNDEFINED_TYPE): IterableIterator<T> {
    if (aType !== UNDEFINED_TYPE) {
      yield* [...this.bucket(aType)];
      return;
    }

    for (const vec of this.m_data) yield* [...vec];
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.items();
  }

  clear(aType: number = UNDEFINED_TYPE): void {
    if (aType !== UNDEFINED_TYPE) {
      this.bucket(aType).length = 0;
    } else {
      for (let i = 0; i < this.TYPES_COUNT; ++i) this.m_data[i]!.length = 0;
    }
  }

  size(aType: number = UNDEFINED_TYPE): number {
    if (aType !== UNDEFINED_TYPE) return this.bucket(aType).length;

    let cnt = 0;

    for (let i = 0; i < this.TYPES_COUNT; ++i) cnt += this.m_data[i]!.length;

    return cnt;
  }

  empty(aType: number = UNDEFINED_TYPE): boolean {
    return this.size(aType) === 0;
  }

  /** `sort()`: each vector by the elements' `operator<`. */
  sort(aLess: (a: T, b: T) => boolean): void {
    for (let i = 0; i < this.TYPES_COUNT; ++i)
      this.m_data[i]!.sort((a, b) => (aLess(a, b) ? -1 : aLess(b, a) ? 1 : 0));
  }

  /** `unique()`: drop consecutive equal elements of each vector. */
  unique(aEquals: (a: T, b: T) => boolean): void {
    for (let i = 0; i < this.TYPES_COUNT; ++i) {
      const vec = this.m_data[i]!;

      if (vec.length > 1) {
        const out: T[] = [vec[0]!];

        for (let j = 1; j < vec.length; j++) if (!aEquals(out.at(-1)!, vec[j]!)) out.push(vec[j]!);

        this.m_data[i] = out;
      }
    }
  }

  /** `operator[]( int aType )`: the vector of one type, which callers may edit. */
  bucket(aType: number): T[] {
    if (aType < this.FIRST_TYPE || aType > this.LAST_TYPE) {
      // wxFAIL_MSG( "Attempted access to type not within MULTIVECTOR" )
      aType = this.FIRST_TYPE;
    }

    return this.m_data[aType - this.FIRST_TYPE]!;
  }
}
