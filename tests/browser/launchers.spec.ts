import { expect, type Locator, type Page, test } from '@playwright/test';

const part = (page: Page, id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
const open = (page: Page, launcher: object, extra = '') =>
	page.goto(`/launchers.html?launcher=${encodeURIComponent(JSON.stringify(launcher))}${extra}`);
const viewport = (page: Page) => {
	const size = page.viewportSize();
	if (!size) throw new Error('no viewport');
	return size;
};
const rect = async (locator: Locator) => {
	const box = await locator.boundingBox();
	if (!box) throw new Error('not visible');
	return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
};
const visibleWidth = async (page: Page, locator: Locator) => {
	const r = await rect(locator);
	const width = await page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.cssText = 'position: fixed; right: 0; width: 0';
		document.body.append(probe);
		const edge = probe.getBoundingClientRect().right;
		probe.remove();
		return edge;
	});
	return Math.max(0, Math.min(r.right, width) - Math.max(r.left, 0));
};

test('the default launcher reads "hmm?"', async ({ page }) => {
	await page.goto('/launchers.html');
	await expect(part(page, 'launcher')).toHaveText('hmm?');
	await expect(part(page, 'launcher')).toHaveAttribute('title', 'Send feedback');
});

test('an edge tab peeks, slides in on hover and opens the panel beside it', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'end' });
	const tab = part(page, 'launcher');
	await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);

	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
	await expect(page.getByText('hmm?')).toBeInViewport();

	await tab.click();
	const panel = part(page, 'panel');
	await expect(panel).toBeVisible();
	const [p, t] = [await rect(panel), await rect(tab)];
	expect(p.right).toBeLessThanOrEqual(t.left);
	expect(p.bottom).toBeLessThanOrEqual(viewport(page).height);

	await page.mouse.move(10, 10);
	await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);

	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(tab).toBeFocused();
});

test('keyboard focus reveals an edge tab', async ({ page }) => {
	await open(page, { form: 'edge', side: 'left', align: 'start' });
	const tab = part(page, 'launcher');
	await expect.poll(async () => (await rect(tab)).right).toBeLessThan(12);
	await tab.focus();
	await expect.poll(async () => (await rect(tab)).right).toBeGreaterThan(60);
});

test('a top tab opens the panel below it', async ({ page }) => {
	await open(page, { form: 'edge', side: 'top', align: 'center', look: 'button' });
	const tab = part(page, 'launcher');
	await tab.focus();
	await page.keyboard.press('Enter');
	const [p, t] = [await rect(part(page, 'panel')), await rect(tab)];
	expect(p.top).toBeGreaterThanOrEqual(t.bottom);
});

test('a corner bubble keeps its label and opens the panel above it', async ({ page }) => {
	await open(page, { form: 'corner', corner: 'bottom-left' });
	const bubble = part(page, 'launcher');
	await expect(bubble).toHaveText('hmm?');
	await page.mouse.move(4, viewport(page).height - 4);
	await expect(page.getByText('hmm?')).toBeInViewport({ ratio: 1 });
	await bubble.click();
	const [p, b] = [await rect(part(page, 'panel')), await rect(bubble)];
	expect(p.bottom).toBeLessThanOrEqual(b.top);
});

test('an empty label gives an icon-only launcher named by its title', async ({ page }) => {
	await open(page, { form: 'floating', anchor: 'top', look: 'icon' }, '&label=');
	const button = part(page, 'launcher');
	await expect(button).toHaveAccessibleName('Send feedback');
	await expect(page.locator('[data-id="launcher-label"]')).toHaveCount(0);
	await button.click();
	const [p] = [await rect(part(page, 'panel'))];
	expect(p.top).toBeLessThan(100);
});

test('the deprecated position option still moves the launcher', async ({ page }) => {
	await page.goto('/launchers.html?position=bottom-left');
	const r = await rect(part(page, 'launcher'));
	expect(r.left).toBeLessThan(100);
});

test('reduced motion turns the slide off', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right' });
	const animated = () =>
		part(page, 'launcher').evaluate((el) => getComputedStyle(el).transitionProperty);
	expect(await animated()).toContain('transform');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await animated()).not.toContain('transform');
});

test('HmmTrigger and the hmm controller open the panel from anywhere', async ({ page }) => {
	await page.goto('/component.html');
	const trigger = page.getByTestId('trigger');
	await expect(trigger).toHaveText('hmm?');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await trigger.click();
	const panel = part(page, 'panel');
	await expect(panel).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	const p = await rect(panel);
	expect(p.top).toBeLessThan(40);
	expect(viewport(page).width - p.right).toBeLessThan(40);

	await part(page, 'close').click();
	await expect(panel).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await expect(page.getByTestId('trigger-link')).toHaveText('Something off? Tell us');
	await page.evaluate(() => (window as any).hmm.hmm.open('bottom-left'));
	await expect(panel).toBeVisible();
	expect((await rect(panel)).left).toBeLessThan(40);
	expect(await page.evaluate(() => (window as any).hmm.hmm.isOpen)).toBe(true);
	await page.evaluate(() => (window as any).hmm.hmm.close());
	await expect(panel).toHaveCount(0);
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 760 } });

	test('the first tap slides the tab in and the second opens the panel', async ({ page }) => {
		await open(page, { form: 'edge', side: 'right', align: 'end' });
		const tab = part(page, 'launcher');
		const r = await rect(tab);
		await page.touchscreen.tap(r.left + 4, (r.top + r.bottom) / 2);
		await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
		await expect(part(page, 'panel')).toHaveCount(0);

		await page.touchscreen.tap(20, 300);
		await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);

		await page.touchscreen.tap(r.left + 4, (r.top + r.bottom) / 2);
		await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
		const s = await rect(tab);
		await page.touchscreen.tap((s.left + s.right) / 2, (s.top + s.bottom) / 2);
		await expect(part(page, 'panel')).toBeVisible();
	});
});
