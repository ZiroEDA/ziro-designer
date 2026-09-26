// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/dialog_about/`: DIALOG_ABOUT, ABOUT_APP_INFO and ShowAboutDialog.
 *
 * The contributor counts are NOT read back from our code. They were counted in
 * KiCad 10.0.5's AboutDialog_main.cpp with grep, one pattern per kind
 * (`^\s*ADD_DEV\(`, `^\s*ADD_WRITER\(`, `^\s*ADD_TRANSLATOR\(`, the
 * `ADD_LIBRARIAN` lines plus the seven long-form `aInfo.AddLibrarian( new`
 * calls, `aInfo.AddArtist(`, `aInfo.AddPackager(`), and they sum to the 811
 * that `qa/probes/about_contributors_extract.py` reports transcribing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { svgUrl } from '@ziroeda/bitmaps_png';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { ABOUT_APP_INFO, CONTRIBUTOR } from '@ziroeda/common/dialog_about/aboutinfo.js';
import {
  IMAGES,
  contributorsHtml,
  createNotebooks,
  DIALOG_ABOUT,
} from '@ziroeda/common/dialog_about/dialog_about.js';
import { GetVersionInfoData } from '@ziroeda/common/build_version.js';
import { HtmlWindow } from '@ziroeda/common/widgets/html_window.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tabs = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '');
const visiblePanel = (): HTMLElement =>
  screen.getAllByRole('tabpanel', { hidden: true }).find((p) => !p.hasAttribute('data-nbhide'))!;
const liCount = (page: HTMLElement): number => page.querySelectorAll('li').length;

describe('ShowAboutDialog', () => {
  it('shows the nine pages in createNotebooks order', () => {
    render(<ShowAboutDialog title="ZiroEDA PCB Editor" onClose={() => {}} />);
    expect(tabs()).toEqual([
      'About',
      'Version',
      'Developers',
      'Doc Writers',
      'Librarians',
      'Artists',
      'Translators',
      'Packagers',
      'License',
    ]);
    // AddPage( .., false, .. ) never selects, so the first page added is shown.
    expect(screen.getAllByRole('tab')[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('titles itself "About <frame>" and names the frame in its header', () => {
    render(<ShowAboutDialog title="ZiroEDA PCB Editor" onClose={() => {}} />);
    expect(screen.getByText('About ZiroEDA PCB Editor')).toBeTruthy();
    expect(screen.getByText('ZiroEDA PCB Editor', { selector: '.ze-about-name' })).toBeTruthy();
    expect(screen.getByText(/^Version: .*, release build$/)).toBeTruthy();
  });

  it('lists every contributor KiCad 10.0.5 credits, page by page', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    const expected: Record<string, number> = {
      Developers: 432,
      'Doc Writers': 11,
      Librarians: 56,
      Artists: 4,
      Translators: 302,
      Packagers: 6,
    };
    for (const [caption, n] of Object.entries(expected)) {
      fireEvent.click(screen.getByRole('tab', { name: caption }));
      expect(liCount(visiblePanel()), caption).toBe(n);
    }
  });

  it('heads each category once, in first-appearance order', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Developers' }));
    const heads = [...visiblePanel().querySelectorAll('u')].map((u) => u.textContent);
    expect(heads).toEqual([
      'Lead Development Team:',
      'Lead Development Alumni:',
      'Additional Contributions By:',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Translators' }));
    // 39 languages, counted in the C++ as the distinct second arguments.
    expect(visiblePanel().querySelectorAll('u')).toHaveLength(39);
  });

  it('says whose credits the contributor pages are', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Developers' }));
    expect(visiblePanel().textContent).toContain('From the credits of KiCad 10.0.5');
  });

  it('links a contributor that has a URL, and only those', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Librarians' }));
    const links = [...visiblePanel().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toHaveLength(7);
    expect(links).toContain('https://github.com/easyw');
  });

  it('keeps the About and License pages unselectable (wxHW_NO_SELECTION) and the rest selectable', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    const noSelect = screen
      .getAllByRole('tabpanel', { hidden: true })
      .map((p) => p.querySelector('.ze-html-window')!.classList.contains('no-select'));
    expect(noSelect).toEqual([true, false, false, false, false, false, false, false, true]);
  });

  it('credits KiCad and both licences on the About page, and claims GPL on the License page', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    const about = visiblePanel().textContent ?? '';
    expect(about).toContain('The KiCad Developers');
    expect(about).toContain('KiCad Libraries Team');
    expect(about).toContain('GPL-3.0-or-later');
    expect(about).toContain('CC-BY-SA 4.0');
    expect(about).toContain('not affiliated with or endorsed by the KiCad project');
    fireEvent.click(screen.getByRole('tab', { name: 'License' }));
    expect(visiblePanel().textContent).toContain(
      'GNU General Public License (GPL) version 3 or any later version',
    );
  });

  it('draws an icon on every tab from the shared bitmap set', () => {
    for (const icon of Object.values(IMAGES)) {
      expect(svgUrl('toolbar', icon), icon).toBeTruthy();
    }
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('img')?.getAttribute('src')).toBeTruthy();
    }
  });

  it('pages with the strip arrows, which grey out at the ends', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    const prev = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getByRole('tab', { name: 'Version' }).getAttribute('aria-selected')).toBe('true');
    for (let i = 0; i < 10; i++) fireEvent.click(next);
    expect(screen.getByRole('tab', { name: 'License' }).getAttribute('aria-selected')).toBe('true');
    expect(next.disabled).toBe(true);
  });

  it('has no Donate button', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /donate/i })).toBeNull();
  });

  it('closes on OK', () => {
    const onClose = vi.fn();
    render(<ShowAboutDialog title="t" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DIALOG_ABOUT buttons', () => {
  const info = (): ABOUT_APP_INFO => new ABOUT_APP_INFO();

  it('Copy Version Info puts the plain-text version info on the clipboard and says Copied...', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <DIALOG_ABOUT info={info()} titleName="Frame" reportBug={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Version Info' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied...' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(GetVersionInfoData('Frame'));
  });

  it('a clipboard that refuses shows upstream\'s "Clipboard Error" box', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <DIALOG_ABOUT info={info()} titleName="Frame" reportBug={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Version Info' }));
    await waitFor(() => expect(screen.getByText('Clipboard Error')).toBeTruthy());
    expect(screen.getByText('Could not open clipboard to write version information.')).toBeTruthy();
  });

  it('Report Bug runs the report-bug action', () => {
    const reportBug = vi.fn();
    render(
      <DIALOG_ABOUT info={info()} titleName="Frame" reportBug={reportBug} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report Bug' }));
    expect(reportBug).toHaveBeenCalledTimes(1);
  });
});

describe('ABOUT_APP_INFO', () => {
  it('hands out CONTRIBUTORS by value, so a second rendering lists everyone again', () => {
    // SetChecked marks the copy the dialog was given. Were the getter to return
    // the stored array, the first rendering would check every row and the
    // second would list nobody.
    const i = new ABOUT_APP_INFO();
    i.AddDeveloper(new CONTRIBUTOR('A', 'Team'));
    i.AddDeveloper(new CONTRIBUTOR('B', 'Team'));
    expect(contributorsHtml(i.GetDevelopers())).toContain('<li>B</li>');
    expect(contributorsHtml(i.GetDevelopers())).toContain('<li>B</li>');
    expect(createNotebooks(i, 't')[2]!.html).toContain('<li>A</li>');
  });

  it('ignores a null contributor, as the Add* methods do', () => {
    const i = new ABOUT_APP_INFO();
    i.AddArtist(null);
    expect(i.GetArtists()).toHaveLength(0);
  });

  it('skips a contributor with no category (createNotebookPageByCategory)', () => {
    expect(contributorsHtml([new CONTRIBUTOR('Nobody', '')])).toBe('');
  });
});

describe('GetVersionInfoData', () => {
  it('uses <br> and &nbsp; indents for the page, newlines and tabs for the clipboard', () => {
    const html = GetVersionInfoData('Frame', true);
    const text = GetVersionInfoData('Frame');
    expect(html.startsWith('Application: Frame<br><br>Version: ')).toBe(true);
    expect(html).toContain('Libraries:<br>&nbsp;&nbsp;&nbsp;&nbsp;React ');
    expect(text.startsWith('Application: Frame\n\nVersion: ')).toBe(true);
    expect(text).toContain('Libraries:\n\tReact ');
    expect(text).toContain('Build Info:\n\tDate: ');
  });

  it('escapes what it did not write itself in the HTML form', () => {
    expect(GetVersionInfoData('<b>x</b>', true)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('leaves Build Info out of the brief form', () => {
    expect(GetVersionInfoData('Frame', false, true)).not.toContain('Build Info:');
  });
});

describe('every frame opens it', () => {
  // qa is the working directory; happy-dom's URL cannot resolve import.meta.url.
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), '..', rel), 'utf8');

  // EDA_BASE_FRAME's Help > About calls ShowAboutDialog( this ) in every frame.
  // Per frame, with its own title: a file-level "somebody imports it" check
  // would pass with one frame wired.
  const FRAMES: Record<string, string> = {
    'designer/src/home/HomePage.tsx': 'manager',
    'designer/src/editors/schematic/SchematicEditor.tsx': 'schematic',
    'designer/src/editors/pcb/PcbEditor.tsx': 'pcb',
    'designer/src/editors/symbol/SymbolEditor.tsx': 'symbol',
    'designer/src/editors/footprint/FootprintEditor.tsx': 'footprint',
    'designer/src/editors/gerbview/GerberViewer.tsx': 'gerbview',
    'designer/src/editors/drawingsheet/DrawingSheetEditor.tsx': 'drawingSheet',
    'designer/src/editors/pcb/Viewer3DFrame.tsx': 'viewer3d',
    'designer/src/editors/schematic/dialogs/dialog_assign_footprints.tsx': 'cvpcb',
    'designer/src/editors/calculator/CalculatorTools.tsx': 'calculator',
    'designer/src/editors/image/ImageConverter.tsx': 'imageConverter',
  };

  for (const [file, title] of Object.entries(FRAMES)) {
    it(`${file.split('/').pop()} shows it titled ABOUT_TITLES.${title}`, () => {
      expect(read(file)).toContain(`<ShowAboutDialog title={ABOUT_TITLES.${title}}`);
    });
  }

  it('the schematic answers the About action its Help menu sends', () => {
    const src = read('designer/src/editors/schematic/SchematicEditor.tsx');
    expect(read('designer/src/editors/schematic/menubar.ts')).toContain(
      "showAbout: () => h.action('about')",
    );
    expect(src).toMatch(/if \(id === 'about'\) \{\s*setAboutOpen\(true\);/);
  });
});

describe('the About page reads as the dialog, not a stub', () => {
  it('renders within a notebook frame', () => {
    render(<ShowAboutDialog title="t" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tablist')).toBeTruthy();
  });
});

describe('HTML_WINDOW', () => {
  it('sends a clicked link to the browser instead of following it in place', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<HtmlWindow html="<a href='https://example.test/x'>x</a>" />);
    const link = screen.getByRole('link', { name: 'x' });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.test/x', '_blank', 'noopener,noreferrer');
  });

  it('pops up Copy and Select All on a right click', () => {
    render(<HtmlWindow html="<p>text</p>" />);
    fireEvent.contextMenu(screen.getByText('text'));
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Select All')).toBeTruthy();
  });

  it('Ctrl+A selects the page, and does nothing under wxHW_NO_SELECTION', () => {
    const { unmount } = render(<HtmlWindow html="<p>alpha</p>" />);
    fireEvent.keyDown(screen.getByText('alpha').parentElement!, { key: 'a', ctrlKey: true });
    expect(window.getSelection()?.toString()).toContain('alpha');
    unmount();
    window.getSelection()?.removeAllRanges();
    render(<HtmlWindow html="<p>beta</p>" selectable={false} />);
    fireEvent.keyDown(screen.getByText('beta').parentElement!, { key: 'a', ctrlKey: true });
    expect(window.getSelection()?.toString()).toBe('');
  });
});
