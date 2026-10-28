import type { Db } from '../index';
import { defineRepo, type OwnerScope } from '../scope';

const uid = (s: OwnerScope) => s.userId ?? '00000000-0000-0000-0000-000000000000';

export function apiKeyRepo(db: Db) {
  return defineRepo('apiKeys', {
    list: (s: OwnerScope) => db.apiKey.findMany({ where: { ownerId: uid(s), revokedAt: null }, orderBy: { id: 'desc' } }),
    create: (s: OwnerScope, data: { name: string; prefix: string; keyHash: string; scopes: string[] }) =>
      db.apiKey.create({ data: { ...data, ownerId: uid(s) } }),
    revoke: async (s: OwnerScope, id: string) => {
      const r = await db.apiKey.updateMany({ where: { id, ownerId: uid(s), revokedAt: null }, data: { revokedAt: new Date() } });
      return r.count > 0;
    },
  });
}

export function webhookRepo(db: Db) {
  return defineRepo('webhooks', {
    list: (s: OwnerScope) => db.webhookEndpoint.findMany({ where: { ownerId: uid(s) }, orderBy: { id: 'desc' } }),
    get: (s: OwnerScope, id: string) => db.webhookEndpoint.findFirst({ where: { id, ownerId: uid(s) } }),
    create: (s: OwnerScope, data: { url: string; secretEnc: string; events: string[] }) =>
      db.webhookEndpoint.create({ data: { ...data, ownerId: uid(s) } }),
    update: async (s: OwnerScope, id: string, data: { url?: string; events?: string[]; status?: 'ACTIVE' | 'DISABLED' }) => {
      const r = await db.webhookEndpoint.updateMany({ where: { id, ownerId: uid(s) }, data });
      return r.count > 0 ? db.webhookEndpoint.findUnique({ where: { id } }) : null;
    },
    remove: async (s: OwnerScope, id: string) => (await db.webhookEndpoint.deleteMany({ where: { id, ownerId: uid(s) } })).count > 0,
    createDelivery: async (s: OwnerScope, endpointId: string, event: string, payload: object) => {
      const ep = await db.webhookEndpoint.findFirst({ where: { id: endpointId, ownerId: uid(s) } });
      if (!ep) return null;
      return db.webhookDelivery.create({ data: { endpointId, event, payload } });
    },
  });
}

export function walletRepo(db: Db) {
  return defineRepo('wallet', {
    get: (s: OwnerScope) => db.creditWallet.findUnique({ where: { ownerId: uid(s) } }),
    ledger: async (s: OwnerScope, opts: { before?: string; limit: number }) => {
      const w = await db.creditWallet.findUnique({ where: { ownerId: uid(s) }, select: { id: true } });
      if (!w) return [];
      return db.creditLedger.findMany({
        where: { walletId: w.id, ...(opts.before ? { id: { lt: opts.before } } : {}) },
        orderBy: { id: 'desc' },
        take: opts.limit,
      });
    },
    grants: async (s: OwnerScope) => {
      const w = await db.creditWallet.findUnique({ where: { ownerId: uid(s) }, select: { id: true } });
      return w ? db.creditGrant.findMany({ where: { walletId: w.id, remaining: { gt: 0 } }, orderBy: { expiresAt: 'asc' } }) : [];
    },
  });
}
