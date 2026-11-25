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
	await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
});

test('an edge tab tucks away again once the panel is closed with the mouse', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'end' });
	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
	await tab.click();
	await expect(part(page, 'panel')).toBeVisible();

	await part(page, 'close').click();
	await expect(part(page, 'panel')).toHaveCount(0);
	await expect(tab).toBeFocused();
	await page.mouse.move(10, 10);
	await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);
});

test('an edge tab slides out as the mouse comes close and opens from its wider zone', async ({
	page,
}) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const tab = part(page, 'launcher');
	const r = await rect(tab);
	const y = (r.top + r.bottom) / 2;
	const { width } = viewport(page);
	await page.mouse.move(width - 400, y);
	await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);

	await page.mouse.move(width - (r.right - r.left) - 20, y);
	await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(20);
	expect(await visibleWidth(page, tab)).toBeLessThan(60);

	const zone = await rect(part(page, 'launcher-zone'));
	expect(zone.right - zone.left).toBeGreaterThan(24);
	expect(zone.bottom - zone.top).toBeGreaterThan(r.bottom - r.top);
	await page.mouse.click(zone.right - 2, zone.top + 2);
	await expect(part(page, 'panel')).toBeVisible();
});

test('an edge tab reports tucked, peek and out in data-state', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const launcher = page.locator('[data-hmm-launcher]');
	const tab = part(page, 'launcher');
	const r = await rect(tab);
	const y = (r.top + r.bottom) / 2;
	const { width } = viewport(page);
	await page.mouse.move(width - 400, y);
	await expect(launcher).toHaveAttribute('data-state', 'tucked');

	await page.mouse.move(width - (r.right - r.left) - 20, y);
	await expect(launcher).toHaveAttribute('data-state', 'peek');

	await page.mouse.move((await rect(tab)).left + 4, y);
	await expect(launcher).toHaveAttribute('data-state', 'out');
	await tab.click();
	await expect(part(page, 'panel')).toBeVisible();
	await page.mouse.move(10, 10);
	await expect(launcher).toHaveAttribute('data-state', 'out');

	await part(page, 'close').click();
	await page.mouse.move(10, 10);
	await expect(launcher).toHaveAttribute('data-state', 'tucked');
});

test('a floating launcher is always out', async ({ page }) => {
	await open(page, { form: 'floating', anchor: 'bottom-right' });
	await expect(page.locator('[data-hmm-launcher]')).toHaveAttribute('data-state', 'out');
});

test('a corner bubble peeks out as the mouse comes close', async ({ page }) => {
	await open(page, { form: 'corner', corner: 'bottom-right' });
	const bubble = part(page, 'launcher');
	const { width, height } = viewport(page);
	const peek = async () => {
		const b = await rect(bubble);
		return Math.min(width, b.right) - b.left;
	};
	await page.mouse.move(width - 400, height - 400);
	const rest = await peek();
	await page.mouse.move(width - 90, height - 40);
	await expect.poll(peek).toBeGreaterThan(rest + 10);
});

test('keyboard focus reveals an edge tab', async ({ page }) => {
	await open(page, { form: 'edge', side: 'left', align: 'start' });
	const tab = part(page, 'launcher');
	await expect.poll(async () => (await rect(tab)).right).toBeLessThan(12);
	for (let i = 0; i < 10 && !(await tab.evaluate((el) => el === document.activeElement)); i++)
		await page.keyboard.press('Tab');
	await expect(tab).toBeFocused();
	await expect.poll(async () => (await rect(tab)).right).toBeGreaterThan(60);
});

test('focus moved by a script does not reveal an edge tab', async ({ page }) => {
	await open(page, { form: 'edge', side: 'left', align: 'start' });
	const tab = part(page, 'launcher');
	await page.mouse.click(300, 300);
	await tab.focus();
	await expect(tab).toBeFocused();
	await expect.poll(async () => (await rect(tab)).right).toBeLessThan(12);
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

const center = async (locator: Locator) => {
	const r = await rect(locator);
	return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
};
const settled = async (locator: Locator) => {
	let last = '';
	await expect
		.poll(
			async () => {
				const now = JSON.stringify(await locator.boundingBox());
				const same = now === last;
				last = now;
				return same;
			},
			{ intervals: [100] },
		)
		.toBe(true);
};
const dragTo = async (page: Page, locator: Locator, x: number, y: number) => {
	await settled(locator);
	const from = await center(locator);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++)
		await page.mouse.move(from.x + ((x - from.x) * i) / 10, from.y + ((y - from.y) * i) / 10);
	await page.mouse.up();
};
const launcherRoot = (page: Page) => page.locator('[data-hmm-launcher]');

test('an edge tab dragged to the left edge stays there after a reload', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await dragTo(page, tab, 4, 200);
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	await expect(part(page, 'panel')).toHaveCount(0);
	await expect(part(page, 'launcher-status')).toContainText('left');
	const top = (await center(tab)).y;
	expect(Math.abs(top - 200)).toBeLessThan(4);

	await page.reload();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	expect(Math.abs((await center(tab)).y - 200)).toBeLessThan(4);
	await expect.poll(async () => (await rect(tab)).right).toBeLessThan(12);
});

test('a drag shows where the launcher will land', async ({ page }) => {
	await open(page, { form: 'corner', corner: 'bottom-right' });
	const bubble = part(page, 'launcher');
	const { width, height } = viewport(page);
	await page.mouse.move(width - 90, height - 40);
	const from = await center(bubble);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x - 100, from.y - 100);
	await page.mouse.move(100, 100);
	const preview = await rect(part(page, 'launcher-preview'));
	expect(preview.left).toBe(0);
	expect(preview.top).toBe(0);
	await page.mouse.up();
	await expect(part(page, 'launcher-preview')).toHaveCount(0);
	await expect(launcherRoot(page)).toHaveAttribute('data-corner', 'top-left');
});

test('a click on a moved tab still opens the panel beside it', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'end' });
	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await dragTo(page, tab, 4, 300);
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	await tab.click();
	const panel = part(page, 'panel');
	await expect(panel).toBeVisible();
	const [p, t] = [await rect(panel), await rect(tab)];
	expect(p.left).toBeGreaterThanOrEqual(t.right);
});

test('a floating launcher snaps to another anchor', async ({ page }) => {
	await open(page, { form: 'floating', anchor: 'bottom-right' });
	await dragTo(page, part(page, 'launcher'), 40, 40);
	await expect(launcherRoot(page)).toHaveAttribute('data-anchor', 'top-left');
	await part(page, 'launcher').click();
	expect((await rect(part(page, 'panel'))).top).toBeLessThan(100);
});

test('a launcher with movable: false stays put', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center', movable: false });
	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await dragTo(page, tab, 4, 200);
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
	await tab.focus();
	await page.keyboard.press('Alt+ArrowLeft');
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
	await page.reload();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
});

test('a double-click or the panel button puts the launcher back', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const tab = part(page, 'launcher');
	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await dragTo(page, tab, 4, 200);
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	await tab.dblclick();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
	await expect(launcherRoot(page)).not.toHaveAttribute('data-offset', /.*/);
	await expect(part(page, 'launcher-status')).toHaveText('Back to its default place');
	await page.reload();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');

	await tab.hover({ position: { x: 3, y: 10 }, force: true });
	await dragTo(page, tab, 600, 4);
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'top');
	await tab.click();
	await part(page, 'reset-launcher').click();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
	await expect(part(page, 'reset-launcher')).toHaveCount(0);
	const [p, t] = [await rect(part(page, 'panel')), await rect(tab)];
	expect(p.right).toBeLessThanOrEqual(t.left);
});

test('Alt and the arrow keys move a focused launcher and announce it', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const tab = part(page, 'launcher');
	await expect(tab).toHaveAttribute('aria-describedby', /.+/);
	await tab.focus();
	await page.keyboard.press('Alt+ArrowUp');
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
	await expect(launcherRoot(page)).toHaveAttribute('data-offset', '320');
	await expect(part(page, 'launcher-status')).toHaveText('Moved: right 40%');
	await page.keyboard.press('Alt+ArrowLeft');
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	await expect(part(page, 'launcher-status')).toHaveText('Moved: left 40%');
	await expect(part(page, 'panel')).toHaveCount(0);
});

test('a stored spot that no longer fits is clamped, and a broken one ignored', async ({ page }) => {
	await open(page, { form: 'edge', side: 'right', align: 'center' });
	const key = `hmm:launcher:${new URL(page.url()).origin}:launchers`;
	await page.evaluate(
		(k) => localStorage.setItem(k, JSON.stringify({ form: 'edge', side: 'left', offset: 5000 })),
		key,
	);
	await page.reload();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'left');
	expect((await rect(part(page, 'launcher'))).bottom).toBeLessThanOrEqual(viewport(page).height);
	await page.evaluate((k) => localStorage.setItem(k, '{"form":"edge","side":"nowhere"}'), key);
	await page.reload();
	await expect(launcherRoot(page)).toHaveAttribute('data-side', 'right');
});

test('an app storageKey keeps its own spot', async ({ page }) => {
	await open(page, { form: 'corner', corner: 'bottom-right', storageKey: 'my-app:hmm' });
	const bubble = part(page, 'launcher');
	await bubble.focus();
	await page.keyboard.press('Alt+ArrowUp');
	await expect(launcherRoot(page)).toHaveAttribute('data-corner', 'top-right');
	expect(await page.evaluate(() => localStorage.getItem('my-app:hmm'))).toBe(
		'{"form":"corner","corner":"top-right"}',
	);
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

	test('a tap reports the tab as out before the second tap opens it', async ({ page }) => {
		await open(page, { form: 'edge', side: 'right', align: 'end' });
		const launcher = page.locator('[data-hmm-launcher]');
		const tab = part(page, 'launcher');
		await expect(launcher).toHaveAttribute('data-state', 'tucked');
		await tab.tap();
		await expect(launcher).toHaveAttribute('data-state', 'out');
		await expect(part(page, 'panel')).toHaveCount(0);
		await tab.tap();
		await expect(part(page, 'panel')).toBeVisible();
	});

	const swipe = async (page: Page, from: [number, number], to: [number, number]) => {
		const cdp = await page.context().newCDPSession(page);
		const point = ([x, y]: [number, number]) => [{ x, y }];
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
		for (let i = 1; i <= 8; i++) {
			const at: [number, number] = [
				from[0] + ((to[0] - from[0]) * i) / 8,
				from[1] + ((to[1] - from[1]) * i) / 8,
			];
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(at) });
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	};

	test('a swipe in the edge zone slides the tab out and a swipe back tucks it', async ({
		page,
	}) => {
		await open(page, { form: 'edge', side: 'right', align: 'end' });
		const tab = part(page, 'launcher');
		const zone = await rect(part(page, 'launcher-zone'));
		const { width } = viewport(page);
		const y = zone.top + 4;

		await swipe(page, [width - 6, y], [width - 120, y]);
		await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
		await expect(part(page, 'panel')).toHaveCount(0);

		const s = await rect(tab);
		const mid = (s.top + s.bottom) / 2;
		await swipe(page, [s.left + 10, mid], [width - 2, mid]);
		await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);
		await expect(part(page, 'panel')).toHaveCount(0);
	});

	test('a swipe along the edge moves the tab instead of pulling it out', async ({ page }) => {
		await open(page, { form: 'edge', side: 'right', align: 'end' });
		const zone = await rect(part(page, 'launcher-zone'));
		const { width } = viewport(page);
		await swipe(page, [width - 6, zone.top + 4], [width - 6, 200]);
		const root = page.locator('[data-hmm-launcher]');
		await expect(root).toHaveAttribute('data-side', 'right');
		await expect(root).toHaveAttribute('data-offset', /^(19\d|20\d|21\d)$/);
		await expect(part(page, 'panel')).toHaveCount(0);

		const tab = part(page, 'launcher');
		const r = await rect(tab);
		await swipe(page, [width - 6, (r.top + r.bottom) / 2], [width - 120, (r.top + r.bottom) / 2]);
		await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
		await expect(root).toHaveAttribute('data-side', 'right');
	});

	test('a short swipe springs back', async ({ page }) => {
		await open(page, { form: 'edge', side: 'right', align: 'end' });
		const tab = part(page, 'launcher');
		const zone = await rect(part(page, 'launcher-zone'));
		const { width } = viewport(page);
		await swipe(page, [width - 6, zone.top + 4], [width - 26, zone.top + 4]);
		await expect.poll(() => visibleWidth(page, tab)).toBeLessThan(12);
	});
});

test.describe('on a phone', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	for (const side of ['left', 'right'])
		for (const align of ['start', 'center', 'end'])
			test(`a ${side} ${align} tab opens a panel that leaves it uncovered`, async ({ page }) => {
				await open(page, { form: 'edge', side, align });
				const tab = part(page, 'launcher');
				const r = await rect(tab);
				await page.touchscreen.tap(
					side === 'right' ? r.left + 4 : r.right - 4,
					(r.top + r.bottom) / 2,
				);
				await expect.poll(() => visibleWidth(page, tab)).toBeGreaterThan(60);
				const s = await rect(tab);
				await page.touchscreen.tap((s.left + s.right) / 2, (s.top + s.bottom) / 2);
				const panel = part(page, 'panel');
				await expect(panel).toBeVisible();
				const [p, t] = [await rect(panel), await rect(tab)];
				expect(p.left < t.right && t.left < p.right && p.top < t.bottom && t.top < p.bottom).toBe(
					false,
				);
			});
	const openPanel = async (page: Page) => {
		await open(page, { form: 'floating', anchor: 'bottom-right' });
		await part(page, 'launcher').click();
		await expect(part(page, 'panel')).toBeVisible();
	};

	test('the attachment buttons line up in an even grid', async ({ page }) => {
		await openPanel(page);
		const [pick, shot, upload] = await Promise.all([
			rect(part(page, 'pick')),
			rect(part(page, 'shot')),
			rect(part(page, 'upload').locator('> *').first()),
		]);
		const width = pick.right - pick.left;
		for (const b of [shot, upload])
			expect(Math.abs(b.right - b.left - width)).toBeLessThanOrEqual(1);
		const panel = await rect(part(page, 'panel'));
		for (const b of [pick, shot, upload]) expect(b.right).toBeLessThanOrEqual(panel.right);
		expect(upload.left).toBeCloseTo(pick.left, 0);
	});

	test('the subtitle and the details label keep their spacing', async ({ page }) => {
		await openPanel(page);
		const subtitle = await rect(part(page, 'subtitle'));
		const label = await rect(part(page, 'panel').getByText('Details', { exact: true }));
		expect(label.top - subtitle.bottom).toBeGreaterThanOrEqual(12);
	});

	test('the panel stays clear of a host bottom bar', async ({ page }) => {
		await page.addInitScript(() =>
			document.addEventListener('DOMContentLoaded', () =>
				document.documentElement.style.setProperty('--hmm-inset-bottom', '64px'),
			),
		);
		await openPanel(page);
		const panel = await rect(part(page, 'panel'));
		expect(panel.bottom).toBeLessThanOrEqual(viewport(page).height - 64);
	});
});
