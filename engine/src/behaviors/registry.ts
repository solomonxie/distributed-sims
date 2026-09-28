import type { NodeLogic, Req, SimNode } from '../node';
import { client, service, sink } from './core';

export type BehaviorFactory = (n: SimNode) => NodeLogic;

const byType: Record<string, BehaviorFactory> = {
  'web-client': client,
  'mobile-client': client,
  'iot-device': client,
  bot: client,
  service,
  monolith: service,
  'external-api': sink,
};

const bySkin: Record<string, BehaviorFactory> = {};

export function register(type: string, f: BehaviorFactory) {
  byType[type] = f;
}

export function registerSkin(skin: string, f: BehaviorFactory) {
  bySkin[skin] = f;
}

export function behaviorFor(type: string, skin?: string): BehaviorFactory {
  return (skin && bySkin[skin]) || byType[type] || (/client|device|bot$/.test(type) ? client : service);
}

export function registeredTypes(): string[] {
  return Object.keys(byType);
}

/**
 * Generic handlers for message kinds by prefix (e.g. 'txn.' → 2PC participant).
 * Used when a node's own logic doesn't claim the kind via `handles`.
 */
export type KindHandler = (n: SimNode, req: Req) => void;
const byKind: [string, KindHandler][] = [];

export function registerKind(prefix: string, h: KindHandler) {
  byKind.push([prefix, h]);
}

export function kindHandler(kind: string): KindHandler | undefined {
  if (kind === 'req') return undefined;
  for (const [p, h] of byKind) if (kind.startsWith(p)) return h;
  return undefined;
}
