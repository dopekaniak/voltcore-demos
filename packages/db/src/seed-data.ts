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
