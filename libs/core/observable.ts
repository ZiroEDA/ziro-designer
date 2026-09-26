// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/core/include/core/observable.h` + `observable.cpp`: a model subscriber
 * implementation using links to represent connections. Subscribers can be
 * removed during notification.
 */

class IMPL<O> {
  observers_: (O | null)[] = [];
  iteration_count_ = 0;
  owned_by_: OBSERVABLE_BASE<O> | null;

  constructor(owned_by: OBSERVABLE_BASE<O> | null = null) {
    this.owned_by_ = owned_by;
  }

  is_shared(): boolean {
    return this.owned_by_ === null;
  }

  set_shared(): void {
    this.owned_by_ = null;
  }

  enter_iteration(): void {
    ++this.iteration_count_;
  }

  leave_iteration(): void {
    --this.iteration_count_;

    if (this.iteration_count_ === 0) this.collect();
  }

  is_iterating(): boolean {
    return this.iteration_count_ !== 0;
  }

  add_observer(observer: O): void {
    console.assert(!this.is_iterating());
    this.observers_.push(observer);
  }

  remove_observer(observer: O): void {
    const it = this.observers_.indexOf(observer);

    if (it === -1) {
      console.assert(false);
      return;
    }

    if (this.is_iterating()) this.observers_[it] = null;
    else this.observers_.splice(it, 1);
  }

  collect(): void {
    this.observers_ = this.observers_.filter((o) => o !== null);
  }
}

/**
 * Simple RAII-handle to a subscription.
 */
export class LINK<O = unknown> {
  private token_: IMPL<O> | null;
  private observer_: O | null;

  constructor(token: IMPL<O> | null = null, observer: O | null = null) {
    this.token_ = token;
    this.observer_ = observer;
  }

  reset(): void {
    if (this.token_ && this.observer_ !== null) {
      this.token_.remove_observer(this.observer_);
      this.token_ = null;
    }
  }

  valid(): boolean {
    return this.token_ !== null;
  }
}

class OBSERVABLE_BASE<O> {
  protected impl_: IMPL<O> | null = null;

  constructor(other?: OBSERVABLE_BASE<O>) {
    if (other) this.impl_ = other.get_shared_impl();
  }

  size(): number {
    return this.impl_ ? this.impl_.observers_.length : 0;
  }

  private allocate_impl(): void {
    if (!this.impl_) this.impl_ = new IMPL<O>(this);
  }

  private allocate_shared_impl(): void {
    if (!this.impl_) this.impl_ = new IMPL<O>();
    else this.impl_.set_shared();
  }

  protected get_shared_impl(): IMPL<O> {
    this.allocate_shared_impl();
    return this.impl_ as IMPL<O>;
  }

  protected on_observers_empty(): void {
    // called by an impl that is going away; nothing to do here
  }

  protected enter_iteration(): void {
    if (this.impl_) this.impl_.enter_iteration();
  }

  protected leave_iteration(): void {
    if (this.impl_) this.impl_.leave_iteration();
  }

  protected add_observer(observer: O): void {
    this.allocate_impl();
    (this.impl_ as IMPL<O>).add_observer(observer);
  }

  protected remove_observer(observer: O): void {
    console.assert(this.impl_ !== null);
    (this.impl_ as IMPL<O>).remove_observer(observer);
  }
}

export class OBSERVABLE<ObserverInterface> extends OBSERVABLE_BASE<ObserverInterface> {
  /**
   * Add a subscription without RAII link.
   */
  SubscribeUnmanaged(aObserver: ObserverInterface): void {
    this.add_observer(aObserver);
  }

  /**
   * Add a subscription returning an RAII link.
   */
  Subscribe(aObserver: ObserverInterface): LINK<ObserverInterface> {
    this.add_observer(aObserver);
    return new LINK(this.impl_, aObserver);
  }

  /**
   * Cancel the subscription of a subscriber.
   *
   * This can be called during notification calls.
   */
  Unsubscribe(aObserver: ObserverInterface): void {
    this.remove_observer(aObserver);
  }

  /**
   * Notify event to all subscribed observers.
   *
   * @param aCall is the notification, called once per observer.
   */
  Notify(aCall: (observer: ObserverInterface) => void): void {
    if (this.impl_) {
      this.enter_iteration();
      try {
        for (const ptr of this.impl_.observers_) {
          if (ptr !== null) aCall(ptr);
        }
      } finally {
        this.leave_iteration();
      }
    }
  }

  /**
   * Notify event to all subscribed observers but ignore the return value.
   */
  NotifyIgnore(aCall: (observer: ObserverInterface) => unknown): void {
    this.Notify(aCall);
  }
}
