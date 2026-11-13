import { expect, test, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { db, signIn } from './helpers';

test.setTimeout(240_000);

/** A closed 20 mm cube as ASCII STL (watertight). */
function cubeStl(size = 20): Buffer {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) => p.map((c) => c * size));
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const facets = f.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${v[i]!.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n');
  return Buffer.from(`solid cube\n${facets}\nendsolid cube\n`);
}

function png(): Buffer {
  const w = 32;
  const rows = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 180)])));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function shareFromLibrary(page: Page, title: string, handle: string) {
  await page.goto('/library');
  await page.getByTestId('library-upload-input').setInputFiles({ name: `${title}.stl`, mimeType: 'model/stl', buffer: cubeStl() });
  await page.waitForURL(/\/library\/ast_/, { timeout: 60_000 });
  const panel = page.getByTestId('share-panel');
  await expect(panel.getByTestId('share-status')).toHaveText('Not shared');
  await panel.getByTestId('share-handle').fill(handle);
  await panel.getByTestId('share-handle-save').click();
  await panel.getByTestId('share-license').selectOption('CC-BY-4.0');
  await panel.getByTestId('share-description').fill('A simple calibration cube. Print it flat, no supports.');
  await panel.getByTestId('share-category').selectOption('printer');
  await panel.getByTestId('share-tags').fill('calibration, cube');
  await panel.getByTestId('share-publish').click();
  await expect(panel.getByTestId('share-status')).toHaveText('Shared');
  await panel.getByTestId('share-photo').setInputFiles({ name: 'print.png', mimeType: 'image/png', buffer: png() });
  await expect(panel.locator('img')).toHaveCount(1, { timeout: 30_000 });
  return page.url().split('/').pop()!;
}

test('J8: share a model, then another maker finds, likes, saves, downloads, comments on, collects, and remixes it', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const title = `Cube ${stamp}`;
  const handle = `maker-${stamp}`;

  const creatorCtx = await browser.newContext();
  const creator = await creatorCtx.newPage();
  await signIn(creator);
  const id = await shareFromLibrary(creator, title, handle);

  const makerCtx = await browser.newContext();
  const maker = await makerCtx.newPage();
  const makerEmail = await signIn(maker);
  await maker.goto('/models');
  await maker.getByTestId('models-search').fill(title);
  await maker.getByRole('button', { name: 'Search' }).click();
  await expect(maker.getByTestId('model-card')).toHaveCount(1);
  await maker.getByTestId('model-card').getByRole('link').click();
  await maker.waitForURL(`**/models/${id}`);
  await expect(maker.getByTestId('model-title')).toHaveText(title);
  await expect(maker.getByTestId('model-license')).toContainText('CC-BY-4.0');
  await expect(maker.getByTestId('model-license')).toContainText(`by ${handle}`);

  await maker.getByTestId('model-like').click();
  await expect(maker.getByTestId('model-like')).toContainText('Liked · 1');
  await maker.getByTestId('model-save').click();
  await expect(maker.getByTestId('model-save')).toHaveText('Saved');

  const dl = maker.waitForEvent('download');
  await maker.getByTestId('model-download').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe(`Cube-${stamp}.stl`);
  await expect(maker.getByTestId('model-stats')).toContainText('1 download');
  const user = await db.user.findUniqueOrThrow({ where: { email: makerEmail } });
  const rec = await db.assetDownload.findFirstOrThrow({ where: { userId: user.id } });
  expect(rec.licenseCode).toBe('CC-BY-4.0');

  await maker.getByTestId('comment-input').fill('Printed perfectly on the first try.');
  await maker.getByTestId('comment-send').click();
  await expect(maker.getByTestId('comments')).toContainText('Printed perfectly');

  await maker.goto('/collections');
  await maker.getByTestId('collection-name').fill('Calibration');
  await maker.getByTestId('collection-create').click();
  await expect(maker.getByTestId('collections')).toContainText('Calibration');
  await expect(maker.getByTestId('model-grid')).toContainText(title); // saved for later
  await maker.goto(`/models/${id}`);
  await maker.getByTestId('model-collect').selectOption({ label: 'Calibration' });
  await expect(maker.getByText('Added.')).toBeVisible();

  await maker.getByTestId('model-remix').click();
  await maker.waitForURL(/\/library\/ast_/);
  await expect(maker.getByRole('heading', { name: `Remix of ${title}` })).toBeVisible();

  await maker.goto(`/creators/${handle}`);
  await expect(maker.getByTestId('creator-handle')).toHaveText(handle);
  await expect(maker.getByTestId('model-grid')).toContainText(title);

  // The creator sees the activity.
  await creator.goto('/creator');
  await expect(creator.getByTestId('creator-tiles')).toContainText('Downloads1');
  await creatorCtx.close();
  await makerCtx.close();
});
