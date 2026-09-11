// The symbol preload reads a library through a pruned parse (LIB_TREE_PRUNE)
// so that four workers parsing the biggest libraries at once no longer cost
// ~1.5 GB of renderer footprint. The pruning is only right if it changes
// nothing a LibTreeItem carries, so every bundled library is projected both
// ways and compared; the full hosted set is checked too when the perf fixture
// is on this machine.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSymbolLib } from '@ziroeda/eeschema';
import { parse, type SNode } from '@ziroeda/sexpr';
import { describe, expect, it } from 'vitest';
import {
  LIB_TREE_PRUNE,
  libTreeItem,
  readLibTreeItems,
} from '@ziroeda/designer/src/editors/schematic/symbols/lib_tree_item.js';

const BUNDLED = fileURLToPath(new URL('../../../designer/public/symbols/', import.meta.url));
const FIXTURE = join(homedir(), 'ziro-perf-fixtures/symbols');

const libraries = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.kicad_sym')) : [];

const nodeCount = (n: SNode): number =>
  n.kind === 'list' ? 1 + n.items.reduce((s, i) => s + nodeCount(i), 0) : 1;

describe('readLibTreeItems', () => {
  const bundled = libraries(BUNDLED);
  it('has bundled libraries to check against', () => {
    expect(bundled.length).toBeGreaterThan(20);
  });

  it.each(bundled)('projects %s exactly as the full parse does', (file) => {
    const text = readFileSync(join(BUNDLED, file), 'utf8');
    const full = readSymbolLib(parse(text)).map(libTreeItem);
    expect(readLibTreeItems(text)).toEqual(full);
    expect(full.length).toBeGreaterThan(0);
  });

  it('builds a small fraction of the tree', () => {
    const text = readFileSync(join(BUNDLED, 'Device.kicad_sym'), 'utf8');
    const full = nodeCount(parse(text));
    const pruned = nodeCount(parse(text, LIB_TREE_PRUNE));
    // Measured 365 648 -> 41 463 nodes (42.5 MB -> 5.8 MB of heap); what is
    // left is one three-node `(pin type shape)` per pin. MCU_ST_STM32H7 goes
    // 198 MB -> 14 MB (qa/perf/parse_memory.ts).
    expect(pruned).toBeLessThan(full / 8);
  });

  // The hosted catalogue, 223 libraries, when qa/perf's fixture is downloaded.
  const hosted = libraries(FIXTURE);
  it.runIf(hosted.length > 0).each(hosted)(
    'projects the hosted %s exactly as the full parse does',
    (file) => {
      const text = readFileSync(join(FIXTURE, file), 'utf8');
      expect(readLibTreeItems(text)).toEqual(readSymbolLib(parse(text)).map(libTreeItem));
    },
  );
});
