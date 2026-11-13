import { deriveKey } from '@sw/shared/node';
import { MeshyProvider } from './meshy';
import { MockProvider } from './mock';
import { SelfHostProvider } from './selfhost';
import type { ModelProvider } from './types';

export interface ProviderEnv {
  PROVIDER_MODE: 'mock' | 'live';
  MESHY_API_KEY?: string | undefined;
  MESHY_BASE_URL: string;
  MESH_URL: string;
  MESH_SERVICE_TOKEN: string;
  APP_SECRET: string;
  MOCK_PROVIDER_LATENCY_MS: string;
  GEN_SERVER_URL?: string | undefined;
  GEN_SERVER_TOKEN?: string | undefined;
}

/**
 * Providers by key. The mock is always present. Our self-hosted engine is present whenever its
 * server is configured. The third-party live adapter is present only in live mode.
 */
export function providerRegistry(env: ProviderEnv): Map<string, ModelProvider> {
  const [lo, hi] = env.MOCK_PROVIDER_LATENCY_MS.split('-').map(Number);
  const map = new Map<string, ModelProvider>();
  map.set(
    'mock',
    new MockProvider({
      meshUrl: env.MESH_URL,
      meshToken: env.MESH_SERVICE_TOKEN,
      webhookSecret: deriveKey(env.APP_SECRET, 'mock-provider-webhook').toString('hex'),
      latencyMs: [lo ?? 8000, hi ?? lo ?? 25000],
    }),
  );
  if (env.GEN_SERVER_URL && env.GEN_SERVER_TOKEN) {
    map.set('selfhost', new SelfHostProvider({ baseUrl: env.GEN_SERVER_URL, token: env.GEN_SERVER_TOKEN }));
  }
  if (env.PROVIDER_MODE === 'live' && env.MESHY_API_KEY) {
    map.set('meshy', new MeshyProvider({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL }));
  }
  return map;
}
