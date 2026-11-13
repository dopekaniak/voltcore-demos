import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { db, signIn } from './helpers';

test.setTimeout(180_000);

/** A solid-colour PNG with a darker square in the middle (a stand-in product photo). */
function photo(w = 96, h = 96): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const inside = x > w / 4 && x < (3 * w) / 4 && y > h / 4 && y < (3 * h) / 4;
      row.set(inside ? [40, 90, 200] : [245, 245, 245], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('J4d: photo to 3D with our own engine, then refine', async ({ page }) => {
  const email = await signIn(page);
  await page.goto('/generate');
  await page.getByTestId('gen-source-image').click();
  await expect(page.getByTestId('gen-preview')).toBeDisabled();
  await page.getByTestId('gen-model').selectOption('studio-shape-v1');
  await page.getByTestId('gen-photo').setInputFiles({ name: 'blue_box.png', mimeType: 'image/png', buffer: photo() });
  await expect(page.getByTestId('gen-cost')).toHaveText('20 credits');
  await page.getByTestId('gen-preview').click();
  await expect(page.getByTestId('download-glb-preview')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('80 credits');
  await page.getByTestId('gen-refine').click();
  await expect(page.getByTestId('download-glb-refined')).toBeVisible({ timeout: 60_000 });

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const asset = await db.asset.findFirstOrThrow({ where: { ownerId: user.id } });
  expect(asset.title).toBe('Blue box');
  const versions = await db.assetVersion.findMany({ where: { assetId: asset.id }, orderBy: { number: 'asc' } });
  expect(versions.map((v) => v.provider)).toEqual(['selfhost', 'selfhost']);
});
