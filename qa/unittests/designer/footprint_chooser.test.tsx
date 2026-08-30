// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOOSER_FRAME` and `FP_TREE_MODEL_ADAPTER`.
 *
 * The two rules worth pinning are both the frame's, not the tree's:
 *
 *  - a filter checkbox is BUILT only when there is something for it to filter
 *    on. `if( !m_fpFilters.empty() ) { … } else { if( m_filterByFPFilters )
 *    …->Hide(); }` (footprint_chooser_frame.cpp:570-598) — a symbol with no
 *    ki_fp_filters shows no checkbox at all, not an unticked one;
 *  - ticking one calls `m_chooserPanel->Regenerate()` (:580), which rebuilds
 *    the tree against the new filter rather than hiding rows client-side.
 *
 * And the filter itself is two independent halves (`filterFootprint`): the
 * fp_filters, matched as anchored wildcards, and the unique pad count. An index
 * without pad counts degrades to "no filtering" rather than to "nothing
 * matches", which is the same graceful shape the rest of the footprint list
 * uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addFootprintLibraries,
  footprintPassesFilter,
} from '@ziroeda/designer/src/editors/pcb/widgets/fp_tree_model_adapter.js';
import { generateFootprintInfo } from '@ziroeda/designer/src/editors/pcb/widgets/generate_footprint_info.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { FootprintChooserFrame } from '@ziroeda/designer/src/editors/pcb/dialogs/footprint_chooser_frame.js';
import { PanelFootprintChooser } from '@ziroeda/designer/src/editors/pcb/widgets/panel_footprint_chooser.js';
import type { FpIndexEntry } from '@ziroeda/designer/src/widgets/footprint_list.js';

afterEach(cleanup);

/**
 * The frame fetches the index itself, so a test that does not stand one up
 * gets an empty tree — and every assertion about counting or filtering then
 * holds trivially. Both the "title does not follow the filter" and the
 * "unticked by default" cases passed with their fixes removed for exactly that
 * reason. Mocked here so the frame has 4 footprints to be wrong about.
 */
vi.mock('@ziroeda/designer/src/widgets/footprint_list.js', async (orig) => ({
  ...(await orig<typeof import('@ziroeda/designer/src/widgets/footprint_list.js')>()),
  loadFootprintIndex: () => Promise.resolve(INDEX),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const INDEX: FpIndexEntry[] = [
  {
    name: 'TerminalBlock',
    footprints: ['TB_01x02_P5.00mm', 'TB_01x03_P5.00mm'],
    pads: [2, 3],
    descr: ['terminal block, 2 pins https://x.example/ds.pdf', 'terminal block, 3 pins'],
    tags: ['THT terminal block', 'THT terminal block'],
  },
  {
    name: 'Resistor_SMD',
    footprints: ['R_0603', 'R_0805'],
    pads: [2, 2],
    descr: ['Resistor SMD 0603', 'Resistor SMD 0805'],
    tags: ['resistor smd', 'resistor smd'],
  },
];

describe('the filter is two independent halves', () => {
  it('passes everything when neither half is set', () => {
    expect(footprintPassesFilter({}, 'Resistor_SMD', 'R_0603', 2)).toBe(true);
  });

  it('matches an fp filter as an anchored wildcard on the name', () => {
    const f = { fpFilters: ['tb_*'] };
    expect(footprintPassesFilter(f, 'TerminalBlock', 'TB_01x02_P5.00mm', 2)).toBe(true);
    expect(footprintPassesFilter(f, 'Resistor_SMD', 'R_0603', 2)).toBe(false);
  });

  it('matches against the LIB_ID when the pattern carries a colon', () => {
    const f = { fpFilters: ['TerminalBlock:*'] };
    expect(footprintPassesFilter(f, 'TerminalBlock', 'TB_01x02_P5.00mm', 2)).toBe(true);
    expect(footprintPassesFilter(f, 'Resistor_SMD', 'R_0603', 2)).toBe(false);
  });

  it('is anchored, so a bare word does not substring-match', () => {
    // EDA_PATTERN_MATCH_WILDCARD_**ANCHORED**: the whole string.
    expect(footprintPassesFilter({ fpFilters: ['0603'] }, 'Resistor_SMD', 'R_0603', 2)).toBe(false);
    expect(footprintPassesFilter({ fpFilters: ['*0603'] }, 'Resistor_SMD', 'R_0603', 2)).toBe(true);
  });

  it('filters on the unique pad count', () => {
    expect(footprintPassesFilter({ pinCount: 2 }, 'TerminalBlock', 'TB_01x02_P5.00mm', 2)).toBe(
      true,
    );
    expect(footprintPassesFilter({ pinCount: 2 }, 'TerminalBlock', 'TB_01x03_P5.00mm', 3)).toBe(
      false,
    );
  });

  it('degrades to no filtering when the index carries no pad count', () => {
    // Not to "nothing matches" — an older index must not empty the chooser.
    expect(footprintPassesFilter({ pinCount: 2 }, 'TerminalBlock', 'TB', undefined)).toBe(true);
  });

  it('applies both halves at once', () => {
    const f = { fpFilters: ['tb_*'], pinCount: 3 };
    expect(footprintPassesFilter(f, 'TerminalBlock', 'TB_01x02_P5.00mm', 2)).toBe(false);
    expect(footprintPassesFilter(f, 'TerminalBlock', 'TB_01x03_P5.00mm', 3)).toBe(true);
  });
});

describe('the adapter builds the tree from the index', () => {
  it('adds every footprint when unfiltered', () => {
    const a = new LibTreeModelAdapter();
    addFootprintLibraries(a, INDEX);
    expect(a.getItemCount()).toBe(4);
  });

  it('adds only what survives the filter', () => {
    const a = new LibTreeModelAdapter();
    addFootprintLibraries(a, INDEX, { pinCount: 3 });
    expect(a.getItemCount()).toBe(1);
  });

  it('carries the description onto the item, for the tree column', () => {
    const a = new LibTreeModelAdapter();
    addFootprintLibraries(a, INDEX, { fpFilters: ['r_0805'] });
    const lib = a.tree.children.find((c) => c.name === 'Resistor_SMD')!;
    expect(lib.children[0]!.desc).toBe('Resistor SMD 0805');
  });
});

describe('GenerateFootprintInfo', () => {
  it('is empty for no selection, as an invalid LIB_ID is', () => {
    expect(generateFootprintInfo(null)).toBe('');
  });

  it('uses upstream DescriptionFormat, name then description then a rule', () => {
    const html = generateFootprintInfo({ libId: 'Lib:R_0603', description: 'Resistor SMD 0603' });
    expect(html).toContain('<b>R_0603</b>');
    expect(html).toContain('<br>Resistor SMD 0603');
    expect(html).toContain('<hr><table border=0>');
  });

  it('adds a Keywords row only when there are keywords', () => {
    expect(generateFootprintInfo({ libId: 'L:N', keywords: 'smd' })).toContain('<b>Keywords</b>');
    expect(generateFootprintInfo({ libId: 'L:N' })).not.toContain('<b>Keywords</b>');
  });

  it('links a datasheet URL out of the description', () => {
    const html = generateFootprintInfo({
      libId: 'L:N',
      description: 'terminal block https://x.example/ds.pdf',
    });
    expect(html).toContain('<b>Documentation</b>');
    expect(html).toContain('href="https://x.example/ds.pdf"');
    // ...and it does not also trail the description text.
    expect(html).toContain('<br>terminal block<');
  });

  it('escapes library data rather than trusting it as markup', () => {
    const html = generateFootprintInfo({ libId: 'L:N', description: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the chooser opens on the footprint the field already names', () => {
  /**
   * `ShowModal( wxString* aFootprint, … )` seeds the preselection, and
   * `LIB_TREE::SelectLibId` only takes effect once the node it names EXISTS.
   * The library index arrives AFTER mount, so the tree has to be told to try
   * again when it does - which is what LibTree's `regenerateNonce` is for. The
   * first version of this panel never bumped it, so the chooser opened on
   * nothing even when the field already named a footprint.
   */
  it('selects the preselected footprint once the tree holds it', () => {
    const picked: (string | null)[] = [];
    render(
      <PanelFootprintChooser
        index={INDEX}
        preselect="Resistor_SMD:R_0805"
        onSelect={(id) => picked.push(id)}
        onChoose={() => {}}
      />,
    );
    expect(picked).toContain('Resistor_SMD:R_0805');
  });

  it('selects it when the index arrives AFTER mount, which is the real order', () => {
    // The frame fetches the index; the panel mounts with nothing. A test that
    // hands the index in synchronously proves nothing about that, because the
    // node already exists when `SelectLibId`'s effect first runs - which is why
    // the first version of this case passed with the nonce removed. Here the
    // tree is empty at mount and the preselection can only land if the panel
    // asks the tree to try again once the adapter has been rebuilt.
    const picked: (string | null)[] = [];
    const { rerender } = render(
      <PanelFootprintChooser
        index={[]}
        preselect="Resistor_SMD:R_0805"
        onSelect={(id) => picked.push(id)}
        onChoose={() => {}}
      />,
    );
    expect(picked.filter(Boolean)).toEqual([]);

    rerender(
      <PanelFootprintChooser
        index={INDEX}
        preselect="Resistor_SMD:R_0805"
        onSelect={(id) => picked.push(id)}
        onChoose={() => {}}
      />,
    );
    expect(picked).toContain('Resistor_SMD:R_0805');
  });

  it('leaves nothing selected when the field names no footprint', () => {
    const picked: (string | null)[] = [];
    render(
      <PanelFootprintChooser
        index={INDEX}
        onSelect={(id) => picked.push(id)}
        onChoose={() => {}}
      />,
    );
    expect(picked.filter(Boolean)).toEqual([]);
  });

  it('does not select a footprint the filter has removed from the tree', () => {
    // The preselection is a node lookup, not a string: a footprint filtered out
    // is not in the tree, so nothing is selected and OK will not write it back.
    const picked: (string | null)[] = [];
    render(
      <PanelFootprintChooser
        index={INDEX}
        preselect="Resistor_SMD:R_0805"
        filter={{ pinCount: 3 }}
        onSelect={(id) => picked.push(id)}
        onChoose={() => {}}
      />,
    );
    expect(picked.filter(Boolean)).toEqual([]);
  });
});

describe('the frame builds a checkbox only when it can filter on something', () => {
  const frame = (props: Partial<React.ComponentProps<typeof FootprintChooserFrame>> = {}) =>
    render(
      <FootprintChooserFrame onOk={props.onOk ?? (() => {})} onCancel={() => {}} {...props} />,
    );

  it('shows neither checkbox for a symbol with no filters and no pin count', () => {
    // `else { if( m_filterByFPFilters ) …->Hide(); }` — hidden, not unticked.
    const { container } = frame();
    expect(container.querySelector('.ze-libtree-filters')).toBeNull();
  });

  it('shows the fp-filter checkbox, with the patterns in its label', () => {
    // `msg.Printf( _( "Apply footprint filters (%s)" ), strings[1] )`
    frame({ fpFilters: ['TerminalBlock*:*'] });
    expect(screen.getByText('Apply footprint filters (TerminalBlock*:*)')).toBeTruthy();
  });

  it('shows the pin-count checkbox, with the count in its label', () => {
    frame({ pinCount: 2 });
    expect(screen.getByText('Filter by pin count (2)')).toBeTruthy();
  });

  it('shows both when the symbol supplies both', () => {
    const { container } = frame({ fpFilters: ['tb_*'], pinCount: 2 });
    expect(container.querySelectorAll('.ze-libtree-filters .ze-check')).toHaveLength(2);
  });

  it('starts UNTICKED, which is what the setting defaults to', () => {
    // `pcbnew_settings.cpp:146-150` registers both as `PARAM<bool>( …, false )`,
    // so the chooser opens with the boxes present and off, showing the whole
    // library. Ours opened ticked and filtered the tree before being asked.
    const { container } = frame({ pinCount: 2 });
    const box = container.querySelector('.ze-libtree-filters input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect((container.querySelector('.ze-libtree-filters input') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('counts the whole library in the title, not what the filter left', async () => {
    // `SetTitle( … " (%d items loaded)" )` runs once in the constructor, before
    // any `Regenerate()`, so ticking a filter never moves the number. Ours
    // recomputed it per filter and dropped from 15 447 to 59.
    //
    // The index has to have ARRIVED for this to mean anything: with an empty
    // one the count is 0 before and after, and the case passes with the fix
    // removed. That is what the mock at the top of this file is for.
    const { container } = frame({ pinCount: 3, fpFilters: ['tb_*'] });
    const header = () => container.querySelector('.ze-modal-header')!.textContent;
    await waitFor(() => expect(header()).toContain('(4 items loaded)'));

    // Tick both filters; between them they leave one footprint of the four.
    for (const box of container.querySelectorAll('.ze-libtree-filters input')) {
      fireEvent.click(box);
    }
    await waitFor(() =>
      expect(container.querySelectorAll('.ze-libtree-filters input:checked')).toHaveLength(2),
    );
    expect(header()).toContain('(4 items loaded)');
  });

  it('leaves the fp-filter box unticked too, not just the pin-count one', async () => {
    // Two separate settings, two separate defaults - asserting only the
    // pin-count box left `use_fp_filters` free to default the other way.
    const { container } = frame({ fpFilters: ['tb_*'] });
    await waitFor(() =>
      expect(container.querySelectorAll('.ze-libtree-filters input')).toHaveLength(1),
    );
    const box = container.querySelector('.ze-libtree-filters input') as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('titles itself the way the frame does, with the loaded count', () => {
    const { container } = frame();
    expect(container.querySelector('.ze-modal-header')!.textContent).toContain(
      'Footprint Chooser (',
    );
    expect(container.querySelector('.ze-modal-header')!.textContent).toContain('items loaded)');
  });

  it('OK with nothing chosen cancels rather than writing an empty fpid', () => {
    // `if( !fpid.empty() ) … else DismissModal( false )`.
    const onOk = vi.fn();
    const onCancel = vi.fn();
    render(<FootprintChooserFrame onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onOk).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('OK leaves the field alone when the tree cannot confirm the preselection', () => {
    // The selection OK reads is the TREE's, not the string the caller passed
    // in: `SetPreselect` only takes effect once the tree holds that node. With
    // no library index reachable the tree holds nothing, so OK falls to
    // `DismissModal( false )` - which leaves the caller's Footprint field as it
    // was rather than writing back a footprint nobody picked and nothing could
    // verify. Worth pinning: the tempting shortcut is to seed OK from
    // `preselect` and hand it straight back.
    const onOk = vi.fn();
    const onCancel = vi.fn();
    render(<FootprintChooserFrame preselect="Lib:R_0603" onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onOk).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
