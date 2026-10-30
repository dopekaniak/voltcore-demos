/** Seed data: plans, packs, materials, mock partners, mock models. Values are config, not code. */
export const PLANS = [
  { code: 'free', name: 'Free', monthlyCredits: 100, priceMinor: 0, apiRateLimitPerMin: 60, sortOrder: 0 },
  { code: 'creator', name: 'Creator', monthlyCredits: 2000, priceMinor: 1500, apiRateLimitPerMin: 600, sortOrder: 1 },
  { code: 'studio', name: 'Studio', monthlyCredits: 10000, priceMinor: 6000, apiRateLimitPerMin: 3000, sortOrder: 2 },
] as const;

export const CREDIT_PACKS = [
  { code: 'pack-500', name: '500 credits', credits: 500, priceMinor: 500 },
  { code: 'pack-2500', name: '2,500 credits', credits: 2500, priceMinor: 2250 },
  { code: 'pack-10000', name: '10,000 credits', credits: 10000, priceMinor: 8000 },
] as const;

export const MATERIALS = [
  { code: 'PLA', name: 'PLA', colors: ['black', 'white', 'gray', 'orange', 'blue'], sortOrder: 0 },
  { code: 'PETG', name: 'PETG', colors: ['black', 'white', 'clear'], sortOrder: 1 },
  { code: 'ASA', name: 'ASA', colors: ['black', 'white'], sortOrder: 2 },
] as const;

/** Mock partners only. No real partner is claimed (build prompt 5.4). */
export const PARTNERS = [
  {
    code: 'mock-north',
    name: 'Mock Partner North',
    city: 'Minneapolis',
    country: 'US',
    printers: [
      { name: 'North-1', materials: ['PLA', 'PETG'], bedMm: [256, 256, 256], queueMinutes: 120 },
      { name: 'North-2', materials: ['PLA', 'PETG', 'ASA'], bedMm: [220, 220, 250], queueMinutes: 30 },
    ],
  },
  {
    code: 'mock-south',
    name: 'Mock Partner South',
    city: 'Austin',
    country: 'US',
    printers: [
      { name: 'South-1', materials: ['PLA', 'ASA'], bedMm: [250, 210, 210], queueMinutes: 60 },
      { name: 'South-2', materials: ['PETG'], bedMm: [256, 256, 256], queueMinutes: 240 },
    ],
  },
] as const;

/** Credit costs per operation (our credits, set independently of any provider's). */
export const GENERATION_MODELS = [
  {
    code: 'mock-standard',
    providerKey: 'mock',
    name: 'Mock standard',
    capabilities: { textTo3D: true, imageTo3D: true, refine: true, retexture: true, remesh: true, webhooks: true, outputs: ['glb', 'obj', 'stl'] },
    costs: { preview: 20, refine: 10, image: 30, retexture: 10, remesh: 5 },
    sortOrder: 0,
  },
  {
    code: 'mock-lite',
    providerKey: 'mock',
    name: 'Mock lite',
    capabilities: { textTo3D: true, imageTo3D: true, refine: true, retexture: true, remesh: true, webhooks: true, outputs: ['glb', 'stl'] },
    costs: { preview: 5, refine: 10, image: 15, retexture: 10, remesh: 5 },
    sortOrder: 1,
  },
  {
    code: 'meshy-6',
    providerKey: 'meshy',
    name: 'Meshy 6 (live)',
    capabilities: { textTo3D: true, imageTo3D: false, refine: true, retexture: false, remesh: false, webhooks: true, outputs: ['glb', 'obj', 'fbx', 'usdz', 'stl'] },
    costs: { preview: 25, refine: 15 },
    sortOrder: 2,
  },
] as const;

/** Forge credit costs. Previews in the browser are free; authoring and exports cost. */
export const FORGE_COSTS = { author: 10, step_export: 2 } as const;

/**
 * License catalog (addendum rule 2). Texts are short summaries with the canonical URL;
 * the full legal text lives at the URL. Non-commercial and no-derivative terms block
 * print orders and remixes respectively.
 */
export const LICENSES = [
  { code: 'CC0-1.0', name: 'CC0 1.0 Public Domain Dedication', text: 'No rights reserved. https://creativecommons.org/publicdomain/zero/1.0/', attributionTemplate: '{title} by {author} (CC0)', allowsCommercial: true, allowsDerivatives: true, allowsPrintOrder: true },
  { code: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', text: 'Share and adapt with attribution. https://creativecommons.org/licenses/by/4.0/', attributionTemplate: '{title} by {author}, licensed CC BY 4.0', allowsCommercial: true, allowsDerivatives: true, allowsPrintOrder: true },
  { code: 'CC-BY-SA-4.0', name: 'Creative Commons Attribution-ShareAlike 4.0', text: 'Share and adapt with attribution; adaptations use the same license. https://creativecommons.org/licenses/by-sa/4.0/', attributionTemplate: '{title} by {author}, licensed CC BY-SA 4.0', allowsCommercial: true, allowsDerivatives: true, allowsPrintOrder: true },
  { code: 'CC-BY-NC-4.0', name: 'Creative Commons Attribution-NonCommercial 4.0', text: 'Share and adapt with attribution, non-commercial use only. https://creativecommons.org/licenses/by-nc/4.0/', attributionTemplate: '{title} by {author}, licensed CC BY-NC 4.0', allowsCommercial: false, allowsDerivatives: true, allowsPrintOrder: false },
  { code: 'CC-BY-ND-4.0', name: 'Creative Commons Attribution-NoDerivatives 4.0', text: 'Share with attribution; no adaptations. https://creativecommons.org/licenses/by-nd/4.0/', attributionTemplate: '{title} by {author}, licensed CC BY-ND 4.0', allowsCommercial: true, allowsDerivatives: false, allowsPrintOrder: true },
  { code: 'ALL-RIGHTS-RESERVED', name: 'All rights reserved', text: 'Download for personal printing only. No resale, no redistribution, no derivatives.', attributionTemplate: '{title} by {author}, all rights reserved', allowsCommercial: false, allowsDerivatives: false, allowsPrintOrder: false, personalPrintOnly: true },
] as const;

/** Customizer export policy (addendum 1.2): previews are free; exports cost credits after a free allowance. */
export const CUSTOMIZER_POLICY = { free_exports_per_month: 3, export_cost: 5, free_plan_formats: ['stl'], paid_plan_formats: ['stl', '3mf'] } as const;
