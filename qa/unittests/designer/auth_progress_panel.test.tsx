// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The sign-in progress panel takes no room in the form (auth_progress.tsx): nothing in it while no
 * stage runs, and the stage, when one does, hung below the form by CSS rather than in its flow. It
 * used to keep its space under an invisible copy of the longest stage, which left a hole between
 * the error and the button on every form, all the time.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_STAGE, AuthProgressPanel } from '@ziroeda/designer/src/auth/auth_progress.js';

afterEach(cleanup);

describe('AuthProgressPanel', () => {
  it('holds nothing while no stage runs', () => {
    const { container } = render(<AuthProgressPanel progress={null} />);
    expect(container.querySelector('.ze-auth-progress')!.children.length).toBe(0);
  });

  it('shows the running stage, its step and why it is there', () => {
    const { container } = render(
      <AuthProgressPanel
        progress={{ stage: AUTH_STAGE.secure, step: 1, steps: 3, startedAt: performance.now() }}
      />,
    );
    const panel = container.querySelector('.ze-auth-progress')!;
    expect(panel.children.length).toBe(1);
    expect(panel.textContent).toContain(AUTH_STAGE.secure.label);
    expect(panel.textContent).toContain('step 1 of 3');
    expect(panel.textContent).toContain(AUTH_STAGE.secure.why);
  });
});
