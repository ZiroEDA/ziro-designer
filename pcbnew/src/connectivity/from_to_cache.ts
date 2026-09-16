// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/connectivity/from_to_cache.h` + `.cpp`. */
import { wildCompareString } from '@ziroeda/common/src/string_utils.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { PAD } from '../pad.js';
import { EXCLUDE_ZONES } from './connectivity_data.js';
import type { CN_ITEM } from './connectivity_items.js';

export interface FT_ENDPOINT {
  name: string;
  parent: PAD;
}

export interface FT_PATH {
  net: number;
  from: PAD | null;
  to: PAD | null;
  fromName: string;
  toName: string;
  fromWildcard: string;
  toWildcard: string;
  isUnique: boolean;
  pathItems: Set<BOARD_CONNECTED_ITEM>;
}

enum PATH_STATUS {
  PS_OK = 0,
  PS_MULTIPLE_PATHS = -1,
  PS_NO_PATH = -2,
}

function isVertexVisited(v: CN_ITEM, path: readonly CN_ITEM[]): boolean {
  for (const u of path) {
    if (u === v) return true;
  }

  return false;
}

function uniquePathBetweenNodes(
  u: CN_ITEM,
  v: CN_ITEM,
  outPath: { value: CN_ITEM[] },
): PATH_STATUS {
  type Path = CN_ITEM[];

  const Q: Path[] = [];
  const pInit: Path = [];
  let pathFound = false;

  pInit.push(u);
  Q.push(pInit);

  let head = 0;

  while (head < Q.length) {
    const path = Q[head++]!;
    const last = path[path.length - 1]!;

    if (last === v) {
      outPath.value = path;

      if (pathFound) return PATH_STATUS.PS_MULTIPLE_PATHS;

      pathFound = true;
    }

    for (const ci of last.ConnectedItems()) {
      let vertexVisited = isVertexVisited(ci, path);

      for (let i = head; i < Q.length; i++) {
        if (isVertexVisited(ci, Q[i]!)) {
          vertexVisited = true;
          break;
        }
      }

      if (!vertexVisited) {
        const newpath = path.slice();
        newpath.push(ci);
        Q.push(newpath);
      }
    }
  }

  return pathFound ? PATH_STATUS.PS_OK : PATH_STATUS.PS_NO_PATH;
}

export class FROM_TO_CACHE {
  private m_ftEndpoints: FT_ENDPOINT[] = [];
  private m_ftPaths: FT_PATH[] = [];
  private m_board: BOARD | null;

  constructor(aBoard: BOARD | null = null) {
    this.m_board = aBoard;
  }

  private buildEndpointList(): void {
    this.m_ftEndpoints.length = 0;

    for (const footprint of this.m_board!.Footprints()) {
      for (const pad of footprint.Pads()) {
        this.m_ftEndpoints.push({
          name: `${footprint.GetReference()}-${pad.GetNumber()}`,
          parent: pad,
        });
        this.m_ftEndpoints.push({ name: footprint.GetReference(), parent: pad });
      }
    }
  }

  private cacheFromToPaths(aFrom: string, aTo: string): number {
    const paths: FT_PATH[] = [];
    const connectivity = this.m_board!.GetConnectivity();
    const cnAlgo = connectivity.GetConnectivityAlgo();

    for (const endpoint of this.m_ftEndpoints) {
      if (wildCompareString(aFrom, endpoint.name, false)) {
        paths.push({
          net: endpoint.parent.GetNetCode(),
          from: endpoint.parent,
          to: null,
          fromName: '',
          toName: '',
          fromWildcard: '',
          toWildcard: '',
          isUnique: false,
          pathItems: new Set(),
        });
      }
    }

    for (const path of paths) {
      let count = 0;
      const fromName = `${path.from!.GetParentFootprint()!.GetReference()}-${path.from!.GetNumber()}`;

      const padCandidates = connectivity.GetConnectedItems(path.from!, EXCLUDE_ZONES);
      let toPad: PAD | null = null;

      for (const pitem of padCandidates) {
        if (pitem === path.from) continue;

        if (pitem.Type() !== KICAD_T.PCB_PAD_T) continue;

        const pad = pitem as PAD;

        const toName = `${pad.GetParentFootprint()!.GetReference()}-${pad.GetNumber()}`;

        for (const endpoint of this.m_ftEndpoints) {
          if (pad === endpoint.parent) {
            if (wildCompareString(aTo, endpoint.name, false)) {
              count++;
              toPad = endpoint.parent;

              path.to = toPad;
              path.fromName = fromName;
              path.toName = toName;
              path.fromWildcard = aFrom;
              path.toWildcard = aTo;

              if (count >= 2) {
                // fixme: report this somewhere?
                path.to = null;
              }
            }
          }
        }
      }
    }

    let newPaths = 0;

    for (const path of paths) {
      if (!path.from || !path.to) continue;

      const cnFrom = cnAlgo.ItemEntry(path.from).GetItems()[0]!;
      const cnTo = cnAlgo.ItemEntry(path.to).GetItems()[0]!;
      const upath: { value: CN_ITEM[] } = { value: [] };

      const result = uniquePathBetweenNodes(cnFrom, cnTo, upath);

      if (result === PATH_STATUS.PS_OK) path.isUnique = true;
      else path.isUnique = false;

      if (result === PATH_STATUS.PS_NO_PATH) continue;

      for (const item of upath.value) path.pathItems.add(item.Parent());

      this.m_ftPaths.push(path);
      newPaths++;
    }

    return newPaths;
  }

  IsOnFromToPath(aItem: BOARD_CONNECTED_ITEM, aFrom: string, aTo: string): boolean {
    let nFromTosFound = 0;

    if (!this.m_board) return false;

    for (let attempt = 0; attempt < 2; attempt++) {
      // item already belongs to path
      for (const ftPath of this.m_ftPaths) {
        if (aFrom === ftPath.fromWildcard && aTo === ftPath.toWildcard) {
          nFromTosFound++;

          if (ftPath.pathItems.has(aItem)) return true;
        }
      }

      if (!nFromTosFound) this.cacheFromToPaths(aFrom, aTo);
      else return false;
    }

    return false;
  }

  Rebuild(aBoard: BOARD): void {
    this.m_board = aBoard;
    this.buildEndpointList();
    this.m_ftPaths.length = 0;
  }

  QueryFromToPath(aItems: ReadonlySet<BOARD_CONNECTED_ITEM>): FT_PATH | null {
    for (const ftPath of this.m_ftPaths) {
      if (
        ftPath.pathItems.size === aItems.size &&
        [...aItems].every((i) => ftPath.pathItems.has(i))
      )
        return ftPath;
    }

    return null;
  }
}
