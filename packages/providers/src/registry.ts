import { deriveKey } from '@sw/shared/node';
import { MeshyProvider } from './meshy';
import { MockProvider } from './mock';
import type { ModelProvider } from './types';

export interface ProviderEnv {
  PROVIDER_MODE: 'mock' | 'live';
  MESHY_API_KEY?: string | undefined;
  MESHY_BASE_URL: string;
  MESH_URL: string;
  MESH_SERVICE_TOKEN: string;
  APP_SECRET: string;
  MOCK_PROVIDER_LATENCY_MS: string;
}

/** Providers by key. The mock is always present; the live adapter only in live mode. */
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
  if (env.PROVIDER_MODE === 'live' && env.MESHY_API_KEY) {
    map.set('meshy', new MeshyProvider({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL }));
  }
  return map;
}
