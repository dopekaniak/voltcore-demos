# Content policy (draft for counsel review)

## Prohibited items

Shapewright does not design, generate, or print:

- firearms and firearm parts (frames, receivers, barrels, slides, trigger groups, auto sears,
  bump stocks, magazines for firearms), suppressors and silencers;
- ammunition;
- explosives, detonators, and grenades;
- weapon accessories designed to injure (brass knuckles, switchblades).

## Enforcement

- **Text:** prompts for Generate (and, later, forge authoring and copilot edits) are checked
  on the server against the deny-list in `packages/shared/src/moderation.ts` and refused
  with `PROHIBITED_ITEM` and a neutral reason. No workaround is offered.
- **Images:** an image classifier is not yet chosen (open question in `docs/decisions.md`).
  Until it is, images are only checked for type and size.
- **Review:** refusals are logged with a hashed user id; the list is reviewed weekly for
  misses and false positives.

## Intellectual property

Users must own or be licensed to use what they upload. Takedown requests are handled by
hiding the item, notifying the owner, logging the action, and allowing a counter-notice.
