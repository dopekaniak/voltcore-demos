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

## Customizer text and photos

- **Text:** customizer text fields accept only the characters each customizer lists (for
  example letters, numbers, spaces, and `- . ' &` on the name plate) up to a fixed length,
  and pass the same deny-list as prompts. Text that breaks the rules is refused, not
  silently changed.
- **Photos:** people may upload only photos they took or hold the rights to. Not allowed:
  logos or trademarks they do not own, photos of other people without their consent, and
  anything on the prohibited list above. The upload field says this before a file is
  chosen. Photos are reduced to a small grayscale height map on the server; the original
  upload follows the normal retention rules. There is no automatic image classifier yet
  (open question 9 in `docs/decisions.md`); reported designs go through the takedown process.
