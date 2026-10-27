// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The sign-up form sends once, and "Resend code" says it sent.
 *
 * Two presses of Enter in one frame both read `busy` false, so a sign-up went out twice: two
 * codes mailed, the first dead before it arrived. And "Resend code" answered nothing, so it
 * looked as if nothing happened, and the old code - replaced by the new one - was typed again.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  session: null,
  progress: null,
  keyState: 'none',
  recovering: false,
  pendingRecoveryKey: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  resendSignupCode: vi.fn(),
  acknowledgeRecoveryKey: vi.fn(),
  cancelRecovery: vi.fn(),
  requestPasswordReset: vi.fn(),
  completeRecovery: vi.fn(),
};

vi.mock('@ziroeda/designer/src/auth/AuthProvider.js', () => ({ useAuth: () => auth }));
vi.mock('@ziroeda/designer/src/auth/login_secret_cache.js', () => ({
  primeLoginSecret: () => {},
}));

const { SignInDialog } = await import('@ziroeda/designer/src/auth/SignIn.js');

beforeEach(() => {
  for (const f of Object.values(auth))
    if (typeof f === 'function') (f as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.setItem('ziro.pendingSignupEmail', 'a@b.c');
});
afterEach(cleanup);

describe('the code step', () => {
  it('sends a code once however fast Enter is pressed', async () => {
    let finish: (v: { error: string | null }) => void = () => {};
    auth.verifyOtp.mockReturnValue(new Promise((r) => (finish = r)));
    render(<SignInDialog gate step="verify" onStep={() => {}} />);
    const code = screen.getByRole('textbox');
    fireEvent.change(code, { target: { value: '123456' } });
    const form = code.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => finish({ error: null }));
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('says a new code is on its way once Resend code has sent one', async () => {
    auth.resendSignupCode.mockResolvedValue({ error: null });
    render(<SignInDialog gate step="verify" onStep={() => {}} />);
    expect(screen.queryByText(/A new code is on its way/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(screen.getByText(/A new code is on its way/)).toBeTruthy());
  });

  it('says nothing of the kind when the resend failed', async () => {
    auth.resendSignupCode.mockResolvedValue({ error: 'rate limited' });
    render(<SignInDialog gate step="verify" onStep={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(screen.getByText('rate limited')).toBeTruthy());
    expect(screen.queryByText(/A new code is on its way/)).toBeNull();
    // Nor once the error is gone: Confirm clears it while the code is checked.
    auth.verifyOtp.mockReturnValue(new Promise(() => {}));
    const code = screen.getByRole('textbox');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form')!);
    await waitFor(() => expect(screen.queryByText('rate limited')).toBeNull());
    expect(screen.queryByText(/A new code is on its way/)).toBeNull();
  });
});

describe('the sign-up step', () => {
  it('creates the account once however fast Enter is pressed', async () => {
    auth.signUp.mockReturnValue(new Promise(() => {}));
    render(<SignInDialog gate step="signup" onStep={() => {}} />);
    const strong = 'correct horse battery staple 42';
    const form = document.querySelector('form')!;
    fireEvent.change(form.querySelector('input[type=email]')!, { target: { value: 'a@b.c' } });
    for (const pw of form.querySelectorAll('input[type=password]'))
      fireEvent.change(pw, { target: { value: strong } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(auth.signUp).toHaveBeenCalled(), { timeout: 10000 });
    // Both presses have had their turn at the strength check by now.
    await new Promise((r) => setTimeout(r, 200));
    expect(auth.signUp).toHaveBeenCalledTimes(1);
  }, 20000);
});
