// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `3d-viewer/3d_cache/sg/ifsg_node.cpp`: IFSG_NODE, the wrapper a plugin or exporter holds; each
 * subclass makes its kind of node under a parent (NewNode) and forwards to it.
 */
import type { SGNODE } from './sg_node.js';

export type IFSG_PARENT = SGNODE | IFSG_NODE | null;

export abstract class IFSG_NODE {
  protected m_node: SGNODE | null = null;

  protected static raw(aParent: IFSG_PARENT): SGNODE | null {
    return aParent instanceof IFSG_NODE ? aParent.GetRawPtr() : aParent;
  }

  GetRawPtr(): SGNODE | null {
    return this.m_node;
  }

  /** `Attach( aNode )`. */
  Attach(aNode: SGNODE | null): boolean {
    this.m_node = aNode;
    return true;
  }

  AddRefNode(aNode: SGNODE | IFSG_NODE | null): boolean {
    const n = IFSG_NODE.raw(aNode);
    return !!(this.m_node && n && this.m_node.AddRefNode(n));
  }

  AddChildNode(aNode: SGNODE | IFSG_NODE | null): boolean {
    const n = IFSG_NODE.raw(aNode);
    return !!(this.m_node && n && this.m_node.AddChildNode(n));
  }

  abstract NewNode(aParent: IFSG_PARENT): boolean;
}
