// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_faceset.{h,cpp}`: SGFACESET, an IndexedFaceSet. */
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

export class SGFACESET extends SGNODE {
  // owned objects
  m_Colors: SGNODE | null = null;
  m_Coords: SGNODE | null = null;
  m_CoordIndices: SGNODE | null = null;
  m_Normals: SGNODE | null = null;
  // referenced objects
  m_RColors: SGNODE | null = null;
  m_RCoords: SGNODE | null = null;
  m_RNormals: SGNODE | null = null;

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_FACESET;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_SHAPE) this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  private addNode(aNode: SGNODE, isChild: boolean): boolean {
    const slot = (
      own: 'm_Colors' | 'm_Coords' | 'm_Normals',
      ref: 'm_RColors' | 'm_RCoords' | 'm_RNormals',
    ): boolean => {
      if (this[own] || this[ref]) return aNode === this[own] || aNode === this[ref];

      if (isChild) {
        this[own] = aNode;
        aNode.SetParent(this);
      } else {
        this[ref] = aNode;
      }

      return true;
    };

    switch (aNode.GetNodeType()) {
      case SGTYPES.SGTYPE_COLORS:
        return slot('m_Colors', 'm_RColors');
      case SGTYPES.SGTYPE_COORDS:
        return slot('m_Coords', 'm_RCoords');
      case SGTYPES.SGTYPE_NORMALS:
        return slot('m_Normals', 'm_RNormals');
      case SGTYPES.SGTYPE_COORDINDEX:
        if (this.m_CoordIndices) return aNode === this.m_CoordIndices;

        // a coordinate index is only ever owned
        if (!isChild) return false;

        this.m_CoordIndices = aNode;
        aNode.SetParent(this);
        return true;
      default:
        return false;
    }
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

    // rename all Colors and Indices
    this.m_Colors?.ReNameNodes();

    // rename all Coordinates and Indices
    this.m_Coords?.ReNameNodes();
    this.m_CoordIndices?.ReNameNodes();

    // rename all Normals and Indices
    this.m_Normals?.ReNameNodes();
  }

  WriteVRML(aFile: string[], aReuseFlag: boolean): boolean {
    if ((this.m_Coords === null && this.m_RCoords === null) || this.m_CoordIndices === null)
      return false;

    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(` geometry DEF ${this.GetName()} IndexedFaceSet {\n`);
        this.m_written = true;
      } else {
        aFile.push(`USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push(' geometry IndexedFaceSet {\n');
    }

    this.m_Coords?.WriteVRML(aFile, aReuseFlag);
    this.m_RCoords?.WriteVRML(aFile, aReuseFlag);
    this.m_CoordIndices.WriteVRML(aFile, aReuseFlag);

    if (this.m_Normals || this.m_RNormals) aFile.push('  normalPerVertex TRUE\n');

    this.m_Normals?.WriteVRML(aFile, aReuseFlag);
    this.m_RNormals?.WriteVRML(aFile, aReuseFlag);
    this.m_Colors?.WriteVRML(aFile, aReuseFlag);
    this.m_RColors?.WriteVRML(aFile, aReuseFlag);

    aFile.push('}\n');

    return true;
  }
}
