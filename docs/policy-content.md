# Content policy (draft for counsel review)

## Prohibited items

Shapewright does not design, generate, or print:

- firearms and firearm parts (frames, receivers, barrels, slides, trigger groups, auto sears,
  bump stocks, magazines for firearms), suppressors and silencers;
- ammunition;
- explosives, detonators, and grenades;
- weapon accessories designed to injure (brass knuckles, switchblades).

## Enforcement (server-side, three paths)

- **Text:** every free-text input — Generate prompts, forge descriptions, copilot edit
  messages, customizer text — is checked on the server against the deny-list in
  `packages/shared/src/moderation.ts` and refused with `PROHIBITED_ITEM` and a short,
  neutral reason. No workaround is offered. The forge author may also refuse on its own;
  its refusal is reported the same way.
- **Images:** every image upload passes an image classifier for prohibited item types
  before it can be used for calibration, a customizer relief, image-to-3D, or as a
  reference. A flagged image is not dropped: the upload is set to `FLAGGED`, the file stays
  in quarantine, and a moderation case opens for a person to uphold (delete) or release.
  The classifier sits behind an interface; only a mock exists today (it recognises a test
  marker and nothing else), so real detection is an open question (`docs/decisions.md`).
  Until a classifier is chosen, the upload notice and the takedown process carry the policy.
- **Edits:** a copilot proposal is checked against the same deny-list (its notes and the
  code it changed) before it is shown. A prohibited proposal is refused, its held credits
  are released, and the refusal is logged. Proposed edits are not image-classified (there
  is no picture until the person accepts).
- Location and camera data (EXIF, XMP, IPTC, PNG text chunks) are stripped from every image
  upload before use.

## Refusal log and weekly review

- Each refusal stores only: path (text, image, edit), surface (forge, generate, copilot,
  customizer, upload), the matched category, time, and a keyed hash of the user
  (HMAC with the app secret; the same person always hashes the same, and the hash cannot
  be turned back into an account without the secret).
- Every week a reviewer opens `GET /admin/refusals?days=7` (totals by path, surface, and
  category, and the number of distinct people) and the open moderation cases
  (`GET /admin/moderation-cases`). They look for misses (prohibited items that got
  through, found from reports and takedowns) and false positives (legitimate requests
  refused), and propose deny-list changes in a reviewed commit. Decisions on held images
  (`POST /admin/moderation-cases/:id/decide`) need a reason and are audited.

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
  upload follows the normal retention rules. Photos pass the image check above; reported
  designs go through the takedown process.
