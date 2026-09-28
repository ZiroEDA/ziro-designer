// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * COMMON_CONTROL (`common/tool/common_control.cpp`): each action it answers,
 * run the way a menu row runs it - through the frame's TOOL_MANAGER - and what
 * each handler asks of the frame and of the program's KIWAY.
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { onShowHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { KIWAY, type KIWAY_PROGRAM } from '@ziroeda/common/kiway.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  COMMON_CONTROL,
  REPORT_BUG_URL,
  URL_DOCUMENTATION,
  URL_GET_INVOLVED,
  URL_GETTING_STARTED,
} from '@ziroeda/common/tool/common_control.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { gerbIUScale } from '@ziroeda/common/eda_units.js';

class TEST_FRAME extends EDA_BASE_FRAME {
  constructor() {
    super(FRAME_T.FRAME_GERBER, gerbIUScale, 'mm');
    this.m_aboutTitle = 'KiCad Test Frame';
  }
}

interface Env {
  frame: TEST_FRAME;
  run: (a: TOOL_ACTION) => void;
  prefs: [string, string][];
  about: string[];
  calls: string[];
  opened: string[];
}

function setup(aKiway: Partial<KIWAY_PROGRAM> = {}): Env {
  const frame = new TEST_FRAME();
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(null, null, null, null as never, frame);
  mgr.RegisterTool(new COMMON_CONTROL());
  mgr.InitTools();

  const env: Env = {
    frame,
    run: (a) => {
      mgr.RunAction(a);
    },
    prefs: [],
    about: [],
    calls: [],
    opened: [],
  };

  frame.SetPreferencesPresenter((p, pp) => env.prefs.push([p, pp]));
  frame.SetAboutPresenter((t) => env.about.push(t));
  frame.SetKiway(
    new KIWAY({
      OnKiCadExit: () => env.calls.push('exit'),
      Player: (t) => {
        env.calls.push(`player ${FRAME_T[t]}`);
        return true;
      },
      HasProjectManager: () => true,
      ShowProjectManager: () => env.calls.push('project manager'),
      CreateKiWindow: (t) => {
        env.calls.push(`kiwindow ${FRAME_T[t]}`);
        return true;
      },
      ...aKiway,
    }),
  );

  return env;
}

let openSpy: { mockRestore(): void };
let opened: string[];

beforeEach(() => {
  opened = [];
  openSpy = vi.spyOn(window, 'open').mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
});

afterEach(() => openSpy.mockRestore());

describe('COMMON_CONTROL', () => {
  it('is the tool upstream names common.SuiteControl', () => {
    expect(new COMMON_CONTROL().GetName()).toBe('common.SuiteControl');
  });

  it('OpenPreferences: ShowPreferences( wxEmptyString, wxEmptyString )', () => {
    const env = setup();
    env.run(ACTIONS.openPreferences);
    expect(env.prefs).toEqual([['', '']]);
  });

  it('About: ShowAboutDialog( m_frame ), titled with the frame m_aboutTitle', () => {
    const env = setup();
    env.run(ACTIONS.about);
    expect(env.about).toEqual(['KiCad Test Frame']);
  });

  it('ListHotKeys: DisplayHotkeyList( m_frame )', () => {
    const env = setup();
    let shown = 0;
    const off = onShowHotkeyList(() => shown++);
    env.run(ACTIONS.listHotKeys);
    off();
    expect(shown).toBe(1);
  });

  it('Quit: Kiway().OnKiCadExit(), after the event (CallAfter)', async () => {
    const env = setup();
    env.run(ACTIONS.quit);
    expect(env.calls).toEqual([]);
    await Promise.resolve();
    expect(env.calls).toEqual(['exit']);
  });

  it('ShowPlayer: Kiway().Player( the action parameter )', () => {
    const env = setup();
    env.run(ACTIONS.showSymbolEditor);
    env.run(ACTIONS.showFootprintEditor);
    env.run(ACTIONS.showSymbolBrowser);
    env.run(ACTIONS.showFootprintBrowser);
    expect(env.calls).toEqual([
      'player FRAME_SCH_SYMBOL_EDITOR',
      'player FRAME_FOOTPRINT_EDITOR',
      'player FRAME_SCH_VIEWER',
      'player FRAME_FOOTPRINT_VIEWER',
    ]);
  });

  it('Execute: the calculator, which is a player here', () => {
    const env = setup();
    env.run(ACTIONS.showCalculatorTools);
    expect(env.calls).toEqual(['player FRAME_CALC']);
  });

  it('ShowLibraryTable / ConfigurePaths: the owning kiface raises the dialog', () => {
    const env = setup();
    env.run(ACTIONS.showSymbolLibTable);
    env.run(ACTIONS.showFootprintLibTable);
    env.run(ACTIONS.showDesignBlockLibTable);
    env.run(ACTIONS.configurePaths);
    expect(env.calls).toEqual([
      'kiwindow DIALOG_SCH_LIBRARY_TABLE',
      'kiwindow DIALOG_PCB_LIBRARY_TABLE',
      'kiwindow DIALOG_DESIGN_BLOCK_LIBRARY_TABLE',
      'kiwindow DIALOG_CONFIGUREPATHS',
    ]);
  });

  it('ShowProjectManager: raises the top frame when there is one', () => {
    const env = setup();
    env.run(ACTIONS.showProjectManager);
    expect(env.calls).toEqual(['project manager']);
  });

  it('ShowProjectManager: does not raise anything in stand-alone mode', () => {
    const env = setup({ HasProjectManager: () => false });
    env.run(ACTIONS.showProjectManager);
    expect(env.calls).toEqual([]);
  });

  it('ShowHelp: the handbook, and the getting-started guide', () => {
    const env = setup();
    env.run(ACTIONS.help);
    env.run(ACTIONS.gettingStarted);
    expect(opened).toEqual([URL_DOCUMENTATION, URL_GETTING_STARTED]);
  });

  it('GetInvolved: the project page', () => {
    const env = setup();
    env.run(ACTIONS.getInvolved);
    expect(opened).toEqual([URL_GET_INVOLVED]);
  });

  it('ReportBug: a new issue, its body the version info in a code fence', () => {
    const env = setup();
    env.run(ACTIONS.reportBug);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(`${REPORT_BUG_URL}/new`);
    const body = url.searchParams.get('body')!;
    expect(body.startsWith('```\nApplication: KiCad Test Frame\n')).toBe(true);
    expect(body.endsWith('\n```')).toBe(true);
  });
});
