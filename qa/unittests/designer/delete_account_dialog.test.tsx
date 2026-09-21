// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The delete-account dialog's gating, which is ente's: the summary has to
 * load before the checkbox can be ticked, the checkbox before the critical
 * button works, and the password step is the last thing before the provider
 * is asked - with the reason and trimmed feedback the first step collected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeleteAccountDialog } from '@ziroeda/designer/src/auth/DeleteAccountDialog.js';

afterEach(cleanup);

const fillReasonStep = async (feedback = '  no rigid-flex  ') => {
  // Pick "found another service" from the shared Combo.
  fireEvent.click(screen.getByRole('button', { name: 'Reason for leaving' }));
  fireEvent.mouseDown(screen.getByRole('option', { name: /another service/i }));
  fireEvent.change(screen.getByPlaceholderText('Share your feedback here'), {
    target: { value: feedback },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

describe('DeleteAccountDialog', () => {
  it('does not leave the reason step without a reason and feedback', () => {
    const onDelete = vi.fn();
    render(<DeleteAccountDialog email="a@x.test" onClose={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText(/Permanently delete/)).toBeNull();
  });

  it('keeps the checkbox disabled until the summary has loaded, and the button until it is ticked', async () => {
    let release: (s: { projects: number; people: number }) => void = () => {};
    const summary = new Promise<{ projects: number; people: number }>((r) => {
      release = r;
    });
    render(
      <DeleteAccountDialog
        email="a@x.test"
        onClose={() => {}}
        onDelete={vi.fn()}
        loadSummary={() => summary}
      />,
    );
    await fillReasonStep();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    const del = screen.getByRole('button', { name: 'Delete ZiroEDA account' }) as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(del.disabled).toBe(true);

    release({ projects: 3, people: 1 });
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(screen.getByText('3').parentElement?.textContent).toBe('3 projects');
    expect(screen.getByText('1').parentElement?.textContent).toBe('1 person loses access');
    expect(del.disabled).toBe(true);
    fireEvent.click(box);
    expect(del.disabled).toBe(false);
  });

  it('offers Try again when the summary fails, and stays locked', async () => {
    let attempts = 0;
    render(
      <DeleteAccountDialog
        email="a@x.test"
        onClose={() => {}}
        onDelete={vi.fn()}
        loadSummary={async () => {
          attempts++;
          if (attempts === 1) throw new Error('offline');
          return { projects: 0, people: 0 };
        }}
      />,
    );
    await fillReasonStep();
    await screen.findByText(/Couldn't load your data counts/);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false),
    );
  });

  it('asks for the password last, and hands the provider the reason and trimmed feedback', async () => {
    const onDelete = vi.fn(async () => ({ error: null }));
    render(
      <DeleteAccountDialog
        email="a@x.test"
        onClose={() => {}}
        onDelete={onDelete}
        loadSummary={async () => ({ projects: 1, people: 0 })}
      />,
    );
    await fillReasonStep();
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete ZiroEDA account' }));

    expect(screen.getByRole('dialog', { name: 'Delete account' }).querySelector('.ze-auth-title')?.textContent).toBe('Password');
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith('hunter22', 'found_another_service', 'no rigid-flex');
  });

  it('shows the provider\'s error (a wrong password) and stays open', async () => {
    const onDelete = vi.fn(async () => ({ error: 'Incorrect password or email not registered' }));
    render(
      <DeleteAccountDialog
        email="a@x.test"
        onClose={() => {}}
        onDelete={onDelete}
        loadSummary={async () => ({ projects: 1, people: 0 })}
      />,
    );
    await fillReasonStep();
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete ZiroEDA account' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));
    await screen.findByText('Incorrect password or email not registered');
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});
