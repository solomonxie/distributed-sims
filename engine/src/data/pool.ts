import type { SimNode } from '../node';

/** Extra slot pool on a node (e.g. a read replica's own connections). */
export class Pool {
  busy = 0;
  private q: { w: number; ms: number; done: (ok: boolean) => void }[] = [];
  private queuedW = 0;

  constructor(private n: SimNode, public slots: number) {}

  run(w: number, ms: number, done: (ok: boolean) => void) {
    if (this.busy < this.slots && !this.q.length) return this.start(w, ms, done);
    if (this.queuedW + w > this.n.queueLimit) return done(false);
    this.q.push({ w, ms, done });
    this.queuedW += w;
  }

  private start(w: number, ms: number, done: (ok: boolean) => void) {
    const need = Math.max(1, Math.min(Math.ceil(w), this.slots));
    this.busy += need;
    this.n.timer((ms * w) / need, () => {
      this.busy -= need;
      done(true);
      this.drain();
    });
  }

  private drain() {
    while (this.q.length && this.busy < this.slots) {
      const j = this.q.shift()!;
      this.queuedW -= j.w;
      this.start(j.w, j.ms, j.done);
    }
  }

  reset() {
    this.busy = 0;
    this.q = [];
    this.queuedW = 0;
  }
}
