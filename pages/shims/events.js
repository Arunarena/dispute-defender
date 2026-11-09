// "events" stand-in for the GitHub Pages demo: just what the server's event bus needs.

export class EventEmitter {
  #l = new Map();
  on(ev, fn) {
    if (!this.#l.has(ev)) this.#l.set(ev, []);
    this.#l.get(ev).push(fn);
    return this;
  }
  addListener(ev, fn) {
    return this.on(ev, fn);
  }
  once(ev, fn) {
    const w = (...a) => (this.off(ev, w), fn(...a));
    return this.on(ev, w);
  }
  off(ev, fn) {
    this.#l.set(ev, (this.#l.get(ev) ?? []).filter((f) => f !== fn));
    return this;
  }
  removeListener(ev, fn) {
    return this.off(ev, fn);
  }
  emit(ev, ...args) {
    const fns = [...(this.#l.get(ev) ?? [])];
    fns.forEach((f) => f(...args));
    return fns.length > 0;
  }
  setMaxListeners() {
    return this;
  }
  listenerCount(ev) {
    return (this.#l.get(ev) ?? []).length;
  }
}
export default EventEmitter;
