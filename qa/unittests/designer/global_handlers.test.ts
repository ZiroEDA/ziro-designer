// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Global error and unhandled-rejection reporting.
 *
 * The gap this closes: `captureError` was reached from the React error boundary
 * and nowhere else, and a boundary catches neither errors thrown in event
 * handlers nor anything asynchronous — which between them is nearly all of this
 * app. The rate limit is the part that needs the tests: a handler throwing on
 * every pointer move must not turn a bug into a flood.
 */
import { describe, it, expect } from 'vitest';
import { installGlobalErrorHandlers } from '@ziroeda/designer/src/telemetry/global_handlers.js';

interface Captured {
  err: unknown;
  ctx?: Record<string, string>;
}

function fakeWindow() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, e: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function harness(over: { maxPerWindow?: number; windowMs?: number } = {}) {
  const target = fakeWindow();
  const captured: Captured[] = [];
  let clock = 0;
  const dispose = installGlobalErrorHandlers({
    target,
    capture: (err, ctx) => captured.push({ err, ctx }),
    now: () => clock,
    maxPerWindow: over.maxPerWindow ?? 3,
    windowMs: over.windowMs ?? 1000,
  });
  return {
    target,
    captured,
    dispose,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** A distinct error each time, so de-duplication does not hide the rate limit. */
const distinct = (i: number): Error => new Error(`boom ${i}`);

describe('what gets reported at all', () => {
  it('reports a throw that never reaches a React boundary', () => {
    const h = harness();
    h.target.fire('error', { error: distinct(1), message: 'boom 1' });
    expect(h.captured).toHaveLength(1);
    expect(h.captured[0]!.ctx?.source).toBe('window.onerror');
  });

  it('reports an unhandled rejection', () => {
    const h = harness();
    h.target.fire('unhandledrejection', { reason: distinct(2) });
    expect(h.captured).toHaveLength(1);
    expect(h.captured[0]!.ctx?.source).toBe('unhandledrejection');
  });

  it('still reports an event carrying only a message', () => {
    // A cross-origin script error arrives with no `error` object at all.
    const h = harness();
    h.target.fire('error', { message: 'Script error.' });
    expect(h.captured).toHaveLength(1);
    expect(String((h.captured[0]!.err as Error).message)).toContain('Script error.');
  });

  it('reports a rejection whose reason is not an Error', () => {
    const h = harness();
    h.target.fire('unhandledrejection', { reason: 'plain string' });
    expect(h.captured).toHaveLength(1);
  });
});

describe('the rate limit', () => {
  it('collapses the same error repeating', () => {
    // A handler throwing on every pointer move is one fact, not a thousand.
    const h = harness();
    const err = new Error('same');
    for (let i = 0; i < 50; i++) h.target.fire('error', { error: err });
    expect(h.captured).toHaveLength(1);
  });

  it('caps distinct errors per window, and says once that it stopped', () => {
    const h = harness({ maxPerWindow: 3 });
    for (let i = 0; i < 20; i++) h.target.fire('error', { error: distinct(i) });
    // Three real reports, then exactly one note that reporting stopped.
    expect(h.captured).toHaveLength(4);
    expect(h.captured[3]!.ctx?.suppressed).toBe('true');
    expect(String((h.captured[3]!.err as Error).message)).toContain('rate limit');
  });

  it('recovers when the window rolls over', () => {
    // Silence must not be permanent: a burst at boot cannot blind the rest of
    // the session.
    const h = harness({ maxPerWindow: 3, windowMs: 1000 });
    for (let i = 0; i < 20; i++) h.target.fire('error', { error: distinct(i) });
    const before = h.captured.length;
    h.advance(1001);
    h.target.fire('error', { error: distinct(999) });
    expect(h.captured.length).toBe(before + 1);
    expect(h.captured.at(-1)!.ctx?.suppressed).toBeUndefined();
  });

  it('lets a collapsed error be reported again in the next window', () => {
    const h = harness({ windowMs: 1000 });
    const err = new Error('same');
    h.target.fire('error', { error: err });
    h.target.fire('error', { error: err });
    expect(h.captured).toHaveLength(1);
    h.advance(1001);
    h.target.fire('error', { error: err });
    expect(h.captured).toHaveLength(2);
  });
});

describe('reporting must never become the crash', () => {
  it('swallows a capture sink that throws', () => {
    const target = fakeWindow();
    installGlobalErrorHandlers({
      target,
      capture: () => {
        throw new Error('transport down');
      },
      now: () => 0,
    });
    expect(() => target.fire('error', { error: new Error('x') })).not.toThrow();
  });

  it('stops listening when disposed', () => {
    const h = harness();
    h.dispose();
    expect(h.target.count('error')).toBe(0);
    expect(h.target.count('unhandledrejection')).toBe(0);
    h.target.fire('error', { error: new Error('x') });
    expect(h.captured).toHaveLength(0);
  });
});

describe('the ResizeObserver loop notice', () => {
  it('is not reported: no error object, nothing failed', () => {
    const h = harness();
    h.target.fire('error', { message: 'ResizeObserver loop limit exceeded' });
    h.target.fire('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
    });
    expect(h.captured.length).toBe(0);
  });

  it('a thrown error that merely mentions it still is', () => {
    const h = harness();
    const err = new Error('ResizeObserver loop limit exceeded');
    h.target.fire('error', { error: err, message: err.message });
    h.target.fire('error', { message: 'Script error.' });
    expect(h.captured.map((c) => c.err)).toEqual([err, expect.any(Error)]);
  });
});

describe("a browser's own injected script", () => {
  const withStack = (aStack: string) => Object.assign(new Error('x'), { stack: aStack });
  const IAB = withStack(
    'Error: Error invoking postMessage: Java object is gone\n' +
      '    at sendDataToNative (iabjs://navigation_performance_logger_android:1:2120)\n' +
      '    at iabjs://navigation_performance_logger_android:1:2600',
  );

  it('an in-app browser logger failing is not reported', () => {
    const h = harness();
    h.target.fire('error', { error: IAB, message: IAB.message });
    h.target.fire('unhandledrejection', { reason: IAB });
    expect(h.captured.length).toBe(0);
  });

  it('every frame must be injected: one of ours keeps the report', () => {
    const reported = (aStack: string): boolean => {
      const h = harness();
      h.target.fire('unhandledrejection', { reason: withStack(aStack) });
      return h.captured.length === 1;
    };
    expect(reported('sendDataToNative@iabjs://logger:1:2120')).toBe(false);
    expect(
      reported('fn@moz-extension://abc/content.js:3:4\nfn@chrome-extension://def/x.js:1:1'),
    ).toBe(false);
    expect(
      reported(
        'Error: x\n    at ours (https://designer.ziroeda.com/assets/a.js:1:2)\n    at iabjs://x:1:2',
      ),
    ).toBe(true);
    expect(reported('Error: no frames at all')).toBe(true);
    const h = harness();
    h.target.fire('unhandledrejection', { reason: 'a string' });
    expect(h.captured.length).toBe(1);
  });

  it('a script injected into the page itself - a translator - is not reported (Sentry 13, 19, 1F)', () => {
    const reported = (aStack: string): boolean => {
      const h = harness();
      h.target.fire('error', { error: withStack(aStack), message: 'x' });
      return h.captured.length === 1;
    };
    // index.html has no inline script, so a frame at a page address is not ours: the th-TH and
    // ko-KR "Maximum call stack size exceeded" ran entirely at `/`.
    expect(
      reported(
        'RangeError: Maximum call stack size exceeded.\n' +
          '    at https://designer.ziroeda.com/:202:11\n' +
          '    at xk (https://designer.ziroeda.com/:230:88)\n' +
          '    at vk (https://designer.ziroeda.com/:230:140)',
      ),
    ).toBe(false);
    // Safari: the de-DE `strings[key]` beside an extension's masked script and native code.
    expect(
      reported(
        '@https://designer.ziroeda.com/p/abc/pcb:205:27\n' +
          '[native code]\n' +
          'h@webkit-masked-url://hidden/:72:356',
      ),
    ).toBe(false);
    // One frame in a chunk of ours keeps it, as does a dev module.
    expect(
      reported(
        'Error: x\n    at https://designer.ziroeda.com/:202:11\n' +
          '    at ours (https://designer.ziroeda.com/assets/index-DOU2pZqU.js:2:4)',
      ),
    ).toBe(true);
    expect(reported('fn@http://127.0.0.1:5199/@fs/home/x/pcbnew/board.ts?t=1:3:4')).toBe(true);
  });

  it("a fetch that failed inside an extension's fetch wrapper is not reported (Sentry 1S)", () => {
    const reported = (aMessage: string, aStack: string, aName = 'TypeError'): boolean => {
      const h = harness();
      const err = Object.assign(new Error(aMessage), { name: aName });
      err.stack = `${aName}: ${aMessage}\n${aStack}`;
      h.target.fire('unhandledrejection', { reason: err });
      return h.captured.length === 1;
    };
    const OURS = 'https://designer.ziroeda.com/assets/index-DOU2pZqU.js';
    // Innermost first: the SDK's fetch wrapper (bundled with ours), the extension's two frames,
    // then the usage counts' send() and the interval that called it.
    const THROUGH_EXTENSION =
      `    at ${OURS}:9:45\n` +
      '    at s.fetch (chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/libs/requests.js:1:3633)\n' +
      '    at chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/executors/200.js:1:26619\n' +
      `    at send (${OURS}:93:8)\n` +
      `    at ${OURS}:134:7`;
    expect(reported('Failed to fetch (us.i.posthog.com)', THROUGH_EXTENSION)).toBe(false);
    // Firefox and Safari word it their own way.
    expect(
      reported(
        'NetworkError when attempting to fetch resource.',
        `fetch@moz-extension://abc/wrap.js:1:2\nsend@${OURS}:93:8`,
      ),
    ).toBe(false);
    expect(
      reported('Load failed', `fetch@safari-web-extension://abc/w.js:1:2\nsend@${OURS}:93:8`),
    ).toBe(false);
    // With no extension in the way, a fetch of ours left uncaught is ours.
    expect(
      reported(
        'Failed to fetch (api.example.com)',
        `    at ${OURS}:9:45\n    at load (${OURS}:7:1)`,
      ),
    ).toBe(true);
    // An extension that only CALLED our code - it wraps a listener - leaves our failure ours.
    expect(
      reported(
        'Failed to fetch',
        `    at load (${OURS}:7:1)\n    at chrome-extension://abc/listener.js:1:2`,
      ),
    ).toBe(true);
    // Any other failure through the wrapper - our bad arguments - is still ours to see.
    expect(reported("Failed to execute 'fetch' on 'Window': Invalid URL", THROUGH_EXTENSION)).toBe(
      true,
    );
    expect(reported('Failed to fetch', THROUGH_EXTENSION, 'Error')).toBe(true);
  });

  it("an extension's own messaging failing is not reported (Sentry 1V)", () => {
    const reported = (aMessage: string, aStack?: string): boolean => {
      const h = harness();
      const err = new Error(aMessage);
      err.stack = aStack === undefined ? `Error: ${aMessage}` : `Error: ${aMessage}\n${aStack}`;
      h.target.fire('unhandledrejection', { reason: err });
      return h.captured.length === 1;
    };
    // No stack at all, as Sentry got it; and each engine's wording.
    expect(reported('Invalid call to runtime.sendMessage(). Tab not found.')).toBe(false);
    expect(reported('Could not establish connection. Receiving end does not exist.')).toBe(false);
    expect(reported('Extension context invalidated.')).toBe(false);
    expect(
      reported(
        'Invalid call to runtime.connect(). Tab not found.',
        '    at chrome-extension://abc/content.js:1:2',
      ),
    ).toBe(false);
    // A frame of ours in the stack keeps it; and another message with no stack is still ours.
    expect(
      reported(
        'Extension context invalidated.',
        '    at ours (https://designer.ziroeda.com/assets/index-DOU2pZqU.js:2:4)',
      ),
    ).toBe(true);
    expect(reported('Tab not found.')).toBe(true);
    expect(reported('runtime.sendMessage is not a function')).toBe(true);
  });

  it("a string the host app evaluates in the page is not reported (Sentry 1P, Zalo's webview)", () => {
    const reported = (aStack: string): boolean => {
      const h = harness();
      h.target.fire('error', { error: withStack(aStack), message: 'x' });
      return h.captured.length === 1;
    };
    // An Android WebView's evaluateJavascript: the only frame has no file.
    expect(reported('ReferenceError: zaloJSV2 is not defined\n    at <anonymous>:1:1')).toBe(false);
    expect(
      reported(
        'ReferenceError: x is not defined\n    at f (<anonymous>:3:9)\n    at <anonymous>:1:1',
      ),
    ).toBe(false);
    // A built-in on its own names no position, and is not one; nor is a stack with a frame of
    // ours under the evaluated one.
    expect(reported('TypeError: x\n    at Array.map (<anonymous>)')).toBe(true);
    expect(reported('TypeError: x\n    at JSON.parse (<anonymous>)\n    at <anonymous>:1:1')).toBe(
      true,
    );
    expect(
      reported(
        'Error: x\n    at <anonymous>:1:1\n' +
          '    at ours (https://designer.ziroeda.com/assets/index-DOU2pZqU.js:2:4)',
      ),
    ).toBe(true);
  });
});
