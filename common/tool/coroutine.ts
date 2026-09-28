// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COROUTINE<ReturnType, ArgType>` (include/tool/coroutine.h): the execution
 * context a tool's state handler runs in, which the TOOL_MANAGER suspends
 * (`KiYield`) while the handler waits for an event and resumes when one
 * arrives.
 *
 * The C++ is a stackful coroutine on libcontext: a handler is a plain
 * function that calls `Wait()` anywhere down its call chain. A JavaScript
 * generator is stackless, so a handler is a generator function and every
 * call on the way to a `Wait()` is a `yield*` — `yield` is the C++'s
 * `KiYield()`. That is the one transformation the tool ports make; the
 * manager's protocol (`Call`, `Resume`, `Running`, `ReturnValue`) is the same.
 */

/** The generator a coroutine runs: yields at each KiYield, returns the handler's result. */
export type COROUTINE_BODY<ReturnType> = Generator<void, ReturnType, void>;

/** A handler: takes the event, gives the generator that runs on it. */
export type COROUTINE_FUNC<ReturnType, ArgType> = (aArg: ArgType) => COROUTINE_BODY<ReturnType>;

export class COROUTINE<ReturnType, ArgType> {
  private m_func: COROUTINE_FUNC<ReturnType, ArgType>;
  private m_body: COROUTINE_BODY<ReturnType> | null = null;
  private m_running = false;
  private m_retVal!: ReturnType;

  constructor(aEntry: COROUTINE_FUNC<ReturnType, ArgType>) {
    this.m_func = aEntry;
  }

  /**
   * Run a functor inside the application main stack context. Call this function
   * if the caller may yield and the functor needs to run outside the coroutine: here
   * there is one stack, so the functor runs where it is called.
   */
  RunMainStack(func: () => void): void {
    func();
  }

  /**
   * Start execution of a coroutine, passing args as its arguments.
   *
   * @return true, if the coroutine has yielded and false if it has finished its
   * execution (returned).
   */
  Call(aArg: ArgType): boolean {
    console.assert(this.m_body === null, 'COROUTINE::Call: already called');
    this.m_body = this.m_func(aArg);
    this.m_running = true;
    return this.step();
  }

  /**
   * Resume execution of a previously yielded coroutine.
   *
   * @return true, if the coroutine has yielded again and false if it has finished its
   * execution (returned).
   */
  Resume(): boolean {
    console.assert(this.m_body !== null && this.m_running, 'COROUTINE::Resume: not running');
    return this.step();
  }

  /**
   * Return the yielded value (the argument KiYield() was called with).
   */
  ReturnValue(): ReturnType {
    return this.m_retVal;
  }

  /**
   * @return true, if the coroutine is active.
   */
  Running(): boolean {
    return this.m_running;
  }

  private step(): boolean {
    const r = this.m_body!.next();

    if (r.done) {
      this.m_retVal = r.value;
      this.m_running = false;
    }

    return this.m_running;
  }
}
