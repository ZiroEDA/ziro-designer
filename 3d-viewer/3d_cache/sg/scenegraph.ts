// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/scenegraph.{h,cpp}`: SCENEGRAPH, the Transform node. */
import { SGPOINT, SGVECTOR } from './sg_base.js';
import { FormatOrientation, FormatPoint } from './sg_helpers.js';
import { SGNODE } from './sg_node.js';
import type { SGSHAPE } from './sg_shape.js';
import { SGTYPES } from './sg_types.js';

export class SCENEGRAPH extends SGNODE {
  // note: order of transformation is Translate, Rotate, Offset
  center = new SGPOINT();
  translation = new SGPOINT();
  rotation_axis = new SGVECTOR();
  rotation_angle = 0.0; // radians
  scale = new SGPOINT(1.0, 1.0, 1.0);
  scale_axis = new SGVECTOR();
  scale_angle = 0.0; // radians

  private m_Transforms: SCENEGRAPH[] = [];
  private m_Shape: SGSHAPE[] = [];
  private m_RTransforms: SCENEGRAPH[] = [];
  private m_RShape: SGSHAPE[] = [];

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_TRANSFORM;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_TRANSFORM)
      this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  private addNode(aNode: SGNODE, isChild: boolean): boolean {
    const t = aNode.GetNodeType();
    const [owned, refs]: [SGNODE[], SGNODE[]] | [null, null] =
      t === SGTYPES.SGTYPE_TRANSFORM
        ? [this.m_Transforms, this.m_RTransforms]
        : t === SGTYPES.SGTYPE_SHAPE
          ? [this.m_Shape, this.m_RShape]
          : [null, null];

    if (!owned) return false;

    if (owned.includes(aNode) || refs!.includes(aNode)) return true;

    if (isChild) {
      const ppn = aNode.GetParent();

      if (ppn !== null && ppn !== this) return false;

      owned.push(aNode);
      aNode.SetParent(this);
    } else {
      refs!.push(aNode);
    }

    return true;
  }

  AddRefNode(aNode: SGNODE): boolean {
    return this.addNode(aNode, false);
  }

  AddChildNode(aNode: SGNODE): boolean {
    return this.addNode(aNode, true);
  }

  ReNameNodes(): void {
    this.m_written = false;

    // rename this node
    this.m_Name = '';
    this.GetName();

    // rename all shapes
    for (const s of this.m_Shape) s.ReNameNodes();

    // rename all transforms
    for (const t of this.m_Transforms) t.ReNameNodes();
  }

  WriteVRML(aFile: string[], aReuseFlag: boolean): boolean {
    if (
      this.m_Transforms.length === 0 &&
      this.m_RTransforms.length === 0 &&
      this.m_Shape.length === 0 &&
      this.m_RShape.length === 0
    ) {
      return false;
    }

    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(`DEF ${this.GetName()} Transform {\n`);
        this.m_written = true;
      } else {
        aFile.push(`USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push(' Transform {\n');
    }

    // convert center to 1VRML unit = 0.1 inch
    let pt = new SGPOINT(this.center.x / 2.54, this.center.y / 2.54, this.center.z / 2.54);

    aFile.push(`  center ${FormatPoint(pt)}\n`);
    aFile.push(`  rotation ${FormatOrientation(this.rotation_axis, this.rotation_angle)}\n`);
    aFile.push(`  scale ${FormatPoint(this.scale)}\n`);
    aFile.push(`  scaleOrientation ${FormatOrientation(this.scale_axis, this.scale_angle)}\n`);

    // convert translation to 1VRML unit = 0.1 inch
    pt = new SGPOINT(
      this.translation.x / 2.54,
      this.translation.y / 2.54,
      this.translation.z / 2.54,
    );
    aFile.push(`  translation ${FormatPoint(pt)}\n`);

    aFile.push(' children [\n');

    for (const t of this.m_Transforms) t.WriteVRML(aFile, aReuseFlag);

    for (const t of this.m_RTransforms) t.WriteVRML(aFile, aReuseFlag);

    for (const s of this.m_Shape) s.WriteVRML(aFile, aReuseFlag);

    for (const s of this.m_RShape) s.WriteVRML(aFile, aReuseFlag);

    aFile.push('] }\n');

    return true;
  }
}
