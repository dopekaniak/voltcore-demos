export interface StarterCustomizer { key: string; title: string; summary: string; inputs: Record<string, { maxLength?: number; charset?: string }>; image?: { grid: number }; priceKind: string }
export const CUSTOMIZERS: StarterCustomizer[];
