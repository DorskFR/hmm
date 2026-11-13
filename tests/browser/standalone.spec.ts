import { expect, type Page, test } from '@playwright/test';

const part = (page: Page, id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
const style = (page: Page, id: string, prop: string) =>
	part(page, id).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.beforeEach(async ({ request }) => {
	await request.delete('/__reports');
});

test('the standalone script styles the panel, leaves the page alone and sends', async ({
	page,
	request,
}) => {
	await page.goto('/standalone.html');
	await part(page, 'launcher').click();
	await expect(part(page, 'panel')).toBeVisible();

	const host = await page.evaluate(() => ({
		margin: getComputedStyle(document.body).margin,
		scheme: getComputedStyle(document.documentElement).colorScheme,
		font: getComputedStyle(document.body).fontFamily,
	}));
	expect(host).toEqual({
		margin: '8px',
		scheme: 'normal',
		font: expect.not.stringMatching(/Inter/),
	});
	expect(await style(page, 'panel', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
	expect(await style(page, 'subtitle', 'font-family')).toMatch(/Inter|system-ui|sans-serif/);

	const dark = await style(page, 'panel', 'background-color');
	await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'solarizedlight'));
	expect(await style(page, 'panel', 'background-color')).not.toBe(dark);

	await page.locator('[data-hmm]').getByLabel('Details').fill('Works without a bundler');
	await part(page, 'review').click();
	await part(page, 'send').click();
	await expect(part(page, 'message')).toHaveText('Your feedback was sent.');

	const reports = await (await request.get('/__reports')).json();
	expect(reports).toHaveLength(1);
	expect(reports[0].comment).toBe('Works without a bundler');
	expect(reports[0].context).toEqual({ page: 'standalone' });
});
