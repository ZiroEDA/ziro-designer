// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TEXT_CTRL_EVAL` (common/widgets/text_ctrl_eval.cpp): evaluate on focus
 * loss, leave a bad expression as typed, and Enter evaluates then accepts.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TextCtrlEval, textCtrlEvaluate } from '@ziroeda/common/widgets/text_ctrl_eval.js';

afterEach(cleanup);

function Host({ initial, onEnter }: { initial: string; onEnter?: () => void }) {
  const [v, setV] = useState(initial);
  return <TextCtrlEval ariaLabel="n" value={v} onChange={setV} onEnter={onEnter} />;
}

describe('TEXT_CTRL_EVAL', () => {
  it('evaluate() replaces an expression with its result, and leaves garbage alone', () => {
    expect(textCtrlEvaluate('3*4')).toBe('12');
    expect(textCtrlEvaluate('2+')).toBe('2+');
  });

  it('evaluates on kill focus', () => {
    const { getByLabelText } = render(<Host initial="" />);
    const box = getByLabelText('n') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '10/4' } });
    fireEvent.blur(box);
    expect(box.value).toBe('2.5');
  });

  it('Enter evaluates, then posts OK', () => {
    let ok = 0;
    const { getByLabelText } = render(<Host initial="" onEnter={() => ok++} />);
    const box = getByLabelText('n') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '1+1' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('2');
    expect(ok).toBe(1);
  });
});
