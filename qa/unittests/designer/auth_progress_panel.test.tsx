// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The sign-in progress panel keeps its space whether a stage runs or not (auth_progress.tsx): the
 * form is centred, so a panel that came and went, or grew and shrank between stages, moved the
 * email and password up and down with it. An invisible copy of the longest stage holds the space.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_STAGE, AuthProgressPanel } from '@ziroeda/designer/src/auth/auth_progress.js';

afterEach(cleanup);

const longest = Object.values(AUTH_STAGE).reduce((a, b) =>
  b.why.length + b.label.length > a.why.length + a.label.length ? b : a,
);

describe('AuthProgressPanel', () => {
  it('holds the longest stage hidden while nothing runs, and shows nothing else', () => {
    const { container } = render(<AuthProgressPanel progress={null} />);
    const template = container.querySelector('.ze-auth-progress > .ze-size-template');
    expect(template?.textContent).toContain(longest.why);
    expect(container.querySelector('.ze-auth-progress')!.children.length).toBe(1);
  });

  it('keeps the same template under a running stage, the stage drawn over it', () => {
    const { container } = render(
      <AuthProgressPanel
        progress={{ stage: AUTH_STAGE.secure, step: 1, steps: 3, startedAt: performance.now() }}
      />,
    );
    const panel = container.querySelector('.ze-auth-progress')!;
    expect(panel.children[0]!.className).toBe('ze-size-template');
    expect(panel.children[0]!.textContent).toContain(longest.why);
    expect(panel.children[1]!.textContent).toContain(AUTH_STAGE.secure.why);
  });
});
