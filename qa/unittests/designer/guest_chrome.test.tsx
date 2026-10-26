// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The chrome a signed-out person sees, now that an account is optional
 * (auth/explore.ts): the account button's menu, the Help menu's Support Chat
 * row, and the tooltip that has to stay on screen for the status-bar shield.
 * Asserted as rendered, in order - the order is what was asked for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { AccountButton } from '@ziroeda/designer/src/ui/AccountButton.js';
import { EncryptedIcon, ENCRYPTED_TIP } from '@ziroeda/designer/src/ui/EncryptedIcon.js';
import {
  setSupportChatOpener,
  standardHelpMenu,
} from '@ziroeda/common/eda_base_frame_help_menu.js';
import { TooltipLayer } from '@ziroeda/common/widgets/tooltip.js';

afterEach(() => {
  cleanup();
  setSupportChatOpener(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const menuLabels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.ze-account-menu .ze-mitem .lbl')].map((e) => e.textContent ?? '');

describe('the account button, signed out', () => {
  it('is a ring with the guest class, and its menu is GitHub, Discord chat, Sign in', () => {
    const { container } = render(
      <AccountButton
        email={null}
        onSignIn={() => {}}
        chatUrl="https://chat.example/"
        sourceUrl="https://src.example/"
      />,
    );
    const button = container.querySelector('.ze-account-avatar') as HTMLElement;
    expect(button.className).toBe('ze-account-avatar guest');
    fireEvent.click(button);
    expect(menuLabels(container)).toEqual(['GitHub', 'Discord chat', 'Sign in']);
  });

  it('draws a glyph in the icon column of every row', () => {
    const { container } = render(
      <AccountButton
        email={null}
        onSignIn={() => {}}
        chatUrl="https://chat.example/"
        sourceUrl="https://src.example/"
      />,
    );
    fireEvent.click(container.querySelector('.ze-account-avatar') as HTMLElement);
    const rows = [...container.querySelectorAll('.ze-account-menu .ze-mitem')];
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.querySelector('.mico > svg')).not.toBeNull();
  });

  it('opens the repository from the GitHub row, and sign-in from Sign in', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const signIn = vi.fn();
    const { container, getByText } = render(
      <AccountButton
        email={null}
        onSignIn={signIn}
        chatUrl="https://chat.example/"
        sourceUrl="https://src.example/"
      />,
    );
    fireEvent.click(container.querySelector('.ze-account-avatar') as HTMLElement);
    fireEvent.click(getByText('GitHub'));
    expect(open).toHaveBeenCalledWith('https://src.example/', '_blank', 'noopener');
    fireEvent.click(container.querySelector('.ze-account-avatar') as HTMLElement);
    fireEvent.click(getByText('Sign in'));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('draws no Sign in row in a build with nothing to sign in to', () => {
    const { container } = render(<AccountButton email={null} chatUrl="https://chat.example/" />);
    fireEvent.click(container.querySelector('.ze-account-avatar') as HTMLElement);
    expect(menuLabels(container)).toEqual(['Discord chat']);
  });
});

describe('the account button, signed in', () => {
  it('keeps the account rows first and the links after them', () => {
    const { container } = render(
      <AccountButton
        email="a@b.example"
        onSignOut={() => {}}
        chatUrl="https://chat.example/"
        sourceUrl="https://src.example/"
      />,
    );
    const button = container.querySelector('.ze-account-avatar') as HTMLElement;
    expect(button.className).toBe('ze-account-avatar');
    fireEvent.click(button);
    expect(menuLabels(container)).toEqual(['a@b.example', 'Sign out', 'GitHub', 'Discord chat']);
  });
});

describe('Help > Support Chat', () => {
  const labels = (): string[] =>
    standardHelpMenu({ showHotkeys: () => {}, showAbout: () => {} }).items.map((i) =>
      'sep' in i ? '-' : (i as { label: string }).label,
    );

  it('is not drawn while no chat has registered', () => {
    expect(labels()).not.toContain('Support Chat');
  });

  it('follows Report Bug once a chat registers, and runs its opener', () => {
    const show = vi.fn();
    setSupportChatOpener(show);
    const l = labels();
    expect(l.slice(l.indexOf('Report Bug'), l.indexOf('Report Bug') + 3)).toEqual([
      'Report Bug',
      'Support Chat',
      '-',
    ]);
    const row = standardHelpMenu({ showHotkeys: () => {}, showAbout: () => {} }).items.find(
      (i) => (i as { label?: string }).label === 'Support Chat',
    ) as { action: () => void };
    row.action();
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('the tooltip at the foot of the window', () => {
  it("goes ABOVE an element with no room below it, as the shield's does", () => {
    vi.useFakeTimers();
    const H = window.innerHeight;
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    const { container } = render(
      <>
        <EncryptedIcon />
        <TooltipLayer />
      </>,
    );
    const shield = container.querySelector('.ze-encrypted-icon') as HTMLElement;
    expect(shield.getAttribute('data-tip')).toBe(ENCRYPTED_TIP);
    vi.spyOn(shield, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      right: 520,
      top: H - 21,
      bottom: H - 2,
      width: 20,
      height: 19,
      x: 500,
      y: H - 21,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseOver(shield);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const tip = document.querySelector('.ze-tooltip') as HTMLElement;
    expect(tip.textContent).toBe(ENCRYPTED_TIP);
    // Its bottom sits 6px over the shield's top: (H - 21) - 6 - 40.
    expect(tip.style.top).toBe(`${H - 21 - 6 - 40}px`);
  });

  it('stays below an element that has room under it', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    const { container } = render(
      <>
        <span data-tip="Up top">x</span>
        <TooltipLayer />
      </>,
    );
    const el = container.querySelector('[data-tip]') as HTMLElement;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      right: 520,
      top: 100,
      bottom: 120,
      width: 20,
      height: 20,
      x: 500,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect((document.querySelector('.ze-tooltip') as HTMLElement).style.top).toBe('126px');
  });
});
