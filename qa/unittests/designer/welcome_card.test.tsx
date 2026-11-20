// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The project manager's welcome card (designer/src/home/WelcomeCard.tsx): the three ways in
 * while no project is open, each reported to the anonymous usage counts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_DEMOS, WelcomeCard } from '@ziroeda/designer/src/home/WelcomeCard.js';
import { SetUsageListener } from '@ziroeda/common/usage_hooks.js';
import { UsageEvents } from '@ziroeda/designer/src/telemetry/usage_events.js';

let heard: string[] = [];
beforeEach(() => {
  heard = [];
  SetUsageListener((e, p) => heard.push(`${e}:${p.action}`));
});
afterEach(() => {
  cleanup();
  SetUsageListener(null);
});

const handlers = () => ({
  onDemo: vi.fn(),
  onOpenProject: vi.fn(),
  onOpenZip: vi.fn(),
  onOpenGithub: vi.fn(),
  onNewProject: vi.fn(),
});

describe('the welcome card', () => {
  it('offers only the featured boards the demo list has, each with its picture', () => {
    render(
      <WelcomeCard available={new Set(['stickhub', 'cm5_minima', 'ecc83'])} {...handlers()} />,
    );
    expect(screen.queryByText('OpenAir Max')).toBeNull();
    expect(screen.getByText('StickHub')).toBeTruthy();
    expect(screen.getByText('CM5 Minima')).toBeTruthy();
    const imgs = [...document.querySelectorAll('.ze-welcome-demo img')].map((i) =>
      i.getAttribute('src'),
    );
    expect(imgs).toEqual(['/welcome/stickhub.webp', '/welcome/cm5_minima.webp']);
  });

  it('with no demo list yet, still offers opening and starting a project', () => {
    render(<WelcomeCard available={new Set()} {...handlers()} />);
    expect(screen.queryByText('Try a demo board')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Project...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Project...' })).toBeTruthy();
  });

  it('each way in runs its action and is reported; the card itself once', () => {
    const h = handlers();
    render(<WelcomeCard available={new Set(WELCOME_DEMOS.map((d) => d.id))} {...h} />);
    fireEvent.click(screen.getByText('StickHub'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Project...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open a .zip...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open from GitHub...' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Project...' }));
    expect(h.onDemo).toHaveBeenCalledWith('stickhub');
    for (const f of [h.onOpenProject, h.onOpenZip, h.onOpenGithub, h.onNewProject])
      expect(f).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([
      'welcome:shown',
      'welcome:demo:stickhub',
      'welcome:open',
      'welcome:zip',
      'welcome:github',
      'welcome:new',
    ]);
  });
});

describe('a demo board is a link to its own address', () => {
  it("points at the demo in the PCB editor; a plain click opens it here, a Ctrl-click is the browser's", () => {
    const h = handlers();
    render(<WelcomeCard available={new Set(['stickhub'])} {...h} />);
    const link = screen.getByRole('link', { name: /StickHub/ });
    expect(link.getAttribute('href')).toBe('/demo/stickhub/pcb');
    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ctrl);
    expect(h.onDemo).not.toHaveBeenCalled();
    expect(ctrl.defaultPrevented).toBe(false);
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(plain);
    expect(h.onDemo).toHaveBeenCalledWith('stickhub');
    expect(plain.defaultPrevented).toBe(true);
  });
});

describe('welcome_card in the usage counts', () => {
  it('counts the card once per page load and every way in each time', () => {
    const sent: string[] = [];
    const events = new UsageEvents(
      (e, p) => sent.push(`${e}:${p.action}`),
      () => 0,
    );
    for (const a of ['shown', 'shown', 'demo:stickhub', 'open', 'open'])
      events.onCommonEvent('welcome', { action: a });
    expect(sent).toEqual([
      'welcome_card:shown',
      'welcome_card:demo:stickhub',
      'welcome_card:open',
      'welcome_card:open',
    ]);
  });
});

describe('the project manager shows it only with no project open', () => {
  const HOME = readFileSync(join(__dirname, '../../../designer/src/home/HomePage.tsx'), 'utf8');

  it('renders the card behind !picked, above the tiles, and lets the pane scroll', () => {
    const at = HOME.indexOf('<WelcomeCard');
    expect(at).toBeGreaterThan(0);
    expect(HOME.slice(at - 40, at)).toMatch(/\{!picked && \(\s*$/);
    expect(HOME.indexOf('<div className="ze-tiles">')).toBeGreaterThan(at);
    expect(HOME).toMatch(/picked \? 'ze-launchers' : 'ze-launchers ze-launchers-welcome'/);
    // a demo opens straight into the PCB editor
    expect(HOME.slice(at, at + 400)).toMatch(
      /onDemo=\{\(id\) => void openDemoProject\(id, 'pcb'\)\}/,
    );
  });
});
