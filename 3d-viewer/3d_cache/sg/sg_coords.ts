// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_coords.{h,cpp}`: SGCOORDS, a Coordinate list. */
import { SGPOINT } from './sg_base.js';
import { FormatPoint } from './sg_helpers.js';
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

export class SGCOORDS extends SGNODE {
  coords: SGPOINT[] = [];

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_COORDS;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_FACESET) this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  SetCoordsList(aCoordsList: readonly SGPOINT[]): void {
    this.coords = [...aCoordsList];
  }

  AddCoord(aPoint: SGPOINT): void {
    this.coords.push(new SGPOINT(aPoint.x, aPoint.y, aPoint.z));
  }

  AddRefNode(_aNode: SGNODE): boolean {
    return false;
  }

  AddChildNode(_aNode: SGNODE): boolean {
    return false;
  }

  ReNameNodes(): void {
    this.m_written = false;

    // rename this node
    this.m_Name = '';
    this.GetName();
  }

  WriteVRML(aFile: string[], aReuseFlag: boolean): boolean {
    if (this.coords.length === 0) return false;

    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(`  coord DEF ${this.GetName()} Coordinate { point [\n  `);
        this.m_written = true;
      } else {
        aFile.push(`  coord USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push('  coord Coordinate { point [\n  ');
    }

    const n = this.coords.length;
    let nline = false;

    for (let i = 0; i < n; ) {
      // ensure VRML output has 1U = 0.1 inch as per legacy kicad expectations
      const c = this.coords[i]!;
      aFile.push(FormatPoint(new SGPOINT(c.x / 2.54, c.y / 2.54, c.z / 2.54)));
      ++i;

      if (i < n) {
        aFile.push(',');

        if (nline) {
          aFile.push('\n  ');
          nline = false;
        } else {
          nline = true;
        }
      }
    }

    aFile.push('] }\n');

    return true;
  }
}
