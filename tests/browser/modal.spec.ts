import { expect, type Page, test } from '@playwright/test';

const part = (page: Page, id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
const edge = { form: 'edge', side: 'right', align: 'center' };
const open = (page: Page, launcher: object = edge) =>
	page.goto(`/launchers.html?launcher=${encodeURIComponent(JSON.stringify(launcher))}`);

const overlay = (page: Page) =>
	page.evaluate(() => {
		const backdrop = document.createElement('div');
		backdrop.id = 'backdrop';
		backdrop.style.cssText =
			'position: fixed; inset: 0; z-index: 1000; background: rgb(0 0 0 / 0.4)';
		const modal = document.createElement('div');
		modal.id = 'modal';
		modal.style.cssText =
			'position: fixed; z-index: 1001; left: 40%; top: 40%; padding: 1rem; background: white';
		modal.innerHTML = '<button id="ok" type="button">OK</button>';
		document.body.append(backdrop, modal);
	});

const dialog = (page: Page) =>
	page.evaluate(() => {
		const dialog = document.createElement('dialog');
		dialog.innerHTML = '<p>Are you sure?</p><button id="ok" type="button">OK</button>';
		document.body.append(dialog);
		dialog.showModal();
	});

const strip = async (page: Page) => {
	const box = await part(page, 'launcher').boundingBox();
	if (!box) throw new Error('no launcher');
	return { x: box.x + 4, y: box.y + box.height / 2 };
};

const hit = (page: Page, x: number, y: number) =>
	page.evaluate(
		([x, y]) => {
			const el = document.elementFromPoint(x, y);
			if (el?.closest('[data-hmm-launcher]')) return 'launcher';
			if (el?.closest('[data-id="panel"]')) return 'panel';
			return el?.id || el?.tagName.toLowerCase() || '';
		},
		[x, y] as const,
	);

const centre = async (page: Page, id: string) => {
	const box = await part(page, id).boundingBox();
	if (!box) throw new Error(`${id} not visible`);
	return [box.x + box.width / 2, box.y + box.height / 2] as const;
};

test.beforeEach(async ({ request }) => {
	await request.delete('/__reports');
});

test('an idle launcher stays under a z-index modal', async ({ page }) => {
	await open(page);
	await overlay(page);
	const { x, y } = await strip(page);
	await expect.poll(() => hit(page, x, y)).toBe('backdrop');
	await page.mouse.move(200, 200);
	await expect.poll(() => hit(page, x, y)).toBe('backdrop');
});

test('the mouse coming near raises the launcher above a z-index modal, and its panel too', async ({
	page,
}) => {
	await open(page);
	await overlay(page);
	const { x, y } = await strip(page);
	await page.mouse.move(x - 200, y);
	await page.mouse.move(x - 40, y, { steps: 5 });
	await expect.poll(() => hit(page, x, y)).toBe('launcher');

	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 } });
	await tab.click();
	await expect(part(page, 'panel')).toBeVisible();
	expect(await hit(page, ...(await centre(page, 'panel')))).toBe('panel');
	await part(page, 'comment').fill('stuck behind this modal');
	await expect(part(page, 'comment')).toHaveValue('stuck behind this modal');

	await page.keyboard.press('Escape');
	await expect(part(page, 'panel')).toHaveCount(0);
	await page.mouse.move(200, 200);
	await page.locator('#ok').focus();
	await expect.poll(() => hit(page, x, y)).toBe('backdrop');
});

test('keyboard focus raises the launcher above a z-index modal', async ({ page }) => {
	await open(page);
	await overlay(page);
	const { x, y } = await strip(page);
	await page.locator('#buy').focus();
	await page.keyboard.press('Tab');
	await expect(part(page, 'launcher')).toBeFocused();
	await expect.poll(() => hit(page, x, y)).toBe('launcher');
	await page.keyboard.press('Enter');
	await expect(part(page, 'panel')).toBeVisible();
	expect(await hit(page, ...(await centre(page, 'panel')))).toBe('panel');
});

test('a floating launcher is raised too as the mouse comes near', async ({ page }) => {
	await open(page, { form: 'floating', anchor: 'bottom-right' });
	await overlay(page);
	const [x, y] = await centre(page, 'launcher');
	await expect.poll(() => hit(page, x, y)).toBe('backdrop');
	await page.mouse.move(x - 150, y - 150);
	await page.mouse.move(x, y, { steps: 5 });
	await expect.poll(() => hit(page, x, y)).toBe('launcher');
	await page.mouse.click(x, y);
	await expect(part(page, 'panel')).toBeVisible();
});

test('feedback can be sent while a native modal dialog is open', async ({ page, request }) => {
	await open(page);
	await dialog(page);
	await expect(page.locator('dialog > [data-hmm]')).toHaveCount(1);

	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 } });
	await tab.click();
	await part(page, 'comment').fill('the dialog hides the total');
	await part(page, 'review').click();
	await part(page, 'send').click();
	await expect(part(page, 'message')).toBeVisible();
	const reports = await (await request.get('/__reports')).json();
	expect(reports).toHaveLength(1);
	expect(reports[0].comment).toBe('the dialog hides the total');

	await part(page, 'done').click();
	await expect(part(page, 'panel')).toHaveCount(0);
	await expect(page.locator('dialog')).toHaveAttribute('open');
});

test('Escape closes the panel without closing the native dialog behind it', async ({ page }) => {
	await open(page);
	await dialog(page);
	await part(page, 'launcher').focus();
	await page.keyboard.press('Enter');
	await expect(part(page, 'comment')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(part(page, 'panel')).toHaveCount(0);
	await expect(page.locator('dialog')).toHaveAttribute('open');
});

test('the panel keeps its draft as native dialogs open and close around it', async ({ page }) => {
	await open(page);
	await part(page, 'launcher').focus();
	await page.keyboard.press('Enter');
	await part(page, 'comment').fill('half written');

	await dialog(page);
	await expect(page.locator('dialog > [data-hmm]')).toHaveCount(1);
	await expect(part(page, 'comment')).toHaveValue('half written');
	await part(page, 'comment').fill('half written, then more');

	await page.evaluate(() => document.querySelector('dialog')?.close());
	await expect(page.locator('body > [data-hmm]')).toHaveCount(1);
	await expect(part(page, 'comment')).toHaveValue('half written, then more');

	await dialog(page);
	await expect(page.locator('dialog > [data-hmm]')).toHaveCount(1);
	await page.evaluate(() => document.querySelector('dialog[open]')?.remove());
	await expect(page.locator('body > [data-hmm]')).toHaveCount(1);
	await expect(part(page, 'comment')).toHaveValue('half written, then more');
});

test('the launcher follows the topmost of stacked native dialogs', async ({ page }) => {
	await open(page);
	await dialog(page);
	await dialog(page);
	await expect(page.locator('dialog:last-of-type > [data-hmm]')).toHaveCount(1);
	await page.evaluate(() =>
		document.querySelector<HTMLDialogElement>('dialog:last-of-type')?.close(),
	);
	await expect(page.locator('dialog:first-of-type > [data-hmm]')).toHaveCount(1);
	await page.evaluate(() => document.querySelector('dialog')?.close());
	await expect(page.locator('body > [data-hmm]')).toHaveCount(1);
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });

	test('a tap on the tab under a z-index modal raises and slides it out, the next opens the panel', async ({
		page,
	}) => {
		await open(page);
		await overlay(page);
		const { x, y } = await strip(page);
		await expect.poll(() => hit(page, x, y)).toBe('backdrop');
		await page.touchscreen.tap(x, y);
		await expect(page.locator('[data-hmm-launcher]')).toHaveAttribute('data-state', 'out');
		await expect(part(page, 'panel')).toHaveCount(0);
		await expect.poll(() => hit(page, x, y)).toBe('launcher');
		const out = await strip(page);
		await page.touchscreen.tap(out.x + 20, out.y);
		await expect(part(page, 'panel')).toBeVisible();
		expect(await hit(page, ...(await centre(page, 'panel')))).toBe('panel');
	});
});
