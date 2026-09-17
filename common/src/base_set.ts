// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/base_set.h`: `BASE_SET`, a growable bitset (`sul::dynamic_bitset`
 * underneath) that `LSET` and the other layer sets derive from. The bits are
 * a block vector of 32-bit words, as the dynamic_bitset's; the size is what
 * the C++ `size()` is, and a `set`/`reset`/`flip` past it grows the set as
 * the C++ does.
 *
 * The C++ operators are methods: `~` is `not()`, `&=`/`|=`/`^=` are
 * `andAssign`/`orAssign`/`xorAssign`, and the free `&`/`|`/`^` are
 * `and`/`or`/`xor`. `set_bits_begin()..end()` is `setBits()`, the reverse one
 * `setBitsReverse()`, and `bits()` yields one bool per bit, as
 * `begin()..end()` does.
 */

export class BASE_SET {
  /** `sul::dynamic_bitset`'s block vector: 32-bit words, low word first; bits past `m_size` are zero. */
  protected m_words: number[];
  protected m_size: number;

  constructor(size?: number);
  constructor(aOther: BASE_SET);
  constructor(a: number | BASE_SET = 64) {
    if (a instanceof BASE_SET) {
      this.m_words = a.m_words.slice();
      this.m_size = a.m_size;
    } else {
      this.m_size = a;
      this.m_words = new Array<number>((a + 31) >>> 5).fill(0);
    }
  }

  /** `sul::dynamic_bitset::size`. */
  size(): number {
    return this.m_size;
  }

  /** The bits past `m_size` in the last word are kept zero. */
  private sanitize(): void {
    const rem = this.m_size & 31;
    const last = this.m_words.length - 1;

    if (rem !== 0 && last >= 0) this.m_words[last] = (this.m_words[last]! & ((1 << rem) - 1)) >>> 0;
  }

  /** `sul::dynamic_bitset::resize`: grow keeps the bits; shrink drops the high ones. */
  resize(aSize: number): void {
    const words = (aSize + 31) >>> 5;

    if (words > this.m_words.length) {
      while (this.m_words.length < words) this.m_words.push(0);
    } else if (words < this.m_words.length) {
      this.m_words.length = words;
    }

    this.m_size = aSize;
    this.sanitize();
  }

  /** `sul::dynamic_bitset::test`. */
  test(pos: number): boolean {
    if (pos < 0 || pos >= this.m_size) throw new RangeError('out_of_range');

    return ((this.m_words[pos >>> 5]! >>> (pos & 31)) & 1) === 1;
  }

  /** `operator[]`: the bit, without the range check `test` makes. */
  at(pos: number): boolean {
    const w = this.m_words[pos >>> 5];

    return w !== undefined && ((w >>> (pos & 31)) & 1) === 1;
  }

  set(): this;
  set(pos: number, value?: boolean): this;
  set(pos?: number, value = true): this {
    if (pos === undefined) {
      this.m_words.fill(0xffffffff);
      this.sanitize();
      return this;
    }

    if (pos >= this.m_size) this.resize(pos + 1);

    const i = pos >>> 5;

    if (value) this.m_words[i] = (this.m_words[i]! | (1 << (pos & 31))) >>> 0;
    else this.m_words[i] = (this.m_words[i]! & ~(1 << (pos & 31))) >>> 0;

    return this;
  }

  reset(): this;
  reset(pos: number): this;
  reset(pos?: number): this {
    if (pos === undefined) {
      this.m_words.fill(0);
      return this;
    }

    if (pos >= this.m_size) this.resize(pos + 1);

    const i = pos >>> 5;
    this.m_words[i] = (this.m_words[i]! & ~(1 << (pos & 31))) >>> 0;
    return this;
  }

  flip(): this;
  flip(pos: number): this;
  flip(pos?: number): this {
    if (pos === undefined) {
      for (let i = 0; i < this.m_words.length; ++i) this.m_words[i] = ~this.m_words[i]! >>> 0;
      this.sanitize();
      return this;
    }

    if (pos >= this.m_size) this.resize(pos + 1);

    const i = pos >>> 5;
    this.m_words[i] = (this.m_words[i]! ^ (1 << (pos & 31))) >>> 0;
    return this;
  }

  /** `sul::dynamic_bitset::any`. */
  any(): boolean {
    for (let i = 0; i < this.m_words.length; ++i) if (this.m_words[i] !== 0) return true;

    return false;
  }

  /** `sul::dynamic_bitset::none`. */
  none(): boolean {
    return !this.any();
  }

  /** `sul::dynamic_bitset::all`. */
  all(): boolean {
    const full = this.m_size >>> 5;

    for (let i = 0; i < full; ++i) if (this.m_words[i] !== 0xffffffff) return false;

    const rem = this.m_size & 31;

    if (rem !== 0) return this.m_words[full] === ((1 << rem) - 1) >>> 0;

    return true;
  }

  /** `sul::dynamic_bitset::count`: the number of set bits. */
  count(): number {
    let n = 0;

    for (let i = 0; i < this.m_words.length; ++i) {
      let w = this.m_words[i]!;

      while (w !== 0) {
        w = (w & (w - 1)) >>> 0;
        ++n;
      }
    }

    return n;
  }

  /** `sul::dynamic_bitset::is_subset_of`: every set bit here is set in `other`. */
  is_subset_of(other: BASE_SET): boolean {
    for (let i = 0; i < this.m_words.length; ++i) {
      const o = i < other.m_words.length ? other.m_words[i]! : 0;

      if ((this.m_words[i]! & ~o) !== 0) return false;
    }

    return true;
  }

  /** `sul::dynamic_bitset::operator==`. */
  equals(other: BASE_SET): boolean {
    if (this.m_size !== other.m_size) return false;

    for (let i = 0; i < this.m_words.length; ++i)
      if (this.m_words[i] !== other.m_words[i]) return false;

    return true;
  }

  /** `operator~`. */
  not(): this {
    const result = this.cloneSet();
    result.flip();
    return result;
  }

  /** `operator&=`. */
  andAssign(other: BASE_SET): this {
    const my_size = this.size();
    const other_size = other.size();

    if (my_size < other_size) this.resize(other_size);

    for (let i = 0; i < this.m_words.length; ++i) {
      const o = i < other.m_words.length ? other.m_words[i]! : 0;
      this.m_words[i] = (this.m_words[i]! & o) >>> 0;
    }

    return this;
  }

  /** `operator|=`. */
  orAssign(other: BASE_SET): this {
    const my_size = this.size();
    const other_size = other.size();

    if (my_size < other_size) this.resize(other_size);

    for (let i = 0; i < other.m_words.length; ++i)
      this.m_words[i] = (this.m_words[i]! | other.m_words[i]!) >>> 0;

    return this;
  }

  /** `operator^=`. */
  xorAssign(other: BASE_SET): this {
    const my_size = this.size();
    const other_size = other.size();

    if (my_size < other_size) this.resize(other_size);

    for (let i = 0; i < other.m_words.length; ++i)
      this.m_words[i] = (this.m_words[i]! ^ other.m_words[i]!) >>> 0;

    return this;
  }

  /** `operator&( lhs, rhs )`. */
  and(rhs: BASE_SET): this {
    return this.cloneSet().andAssign(rhs);
  }

  /** `operator|( lhs, rhs )`. */
  or(rhs: BASE_SET): this {
    return this.cloneSet().orAssign(rhs);
  }

  /** `operator^( lhs, rhs )`. */
  xor(rhs: BASE_SET): this {
    return this.cloneSet().xorAssign(rhs);
  }

  /** The copy constructor of whatever subclass this is. */
  protected cloneSet(): this {
    const ctor = this.constructor as new (aOther: BASE_SET) => this;
    return new ctor(this);
  }

  /** `alg::lexicographical_compare_three_way` over the bits, low bit first. */
  compare(other: BASE_SET): number {
    const n = Math.min(this.m_size, other.m_size);

    for (let i = 0; i < n; ++i) {
      const a = this.at(i);
      const b = other.at(i);

      if (a !== b) return a ? 1 : -1;
    }

    if (this.m_size === other.m_size) return 0;

    return this.m_size < other.m_size ? -1 : 1;
  }

  /** `operator<`. */
  lt(other: BASE_SET): boolean {
    return this.compare(other) < 0;
  }

  /** One bool per bit, as `begin()..end()`. (`LSET` iterates its set layers instead.) */
  *bits(): IterableIterator<boolean> {
    for (let i = 0; i < this.m_size; ++i) yield this.at(i);
  }

  /** `set_bits_begin()..set_bits_end()`: the indices of the set bits, ascending. */
  *setBits(): IterableIterator<number> {
    for (let i = 0; i < this.m_size; ++i) if (this.at(i)) yield i;
  }

  /** `set_bits_rbegin()..set_bits_rend()`: the indices of the set bits, descending. */
  *setBitsReverse(): IterableIterator<number> {
    for (let i = this.m_size - 1; i >= 0; --i) if (this.at(i)) yield i;
  }

  /**
   * Return a binary string showing contents of this set.
   */
  FmtBin(): string {
    let ret = '';
    const bit_count = this.size();

    for (let bit = 0; bit < bit_count; ++bit) {
      if (bit) {
        if (!(bit % 8)) ret += '|';
        else if (!(bit % 4)) ret += '_';
      }

      ret += this.at(bit) ? '1' : '0';
    }

    return [...ret].reverse().join('');
  }

  /**
   * Return a hex string showing contents of this set.
   */
  FmtHex(): string {
    let ret = '';
    const hex = '0123456789abcdef';

    const nibble_count = Math.trunc((this.size() + 3) / 4);

    for (let nibble = 0; nibble < nibble_count; ++nibble) {
      let ndx = 0;

      for (let nibble_bit = 0; nibble_bit < 4; ++nibble_bit) {
        const nibble_pos = nibble_bit + nibble * 4;

        if (nibble_pos >= this.size()) break;

        if (this.at(nibble_pos)) ndx |= 1 << nibble_bit;
      }

      if (nibble && !(nibble % 8)) ret += '_';

      ret += hex[ndx]!;
    }

    return [...ret].reverse().join('');
  }

  /**
   * Convert the output of FmtHex() and replaces this set's values
   * with those given in the input string.
   *
   * Parsing stops at the first non hex ASCII byte, except that marker bytes output from
   * FmtHex() are not terminators.
   *
   * @return the number of bytes consumed.
   */
  ParseHex(str: string): number;
  ParseHex(aStart: string, aCount: number): number;
  ParseHex(aStart: string, aCount: number = aStart.length): number {
    const tmp = new BASE_SET(this.size());

    let rstart = aCount - 1;
    const rend = -1;
    const bitcount = this.size();

    let nibble_ndx = 0;

    while (rstart > rend) {
      const cc = aStart.charCodeAt(rstart--);

      if (cc === 0x5f /* '_' */) continue;

      let nibble: number;

      if (cc >= 0x30 && cc <= 0x39) nibble = cc - 0x30;
      else if (cc >= 0x61 && cc <= 0x66) nibble = cc - 0x61 + 10;
      else if (cc >= 0x41 && cc <= 0x46) nibble = cc - 0x41 + 10;
      else break;

      let bit = nibble_ndx * 4;

      for (let ndx = 0; bit < bitcount && ndx < 4; ++bit, ++ndx)
        if (nibble & (1 << ndx)) tmp.set(bit);

      if (bit >= bitcount) break;

      ++nibble_ndx;
    }

    const byte_count = aCount - 1 - rstart;

    if (byte_count > 0) {
      this.m_words = tmp.m_words;
      this.m_size = tmp.m_size;
    }

    return byte_count;
  }
}
