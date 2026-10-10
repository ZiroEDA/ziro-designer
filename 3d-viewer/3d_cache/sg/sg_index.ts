// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_index.{h,cpp}`: SGINDEX, the base of the coordinate and color indices. */
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

export abstract class SGINDEX extends SGNODE {
  index: number[] = [];

  SetIndices(aIndexList: readonly number[]): void {
    this.index = [...aIndexList];
  }

  AddIndex(aIndex: number): void {
    this.index.push(aIndex);
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

  WriteVRML(aFile: string[], _aReuseFlag: boolean): boolean {
    if (this.index.length === 0) return false;

    if (this.m_SGtype === SGTYPES.SGTYPE_COORDINDEX) return this.writeCoordIndex(aFile);

    return this.writeColorIndex(aFile);
  }

  private writeCoordIndex(aFile: string[]): boolean {
    const n = this.index.length;

    // Coordinate index is not divisible by three (violates triangle constraint)
    if (n % 3 !== 0) return false;

    aFile.push(' coordIndex [\n  ');

    // indices to control formatting
    let nv0 = 0;
    let nv1 = 0;

    for (let i = 0; i < n; ) {
      aFile.push(String(this.index[i]));
      ++i;

      if (++nv0 === 3) {
        aFile.push(',-1');
        ++nv1;
        nv0 = 0;
      }

      if (i < n) {
        aFile.push(',');

        if (nv1 === 8) {
          nv1 = 0;
          aFile.push('\n  ');
        }
      }
    }

    aFile.push(']\n');

    return true;
  }

  private writeColorIndex(aFile: string[]): boolean {
    aFile.push(' colorIndex [\n  ');
    return this.writeIndexList(aFile);
  }

  private writeIndexList(aFile: string[]): boolean {
    // index to control formatting
    let nv = 0;
    const n = this.index.length;

    for (let i = 0; i < n; ) {
      aFile.push(String(this.index[i]));
      ++i;

      if (i < n) {
        aFile.push(',');

        if (++nv === 20) {
          aFile.push('\n  ');
          nv = 0;
        }
      }
    }

    aFile.push(']\n');

    return true;
  }
}
