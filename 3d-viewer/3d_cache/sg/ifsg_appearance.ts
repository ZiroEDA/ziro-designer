// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_appearance.cpp`: IFSG_APPEARANCE, a Material. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import { SGAPPEARANCE } from './sg_appearance.js';

export class IFSG_APPEARANCE extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SGAPPEARANCE(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SGAPPEARANCE {
    return this.m_node as SGAPPEARANCE;
  }

  SetEmissive(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.node().SetEmissive(aRVal, aGVal, aBVal);
  }

  SetDiffuse(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.node().SetDiffuse(aRVal, aGVal, aBVal);
  }

  SetSpecular(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.node().SetSpecular(aRVal, aGVal, aBVal);
  }

  SetAmbient(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.node().SetAmbient(aRVal, aGVal, aBVal);
  }

  /** Refused outside [0, 1]; stored as a C float. */
  SetShininess(aShininess: number): boolean {
    const v = Math.fround(aShininess);

    if (v < 0 || v > 1.0) return false;

    this.node().shininess = v;
    return true;
  }

  /** Refused outside [0, 1]; stored as a C float. */
  SetTransparency(aTransparency: number): boolean {
    const v = Math.fround(aTransparency);

    if (v < 0 || v > 1.0) return false;

    this.node().transparency = v;
    return true;
  }
}
