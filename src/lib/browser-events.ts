type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private events = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener) {
    const listeners = this.events.get(event) ?? [];
    listeners.push(listener);
    this.events.set(event, listeners);
    return this;
  }

  addListener(event: string | symbol, listener: Listener) {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: Listener) {
    const wrapped: Listener = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string | symbol, listener: Listener) {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener) {
    const listeners = this.events.get(event);
    if (!listeners) return this;
    const next = listeners.filter((item) => item !== listener);
    if (next.length) this.events.set(event, next);
    else this.events.delete(event);
    return this;
  }

  removeAllListeners(event?: string | symbol) {
    if (event === undefined) this.events.clear();
    else this.events.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]) {
    const listeners = this.events.get(event);
    if (!listeners?.length) return false;
    for (const listener of [...listeners]) listener(...args);
    return true;
  }

  listeners(event: string | symbol) {
    return [...(this.events.get(event) ?? [])];
  }

  listenerCount(event: string | symbol) {
    return this.events.get(event)?.length ?? 0;
  }

  eventNames() {
    return [...this.events.keys()];
  }
}

export default { EventEmitter };
