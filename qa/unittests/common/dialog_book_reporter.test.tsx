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

describe('AddBlankPage: a panel the caller fills (reportClearance, :1240-1302)', () => {
  it('stacks the label, the choice and the report box in the order they were added', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    const panel = dlg.AddBlankPage('Clearance');
    panel.AddStaticText('Layer:');
    const choice = panel.AddChoice();
    choice.Append('F.Cu');
    choice.Append('B.Cu');
    choice.SetSelection(0);
    const box = panel.AddReportBox();
    box.report('on F.Cu');
    const [page] = dlg.GetPages();
    expect(page!.title).toBe('Clearance');
    expect(page!.panel!.map((i) => i.kind)).toEqual(['text', 'choice', 'report']);
    expect(page!.panel![1]).toMatchObject({ items: ['F.Cu', 'B.Cu'], selection: 0 });
    expect(page!.panel![2]).toMatchObject({ messages: ['on F.Cu'] });
  });

  it('a pick sets the choice, then runs its wxEVT_CHOICE handler', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    const panel = dlg.AddBlankPage('Clearance');
    const choice = panel.AddChoice();
    choice.Append('F.Cu');
    choice.Append('B.Cu');
    const seen: [number, number][] = [];
    choice.Bind((sel) => seen.push([sel, choice.GetSelection()]));
    const item = dlg.GetPages()[0]!.panel![0]!;
    if (item.kind !== 'choice') throw new Error('choice');
    item.select(1);
    expect(seen).toEqual([[1, 1]]);
  });

  it('draws the panel: the label, a Combo of the strings, and the report', () => {
    const dlg = new DIALOG_BOOK_REPORTER('N', 'T');
    const panel = dlg.AddBlankPage('Clearance');
    panel.AddStaticText('Layer:');
    const choice = panel.AddChoice();
    choice.Append('F.Cu');
    choice.SetSelection(0);
    panel.AddReportBox().report('resolved');
    render(<DialogBookReporter title="T" pages={dlg.GetPages()} onClose={() => {}} />);
    expect(screen.getByText('Layer:')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'F.Cu' })).toBeTruthy();
    expect(screen.getByText('resolved')).toBeTruthy();
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
