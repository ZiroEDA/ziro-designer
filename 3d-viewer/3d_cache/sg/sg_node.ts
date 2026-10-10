// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `3d-viewer/3d_cache/sg/sg_node.{h,cpp}`: SGNODE, the scene graph's base. A node is owned by one
 * parent and may be referenced (written as USE) by others; names come from one counter per node
 * type, shared by every graph, which ResetNodeIndex rewinds.
 */
import { SGTYPES } from './sg_types.js';

const node_names = [
  'TXFM',
  'APP',
  'COL',
  'COLIDX',
  'FACE',
  'COORD',
  'COORDIDX',
  'NORM',
  'SHAPE',
  'INVALID',
];

const node_counts: number[] = new Array(SGTYPES.SGTYPE_END).fill(1);

export function GetNodeTypeName(aType: SGTYPES): string {
  return node_names[aType]!;
}

function getNodeName(nodeType: SGTYPES): string {
  if (nodeType < 0 || nodeType >= SGTYPES.SGTYPE_END) return node_names[SGTYPES.SGTYPE_END]!;

  const seqNum = node_counts[nodeType]!;
  ++node_counts[nodeType]!;

  return `${node_names[nodeType]}_${seqNum}`;
}

export abstract class SGNODE {
  protected m_Parent: SGNODE | null;
  protected m_SGtype: SGTYPES = SGTYPES.SGTYPE_END;
  protected m_Name = '';
  /** Set to true when the object has been written after a ReNameNodes(). */
  protected m_written = false;

  constructor(aParent: SGNODE | null) {
    this.m_Parent = aParent;
  }

  GetNodeType(): SGTYPES {
    return this.m_SGtype;
  }

  GetParent(): SGNODE | null {
    return this.m_Parent;
  }

  /** `SetParent( aParent, notify )`, without the unlinking the exporter never needs. */
  SetParent(aParent: SGNODE | null): boolean {
    this.m_Parent = aParent;
    return true;
  }

  GetName(): string {
    if (this.m_Name === '') this.m_Name = getNodeName(this.m_SGtype);

    return this.m_Name;
  }

  SetName(aName: string | null): void {
    if (!aName) this.m_Name = getNodeName(this.m_SGtype);
    else this.m_Name = aName;
  }

  ResetNodeIndex(): void {
    for (let i = 0; i < SGTYPES.SGTYPE_END; ++i) node_counts[i] = 1;
  }

  isWritten(): boolean {
    return this.m_written;
  }

  abstract AddRefNode(aNode: SGNODE): boolean;
  abstract AddChildNode(aNode: SGNODE): boolean;
  abstract ReNameNodes(): void;
  abstract WriteVRML(aFile: string[], aReuseFlag: boolean): boolean;
}
