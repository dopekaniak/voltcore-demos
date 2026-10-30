# Printer profiles

Each named profile's bed size and default nozzle come from the manufacturer's own published
specification page. Names are plain-text compatibility labels: no logos, colors, or photos.
The **Generic FDM** profile is the default; its bed size is entered by the person.

| Key | Name | Bed (X × Y × Z mm) | Nozzle | Source | Retrieved |
| --- | --- | --- | --- | --- | --- |
| generic-fdm | Generic FDM | user-entered (default 220 × 220 × 250) | 0.4 mm | — | — |
| prusa-mk4s | Original Prusa MK4S | 250 × 210 × 220 | 0.4 mm | https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/ ("250 x 210 x 220 mm") | 2026-10-30 |
| prusa-mini-plus | Original Prusa MINI+ | 180 × 180 × 180 | 0.4 mm | https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-3d-printer-enclosure-bundle-5/ ("180 x 180 x 180 mm") | 2026-10-30 |

Wall minimum (1.2 mm, three 0.4 mm lines), overhang default (45°), and validated materials
(PLA, PETG) are this platform's own defaults, not manufacturer claims.

Other printers were not added: their specification pages could not be retrieved when the
table was built (blocked or moved). Add a row only with a source URL and retrieval date.
