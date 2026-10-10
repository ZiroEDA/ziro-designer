// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_transform.cpp`: IFSG_TRANSFORM, a Transform node. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import { SGPOINT, type SGVECTOR } from './sg_base.js';
import { SCENEGRAPH } from './scenegraph.js';

export class IFSG_TRANSFORM extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SCENEGRAPH(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SCENEGRAPH {
    return this.m_node as SCENEGRAPH;
  }

  SetRotation(aRotationAxis: SGVECTOR, aAngle: number): boolean {
    this.node().rotation_axis.SetVector(aRotationAxis);
    this.node().rotation_angle = aAngle;
    return true;
  }

  /** `SetScale( const SGPOINT& )` / `SetScale( double )`, which refuses a scale within 1e-8 of 0. */
  SetScale(aScale: SGPOINT | number): boolean {
    if (typeof aScale === 'number') {
      if (aScale < 1e-8 && aScale > -1e-8) return false;

      this.node().scale = new SGPOINT(aScale, aScale, aScale);
      return true;
    }

    this.node().scale = new SGPOINT(aScale.x, aScale.y, aScale.z);
    return true;
  }

  SetTranslation(aTranslation: SGPOINT): boolean {
    this.node().translation = new SGPOINT(aTranslation.x, aTranslation.y, aTranslation.z);
    return true;
  }
}
