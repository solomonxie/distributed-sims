// Tiny event bus so the snapshot tour can open sheets/modes on the current screen.
type Fn = (arg?: any) => void;
const subs = new Map<string, Set<Fn>>();

export const bus = {
  on(ev: string, fn: Fn) {
    if (!subs.has(ev)) subs.set(ev, new Set());
    subs.get(ev)!.add(fn);
    return () => {
      subs.get(ev)!.delete(fn);
    };
  },
  emit(ev: string, arg?: any) {
    subs.get(ev)?.forEach(f => f(arg));
  },
};
