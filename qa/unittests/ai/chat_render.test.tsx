import { runningLabel, stepsSummary } from '@ziroeda/ai/chat_pane.js';
import { Markdown } from '@ziroeda/ai/markdown.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const html = (md: string) => renderToStaticMarkup(<Markdown text={md} />);

describe('the spec and replies render as GitHub Markdown', () => {
  it('tables, with a header row', () => {
    const out = html('| Ref | Part |\n|---|---|\n| R1 | 330 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>Ref</th>');
    expect(out).toContain('<td>330</td>');
  });

  it('nested lists, task lists and strikethrough', () => {
    const out = html('- Power\n  - USB-C 5 V\n- [x] spec\n- [ ] board\n\n~~old~~');
    expect(out).toMatch(/<li>Power\s*<ul>\s*<li>USB-C 5 V<\/li>/);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('<del>old</del>');
  });

  it('never renders markup the model wrote, and drops script links', () => {
    const out = html('<script>x</script>\n\n[a](javascript:alert(1)) [b](https://kicad.org)');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a href="https://kicad.org" target="_blank" rel="noreferrer">b</a>');
  });
});

describe('tool steps in the chat', () => {
  it('say what a tool is doing while it runs', () => {
    expect(runningLabel('read_schematic')).toBe('Reading the schematic');
    expect(runningLabel('view_board')).toBe('Looking at the board');
    expect(runningLabel('search_symbols')).toBe('Searching symbols');
    expect(runningLabel('run_erc')).toBe('Running ERC');
    expect(runningLabel('apply_zsch')).toBe('Apply zsch');
  });

  it('fold to a count, with failures called out', () => {
    expect(stepsSummary([{ label: 'a', state: 'done' }])).toBe('1 step');
    expect(
      stepsSummary([
        { label: 'a', state: 'done' },
        { label: 'b', state: 'error' },
        { label: 'c', state: 'done' },
      ]),
    ).toBe('3 steps · 1 failed');
  });
});
