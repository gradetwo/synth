import { expect, test, type Page } from '@playwright/test';

/**
 * Projects (P10.4): several complete workspaces side by side.
 *
 * The three cases the batch is accepted on, plus the one that is easy to get
 * wrong silently:
 *
 *   * two projects, a switch and a reload — the patch really differs between
 *     them, and after a reload both are still there with the right one open;
 *   * every damaged `.gs1proj` is refused with a reason a player can read, and a
 *     whole one comes back in through the same door (export → import);
 *   * a full `localStorage` cancels the write, says so, and does not touch the
 *     work in progress.
 */

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
}

async function openProjects(page: Page) {
  await page.locator('[data-act="settings"]').click();
  const settings = page.locator('.settings-drawer.open');
  await expect(settings).toBeVisible();
  await settings.locator('[data-act="projects-open"]').click();
  const panel = page.locator('.project-drawer.open');
  await expect(panel).toBeVisible();
  return panel;
}

async function closeProjects(page: Page) {
  await page.locator('.project-drawer.open .d-close').click();
  await expect(page.locator('.project-drawer.open')).toHaveCount(0);
}

const presetName = (page: Page) => page.locator('.preset-name').innerText();
/**
 * Step to the next preset and wait for it to land.
 *
 * The factory table is a lazy chunk (P9.26), so the first press of a session
 * fetches it before the patch changes: the click alone would return while the
 * bar still showed the previous name.
 */
async function nextPreset(page: Page): Promise<void> {
  const before = await presetName(page);
  await page.getByRole('button', { name: '下一个预设' }).click();
  await expect(page.locator('.preset-name')).not.toHaveText(before);
}

test.describe('projects', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('keeps two workspaces apart, switches between them and reloads both', async ({ page }) => {
    await start(page);

    // The first project adopts the workspace as it is.
    const first = await openProjects(page);
    await first.locator('[data-act="project-new"]').click();
    await expect(page.locator('.toast')).toContainText('已新建工程');
    await expect(first.locator('.project-row')).toHaveCount(1);
    await expect(first.locator('.project-row').first()).toHaveAttribute('data-active', '1');
    await closeProjects(page);

    await nextPreset(page);
    const nameA = await presetName(page);

    // The second is forked from the first, then given a patch of its own: the
    // two projects really do hold different work.
    const second = await openProjects(page);
    await second.locator('[data-act="project-new"]').click();
    await expect(second.locator('.project-row')).toHaveCount(2);
    await closeProjects(page);
    await nextPreset(page);
    const nameB = await presetName(page);
    expect(nameB).not.toBe(nameA);

    // Switching back really switches: the patch playing is the first project's.
    const back = await openProjects(page);
    await back.locator('.project-row', { hasText: '工程 1' }).locator('[data-act="project-switch"]').click();
    await expect(page.locator('.toast')).toContainText('已切换到');
    await expect(back.locator('.project-row[data-active="1"]')).toContainText('工程 1');
    await closeProjects(page);
    expect(await presetName(page)).toBe(nameA);

    // A reload: both projects are still listed, the open one is the right one
    // and its patch is the one that plays.
    await start(page);
    const after = await openProjects(page);
    await expect(after.locator('.project-row')).toHaveCount(2);
    await expect(after.locator('.project-row[data-active="1"]')).toContainText('工程 1');
    await closeProjects(page);
    expect(await presetName(page)).toBe(nameA);

    // And the other one kept the second patch.
    const other = await openProjects(page);
    await other.locator('.project-row', { hasText: '工程 2' }).locator('[data-act="project-switch"]').click();
    await closeProjects(page);
    expect(await presetName(page)).toBe(nameB);
  });

  test('refuses every damaged project file with a visible reason', async ({ page }) => {
    await start(page);
    const panel = await openProjects(page);
    await panel.locator('[data-act="project-new"]').click();
    await expect(panel.locator('.project-row')).toHaveCount(1);

    const input = page.locator('[data-role="project-file"]');
    const junk: [name: string, body: string, message: string][] = [
      // Cut off mid-payload: the classic half-downloaded file.
      ['truncated.gs1proj', '{"format":"gs1-proj","schema":1,"doc":{"state":{', '不是完整的 JSON'],
      // A file this app did write, but not a project.
      ['patch.gs1proj', '{"format":"gs1-preset","params":{}}', '不是 GS-1 工程文件'],
      ['song.gs1proj', '{"format":"gs1-song","code":"gs1.1.x"}', '不是 GS-1 工程文件'],
      // Written by a build this one does not understand.
      ['future.gs1proj', JSON.stringify({ format: 'gs1-proj', schema: 99, doc: {} }), '更新的版本'],
      // The right format, but no usable workspace inside.
      ['empty.gs1proj', JSON.stringify({ format: 'gs1-proj', schema: 1, doc: {} }), '缺少必需内容'],
    ];
    for (const [name, body, message] of junk) {
      await input.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });
      await expect(page.locator('.toast')).toContainText(message);
      // Nothing was added: a refusal is not a half-import.
      await expect(panel.locator('.project-row')).toHaveCount(1);
    }

    // The same door accepts a whole file, so the refusals above are about the
    // damage rather than about the importer being shut. Export the project that
    // is open and feed the download straight back in.
    const download = page.waitForEvent('download');
    await panel.locator('[data-act="project-export"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.gs1proj$/);
    await input.setInputFiles((await file.path()) as string);
    await expect(page.locator('.toast')).toContainText('已导入工程');
    await expect(panel.locator('.project-row')).toHaveCount(2);
  });

  test('keeps the work and says so when storage is full', async ({ page }) => {
    await start(page);
    const panel = await openProjects(page);
    await panel.locator('[data-act="project-new"]').click();
    await closeProjects(page);
    await nextPreset(page);
    const before = await presetName(page);

    // Fill the origin's quota: every further write throws QuotaExceededError.
    // Chrome rejects a write that does not *fit*, not every write once the
    // storage is "full" — a 512 KB chunk can fail while a 1 KB one still gets
    // in — so the fill walks the sizes down until nothing at all fits. The
    // app's next project write is a few hundred bytes and then has nowhere to
    // go, which is the situation this test is about.
    await page.evaluate(() => {
      for (const size of [4096, 1024, 256, 64, 16, 4, 1]) {
        for (let index = 0; index < 4096; index++) {
          try {
            localStorage.setItem(`filler-${size}-${index}`, 'x'.repeat(size));
          } catch {
            break;
          }
        }
      }
    });

    const full = await openProjects(page);
    await full.locator('[data-act="project-new"]').click();
    await expect(page.locator('.toast')).toContainText('存储空间不足');
    await expect(full.locator('[data-role="project-warning"]')).toContainText('存储空间不足');
    // The list did not grow and the work in progress is exactly what it was.
    await expect(full.locator('.project-row')).toHaveCount(1);
    await closeProjects(page);
    expect(await presetName(page)).toBe(before);
  });
});
