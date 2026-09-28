/** Discrete-event kernel. Time is virtual milliseconds (float). */
export interface Scheduled {
  t: number;
  seq: number;
  fn: () => void;
  cancelled?: boolean;
}

export class Kernel {
  now = 0;
  processed = 0;
  private heap: Scheduled[] = [];
  private seq = 0;

  at(t: number, fn: () => void): Scheduled {
    const ev: Scheduled = { t: Math.max(t, this.now), seq: this.seq++, fn };
    this.push(ev);
    return ev;
  }

  after(delay: number, fn: () => void): Scheduled {
    return this.at(this.now + Math.max(0, delay), fn);
  }

  get pending(): number {
    return this.heap.length;
  }

  peekTime(): number {
    return this.heap.length ? this.heap[0].t : Infinity;
  }

  /** Run events with t <= until, stopping early if maxEvents is hit. Returns events run. */
  runUntil(until: number, maxEvents = Infinity): number {
    let n = 0;
    while (this.heap.length && this.heap[0].t <= until && n < maxEvents) {
      const ev = this.pop()!;
      if (ev.cancelled) continue;
      this.now = ev.t;
      ev.fn();
      n++;
    }
    this.processed += n;
    if (n < maxEvents) this.now = Math.max(this.now, until);
    return n;
  }

  private push(ev: Scheduled) {
    const h = this.heap;
    h.push(ev);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(h[i], h[p])) {
        [h[i], h[p]] = [h[p], h[i]];
        i = p;
      } else break;
    }
  }

  private pop(): Scheduled | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

function less(a: Scheduled, b: Scheduled): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}
