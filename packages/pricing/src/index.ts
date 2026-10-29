import v1 from '../config/v1.json' with { type: 'json' };
import { configSchema, type PricingConfig } from './engine';

export * from './engine';
export * from './estimate';

export const PRICING_CONFIGS: Record<number, PricingConfig> = { 1: configSchema.parse(v1) };
export const CURRENT_PRICING_VERSION = 1;
export function pricingConfig(version = CURRENT_PRICING_VERSION): PricingConfig {
  const c = PRICING_CONFIGS[version];
  if (!c) throw new Error(`unknown pricing version ${version}`);
  return c;
}
