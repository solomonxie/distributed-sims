import type { NodeLogic, Req, SimNode } from '../node';
import { pickWeighted } from '../node';

/** Clients originate traffic: pick one outgoing edge per request. */
export function client(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      const edges = n.syncOut(req.msg.op);
      const e = pickWeighted(edges.length ? edges : n.outEdges(), n.rng);
      if (!e) return req.reply({ ok: true });
      n.call(e, n.world.child(req.msg, n.id, e.to), r => req.reply(r));
    },
  };
}

/**
 * Generic stateless service: queue for capacity, do work, call every sync
 * dependency in order, publish on async edges, reply.
 */
export function service(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime(), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        n.forward(req, n.syncOut(req.msg.op), n.str<'all' | 'one'>('fanout', 'all') === 'one' ? 'one' : 'all', r => {
          if (r.ok) n.publish(req);
          req.reply(r);
        });
      });
    },
  };
}

/** Terminal sink: does work and replies (unknown types, external APIs). */
export function sink(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime(), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
  };
}
