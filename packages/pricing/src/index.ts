import v1 from '../config/v1.json' with { type: 'json' };

export const PRICING_CONFIGS = { 1: v1 } as const;
export const CURRENT_PRICING_VERSION = 1;
