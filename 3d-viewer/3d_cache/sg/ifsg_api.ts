// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_api.cpp`: the S3D:: functions the exporters call. */
import { SGVECTOR, type SGPOINT } from './sg_base.js';
import { degenerate } from './sg_helpers.js';
import type { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

/**
 * `S3D::WriteVRML( filename, overwrite, aTopNode, reuse, renameNodes )`: the file's text, or
 * null when aTopNode is not a transform. The caller writes it.
 */
export function WriteVRML(
  aTopNode: SGNODE | null,
  reuse: boolean,
  renameNodes: boolean,
): string | null {
  if (!aTopNode || aTopNode.GetNodeType() !== SGTYPES.SGTYPE_TRANSFORM) return null;

  const op: string[] = ['#VRML V2.0 utf8\n'];

  if (renameNodes) {
    aTopNode.ResetNodeIndex();
    aTopNode.ReNameNodes();
  }

  aTopNode.WriteVRML(op, reuse);

  return op.join('');
}

export function GetSGNodeParent(aNode: SGNODE | null): SGNODE | null {
  return aNode?.GetParent() ?? null;
}

/**
 * `S3D::CalcTriNorm`: the triangle's normal; (0, 0, 1) for a degenerate one. glm::normalize's
 * result is discarded upstream, so the SGVECTOR constructor is what normalises.
 */
export function CalcTriNorm(p1: SGPOINT, p2: SGPOINT, p3: SGPOINT): SGVECTOR {
  const pts: [number, number, number][] = [
    [p1.x, p1.y, p1.z],
    [p2.x, p2.y, p2.z],
    [p3.x, p3.y, p3.z],
  ];

  // degenerate points are given a default 0, 0, 1 normal
  if (degenerate(pts)) return new SGVECTOR(0.0, 0.0, 1.0);

  // normal
  const a = [pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1], pts[1]![2] - pts[0]![2]] as const;
  const b = [pts[2]![0] - pts[0]![0], pts[2]![1] - pts[0]![1], pts[2]![2] - pts[0]![2]] as const;

  return new SGVECTOR(
    a[1] * b[2] - b[1] * a[2],
    a[2] * b[0] - b[2] * a[0],
    a[0] * b[1] - b[0] * a[1],
  );
}
