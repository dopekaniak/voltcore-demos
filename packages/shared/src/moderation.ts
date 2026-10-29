/**
 * Prompt moderation: a deny-list of prohibited item terms (firearms, firearm parts, weapon
 * accessories, explosives). Shared by Generate, the forge author, and the copilot. The list
 * and review process are documented in docs/policy-content.md.
 */
const TERMS = [
  'gun', 'guns', 'firearm', 'firearms', 'rifle', 'pistol', 'handgun', 'shotgun', 'revolver', 'carbine',
  'ammunition', 'ammo', 'suppressor', 'silencer', 'lower receiver', 'upper receiver',
  'trigger group', 'auto sear', 'bump stock', 'glock', 'ar-15', 'ar15', 'ak-47', 'ak47', 'grenade', 'explosive',
  'pipe bomb', 'detonator', 'brass knuckles', 'switchblade',
];
const RE = new RegExp(`\\b(${TERMS.map((t) => t.replace(/[-]/g, '[- ]?')).join('|')})\\b`, 'i');

export interface ModerationResult {
  ok: boolean;
  term?: string;
}

export function moderateText(text: string): ModerationResult {
  const m = RE.exec(text.normalize('NFKC'));
  return m ? { ok: false, term: m[1]!.toLowerCase() } : { ok: true };
}
