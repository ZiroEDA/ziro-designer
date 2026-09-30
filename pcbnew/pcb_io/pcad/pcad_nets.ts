// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_nets.cpp` / `.h`: a netlist `net` and its nodes.
 */

import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { FindNode, GetName, TrimLeft, TrimRight } from './pcad2kicad_common.js';

/** `~name~` (P-CAD's overbar) becomes `~{name}`, then the net-name escapes. */
export function ConvertNetName(aName: string): string {
  let retval = '';
  let negate = false;

  for (const c of aName) {
    if (c !== '~') {
      retval += c;
    } else if (!negate) {
      retval += '~';
      retval += '{';
      negate = true;
    } else {
      retval += '}';
      negate = false;
    }
  }

  return EscapeString(retval, ESCAPE_CONTEXT.CTX_NETNAME);
}

export class PCAD_NET_NODE {
  m_CompRef = '';
  m_PinRef = '';
}

export class PCAD_NET {
  m_Name = '';
  readonly m_NetNodes: PCAD_NET_NODE[] = [];

  constructor(public m_NetCode: number) {}

  Parse(aNode: XNODE): void {
    let propValue = GetName(aNode, '');
    let s1: string;
    let s2 = '';

    propValue = TrimRight(TrimLeft(propValue));
    this.m_Name = ConvertNetName(propValue);

    let lNode = FindNode(aNode, 'node');

    while (lNode) {
      s2 = TrimLeft(GetName(lNode, s2));
      s1 = '';

      while (s2.length > 0 && s2[0] !== ' ') {
        s1 = s1 + s2[0];
        s2 = s2.slice(1);
      }

      const netNode = new PCAD_NET_NODE();
      s1 = TrimRight(TrimLeft(s1));
      netNode.m_CompRef = s1;

      s2 = TrimRight(TrimLeft(s2));
      netNode.m_PinRef = s2;
      this.m_NetNodes.push(netNode);
      lNode = lNode.GetNext();
    }
  }
}
