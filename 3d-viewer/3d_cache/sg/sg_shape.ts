// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_shape.{h,cpp}`: SGSHAPE, an appearance and a face set. */
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

export class SGSHAPE extends SGNODE {
  // owned node
  m_Appearance: SGNODE | null = null;
  m_FaceSet: SGNODE | null = null;
  // referenced nodes
  m_RAppearance: SGNODE | null = null;
  m_RFaceSet: SGNODE | null = null;

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_SHAPE;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_TRANSFORM)
      this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  private addNode(aNode: SGNODE, isChild: boolean): boolean {
    const t = aNode.GetNodeType();

    if (t === SGTYPES.SGTYPE_APPEARANCE) {
      if (this.m_Appearance || this.m_RAppearance)
        return aNode === this.m_Appearance || aNode === this.m_RAppearance;

      if (isChild) {
        this.m_Appearance = aNode;
        aNode.SetParent(this);
      } else {
        this.m_RAppearance = aNode;
      }

      return true;
    }

    if (t === SGTYPES.SGTYPE_FACESET) {
      if (this.m_FaceSet || this.m_RFaceSet)
        return aNode === this.m_FaceSet || aNode === this.m_RFaceSet;

      if (isChild) {
        this.m_FaceSet = aNode;
        aNode.SetParent(this);
      } else {
        this.m_RFaceSet = aNode;
      }

      return true;
    }

    return false;
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

    // rename Appearance
    this.m_Appearance?.ReNameNodes();

    // rename FaceSet
    this.m_FaceSet?.ReNameNodes();
  }

  WriteVRML(aFile: string[], aReuseFlag: boolean): boolean {
    if (!this.m_Appearance && !this.m_RAppearance && !this.m_FaceSet && !this.m_RFaceSet)
      return false;

    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(`DEF ${this.GetName()} Shape {\n`);
        this.m_written = true;
      } else {
        aFile.push(` USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push(' Shape {\n');
    }

    this.m_Appearance?.WriteVRML(aFile, aReuseFlag);
    this.m_RAppearance?.WriteVRML(aFile, aReuseFlag);
    this.m_FaceSet?.WriteVRML(aFile, aReuseFlag);
    this.m_RFaceSet?.WriteVRML(aFile, aReuseFlag);

    aFile.push('}\n');

    return true;
  }
}
