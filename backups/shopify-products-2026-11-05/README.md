# Shopify product backup (2026-11-05)

Full export of all 102 products in Sullivan Ridge & Co. taken before the Christian-faith rebuild.

- `all-products.json`: every product (active, draft, archived) with ID, handle, status, vendor, type, tags, description HTML, SEO, media URLs and up to 50 variants (ID, title, SKU, price, compare-at, inventory).
- `extra-variants.json`: variants beyond 50 for The Kinsley Sherpa Blanket and the Cashmere Sweater Pullover.
- `products-summary.tsv`: ID, status, title, first price, image count.

Status at backup time: 55 active, 14 draft, 33 archived. The 69 active and draft products were then archived (not deleted), so they can be restored by setting their status back.
Note: the two corset and onesie listings were already archived and have 100 variants; only the first 50 are in this export.
