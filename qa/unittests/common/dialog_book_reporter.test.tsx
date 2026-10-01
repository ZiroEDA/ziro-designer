// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_BOOK_REPORTER and WX_HTML_REPORT_BOX (common/), and the pages
 * BOARD_INSPECTION_TOOL writes into them (pcbnew's inspectPages).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogBookReporter } from '@ziroeda/common/dialogs/dialog_book_reporter_ui.js';
import { DIALOG_BOOK_REPORTER } from '@ziroeda/common/dialogs/dialog_book_reporter.js';
import { reportBoxHtml } from '@ziroeda/common/widgets/wx_html_report_box.js';
import { inspectPages, type InspectSection } from '@ziroeda/pcbnew';

afterEach(cleanup);

describe('WX_HTML_REPORT_BOX', () => {
  it('flushes each line behind generateHtml’s strut and a <br>', () => {
    expect(reportBoxHtml(['a', '<b>b</b>'])).toBe(
      '<span class="ze-report-strut"></span>a<br><span class="ze-report-strut"></span><b>b</b><br>',
    );
  });
});

describe('DIALOG_BOOK_REPORTER', () => {
  const pages = [
    { title: 'F.Cu', messages: ['<h7>Clearance resolution for:</h7>'] },
    { title: 'Hole', messages: ['<h7>Hole clearance resolution for:</h7>'] },
  ];

  it('is titled by the caller and shows one tab per AddHTMLPage, the first selected', () => {
    render(<DialogBookReporter title="Clearance Report" pages={pages} onClose={() => {}} />);
    expect(screen.getByText('Clearance Report')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['F.Cu', 'Hole']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('switches pages from the tabs', () => {
    render(<DialogBookReporter title="T" pages={pages} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Hole' }));
    expect(screen.getByRole('tab', { name: 'Hole' }).getAttribute('aria-selected')).toBe('true');
  });

  it('has OK and no Apply (m_sdbSizerApply->Hide())', () => {
    const onClose = vi.fn();
    render(<DialogBookReporter title="T" pages={pages} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('inspectPages (BOARD_INSPECTION_TOOL’s pages)', () => {
  const sec = (type: InspectSection['type'], title: string): InspectSection => ({
    type,
    title,
    subjects: ['Layer F.Cu', 'Track [<GND>] on F.Cu'],
    lines: ['Resolved clearance: 0.2 mm.'],
  });

  it('names a clearance page for its layer and shares the Zone page', () => {
    const pages = inspectPages(
      [
        sec('clearance', 'Clearance resolution for:'),
        sec('zone_connection', 'Zone connection resolution for:'),
        sec('thermal_relief_gap', 'Thermal-relief gap resolution for:'),
        sec('hole_clearance', 'Hole clearance resolution for:'),
        sec('physical_clearance', 'Physical clearance resolution for:'),
      ],
      'clearance',
      'F.Cu',
    );
    expect(pages.map((p) => p.title)).toEqual(['F.Cu', 'Zone', 'Hole', 'Physical Clearances']);
    expect(pages[1]!.messages.filter((m) => m.startsWith('<h7>'))).toHaveLength(2);
  });

  it('writes reportHeader’s <h7> and <ul>, and escapes the board’s text', () => {
    const [page] = inspectPages(
      [sec('clearance', 'Clearance resolution for:')],
      'clearance',
      'F.Cu',
    );
    expect(page!.messages[0]).toBe('<h7>Clearance resolution for:</h7>');
    expect(page!.messages[1]).toBe(
      '<ul><li>Layer F.Cu</li><li>Track [&lt;GND&gt;] on F.Cu</li></ul>',
    );
  });

  it('uses the constraints report’s captions for a single item', () => {
    const pages = inspectPages(
      [
        sec('track_width', 'Track width resolution for:'),
        sec('annular_width', 'Via annular width resolution for:'),
        sec('text_height', 'Text height resolution for:'),
        sec('text_thickness', 'Text thickness resolution for:'),
      ],
      'constraints',
      'F.Cu',
    );
    expect(pages.map((p) => p.title)).toEqual(['Track Width', 'Via Annular Width', 'Text Size']);
  });
});

describe('DIALOG_BOOK_REPORTER, the object a tool fills', () => {
  it('pages hold what was reported into them, in order', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    const r = dlg.AddHTMLPage('Clearance');
    r.report('a');
    r.report('b');
    dlg.AddHTMLPage('Physical');
    expect(dlg.GetPageCount()).toBe(2);
    expect(dlg.GetPages()).toEqual([
      { title: 'Clearance', messages: ['a', 'b'] },
      { title: 'Physical', messages: [] },
    ]);
  });

  it('DeleteAllPages empties the notebook', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    dlg.AddHTMLPage('One');
    dlg.DeleteAllPages();
    expect(dlg.GetPages()).toEqual([]);
  });

  it('Flush, a new page and Show each tell the window to redraw', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    let redraws = 0;
    const unsubscribe = dlg.Subscribe(() => redraws++);
    const r = dlg.AddHTMLPage('P');
    r.Flush();
    dlg.Show(true);
    expect(redraws).toBe(3);
    unsubscribe();
    dlg.Show(false);
    expect(redraws).toBe(3);
  });

  it('closing hides it and hands its name and button to the parent (EDA_EVT_CLOSE_...)', () => {
    const closed: [string, string][] = [];
    const dlg = new DIALOG_BOOK_REPORTER('InspectDrcErrorDialog', 'Violation Report', (n, id) =>
      closed.push([n, id]),
    );
    dlg.Show(true);
    dlg.OnClose();
    expect(dlg.IsShown()).toBe(false);
    expect(closed).toEqual([['InspectDrcErrorDialog', 'ok']]);
  });
});
