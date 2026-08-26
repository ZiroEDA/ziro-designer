// @vitest-environment happy-dom
/**
 * Baseline D2: what React itself pays to render the chooser's row list at the
 * sizes measured in chooser.bench.ts. Layout, paint and hit-testing are Chrome's
 * and are ON TOP of this; this is the JS half only.
 */
import { test } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

interface Row {
  node: LibTreeNode;
  indent: number;
  expandable: boolean;
  open: boolean;
}

function makeRows(n: number): Row[] {
  const out: Row[] = [];
  const lib = new LibTreeNode();
  lib.type = LibTreeNodeType.LIBRARY;
  lib.name = 'Device';
  for (let i = 0; i < n; i++) {
    const node = new LibTreeNode();
    node.type = LibTreeNodeType.ITEM;
    node.parent = lib;
    node.name = `Symbol_${i}`;
    node.libNickname = 'Device';
    node.libItemName = node.name;
    node.desc = 'A description roughly the length of a real one';
    out.push({ node, indent: 1, expandable: false, open: false });
  }
  return out;
}

// The row markup of designer/src/widgets/lib_tree.tsx, verbatim in shape.
function Rows({ rows }: { rows: Row[] }): JSX.Element {
  return (
    <div className="ze-libtree-list">
      {rows.map(({ node, indent, expandable, open }) => (
        <div
          key={`${node.parent?.name ?? ''}/${node.libId || node.name}`}
          ref={() => {}}
          className={`ze-libtree-row${node.type === LibTreeNodeType.LIBRARY ? ' lib' : ''}`}
          style={{ paddingLeft: 4 + indent * 16 }}
          onClick={() => {}}
          onDoubleClick={() => {}}
          onMouseMove={() => {}}
          onContextMenu={() => {}}
          title={node.libId || node.name}
        >
          <span className={`twisty${expandable ? ' expandable' : ''}${open ? ' open' : ''}`} />
          <span className="col-item">{node.name}</span>
          <span className="col-desc">{node.desc}</span>
        </div>
      ))}
    </div>
  );
}

test('row render cost', () => {
  for (const n of [223, 947, 2500, 5000, 10000]) {
    const rows = makeRows(n);
    const s = performance.now();
    render(<Rows rows={rows} />);
    const t = performance.now() - s;
    const nodes = document.querySelectorAll('*').length;
    console.log(
      `  ${String(n).padStart(6)} rows -> React mount ${t.toFixed(0).padStart(6)} ms, ${String(nodes).padStart(7)} DOM elements`,
    );
    cleanup();
  }
}, 600_000);
