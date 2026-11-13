import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { db, signIn } from './helpers';

// Our own generation server (apps/gen-server, test engine on machines without a GPU).
test.setTimeout(180_000);

test('J4c: generate with our own engine → refine at high detail → printable STL in the library', async ({ page }) => {
  const email = await signIn(page);
  await page.goto('/generate');
  await page.getByTestId('gen-model').selectOption('studio-shape-v1');
  await page.getByTestId('gen-prompt').fill('a tall flower vase');
  await expect(page.getByTestId('gen-cost')).toHaveText('15 credits');
  await expect(page.getByTestId('gen-refine')).toContainText('Refine at high detail');
  await page.getByTestId('gen-preview').click();
  await expect(page.getByTestId('download-glb-preview')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('85 credits');
  await page.getByTestId('gen-refine').click();
  await expect(page.getByTestId('download-glb-refined')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('75 credits');
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-glb-refined').click();
  expect(readFileSync(await (await dl).path()).subarray(0, 4).toString()).toBe('glTF');

  // The stored versions came from our engine, sized in millimetres and sitting on the bed.
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const versions = await db.assetVersion.findMany({ where: { asset: { ownerId: user.id } }, orderBy: { number: 'asc' } });
  expect(versions.map((v) => [v.stage, v.provider])).toEqual([
    ['PREVIEW', 'selfhost'],
    ['REFINED', 'selfhost'],
  ]);
  const bbox = versions[1]!.bboxMm as number[];
  expect(Math.max(...bbox)).toBeCloseTo(80, 0);
  expect(versions[1]!.triangles!).toBeGreaterThan(versions[0]!.triangles!);
});
