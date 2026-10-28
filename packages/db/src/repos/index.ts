import type { Db } from '../index';
import { apiKeyRepo, walletRepo, webhookRepo } from './developer';

/** All owner-scoped repositories. Add new repositories here so the scope test covers them. */
export function makeRepos(db: Db) {
  return {
    apiKeys: apiKeyRepo(db),
    webhooks: webhookRepo(db),
    wallet: walletRepo(db),
  };
}
export type Repos = ReturnType<typeof makeRepos>;
