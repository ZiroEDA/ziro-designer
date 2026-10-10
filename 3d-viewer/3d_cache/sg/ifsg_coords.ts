// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_coords.cpp`: IFSG_COORDS, a Coordinate node. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import type { SGPOINT } from './sg_base.js';
import { SGCOORDS } from './sg_coords.js';

export class IFSG_COORDS extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SGCOORDS(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SGCOORDS {
    return this.m_node as SGCOORDS;
  }

  SetCoordsList(aCoordsList: readonly SGPOINT[]): boolean {
    this.node().SetCoordsList(aCoordsList);
    return true;
  }

  AddCoord(aPoint: SGPOINT): boolean {
    this.node().AddCoord(aPoint);
    return true;
  }
}
