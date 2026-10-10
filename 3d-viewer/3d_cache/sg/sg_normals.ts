// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_normals.{h,cpp}`: SGNORMALS, per-vertex normals. */
import { SGVECTOR } from './sg_base.js';
import { FormatVector } from './sg_helpers.js';
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

export class SGNORMALS extends SGNODE {
  norms: SGVECTOR[] = [];

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_NORMALS;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_FACESET) this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  AddNormal(aX: number | SGVECTOR, aY?: number, aZ?: number): void {
    if (aX instanceof SGVECTOR) {
      const v = new SGVECTOR();
      v.SetVector(aX);
      this.norms.push(v);
    } else {
      this.norms.push(new SGVECTOR(aX, aY!, aZ!));
    }
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
    if (this.norms.length === 0) return false;

    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(`  normal DEF ${this.GetName()} Normal { vector [\n  `);
        this.m_written = true;
      } else {
        aFile.push(`  normal USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push('  normal Normal { vector [\n  ');
    }

    const n = this.norms.length;
    let nline = false;

    for (let i = 0; i < n; ) {
      aFile.push(FormatVector(this.norms[i]!));
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
