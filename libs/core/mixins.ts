// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Multiple inheritance, the TypeScript way: KiCad's `class PCB_GROUP :
 * public BOARD_ITEM, public EDA_GROUP` becomes `class PCB_GROUP extends
 * BOARD_ITEM` plus `applyMixins( PCB_GROUP, [ EDA_GROUP ] )`, which copies
 * the mixin's prototype methods onto the class. Fields of the mixin are
 * initialised by the derived constructor (the mixin's `init...` helper).
 */

// biome-ignore lint/suspicious/noExplicitAny: a constructor of any class
type AnyCtor = abstract new (...args: any[]) => object;

export function applyMixins(derivedCtor: AnyCtor, constructors: AnyCtor[]): void {
  for (const baseCtor of constructors) {
    for (const name of Object.getOwnPropertyNames(baseCtor.prototype)) {
      if (name === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(derivedCtor.prototype, name)) continue;
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ?? Object.create(null),
      );
    }
  }
}
