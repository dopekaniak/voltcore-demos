// Starter customizers (Module 4). Each reuses the forge contract and sandbox.
// `inputs` adds per-field rules beyond the forge schema (text length and character set).
export const CUSTOMIZERS = [
  { key: 'nameplate', title: 'Name plate or keychain', summary: 'Your name in raised letters, with an optional key ring hole.', inputs: { label: { maxLength: 16, charset: "A-Za-z0-9 .'&-" } }, priceKind: 'export' },
  { key: 'storage-tile', title: 'Modular storage tile', summary: 'A grid of bins sized for your drawer.', inputs: {}, priceKind: 'export' },
  { key: 'relief-coaster', title: 'Photo relief coaster', summary: 'A coaster with a relief made from your image.', inputs: {}, image: { grid: 48 }, priceKind: 'export' },
  { key: 'cable-organizer', title: 'Cable organizer', summary: 'A desk comb with one slot per cable.', inputs: {}, priceKind: 'export' },
];
