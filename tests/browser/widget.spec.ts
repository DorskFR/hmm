import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { Envelope } from '../../src/envelope.ts';

const part = (page: Page, id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
const category = (page: Page, name: string) =>
	page.locator('[data-hmm]').getByRole('radio', { name });
const received = async (request: APIRequestContext): Promise<Envelope[]> =>
	(await request.get('/__reports')).json();

async function clickOnPage(page: Page, selector: string) {
	const box = await page.locator(selector).boundingBox();
	if (!box) throw new Error(`${selector} is not visible`);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function pick(page: Page, selector: string) {
	await part(page, 'pick').click();
	await expect(part(page, 'panel')).toBeHidden();
	await clickOnPage(page, selector);
	await expect(part(page, 'panel')).toBeVisible();
}

async function sendDraft(page: Page) {
	await part(page, 'review').click();
	await part(page, 'send').click();
}

test.beforeEach(async ({ request }) => {
	await request.delete('/__reports');
});

test('a comment is reviewed, sent and received as a valid report', async ({ page, request }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await expect(part(page, 'review')).toBeDisabled();
	await category(page, 'Problem').click();
	await part(page, 'comment').fill('The price is hard to read');

	await part(page, 'review').click();
	await expect(part(page, 'review-body')).toContainText('The price is hard to read');
	await expect(part(page, 'review-body')).toContainText('Problem');
	await part(page, 'raw').getByRole('button').click();
	await expect(part(page, 'raw').getByText('"appVersion": "1.2.3"')).toBeVisible();
	expect(await received(request)).toHaveLength(0);

	await part(page, 'send').click();
	await expect(part(page, 'message')).toHaveText('Thanks, your feedback was sent.');

	const [report, ...rest] = await received(request);
	expect(rest).toHaveLength(0);
	expect(report).toMatchObject({
		v: 1,
		kind: 'feedback',
		category: 'problem',
		project: 'demo',
		comment: 'The price is hard to read',
		client: { name: '@dorsk/hmm' },
		context: { app: 'demo-shop', appVersion: '1.2.3' },
		page: { url: 'http://localhost:4188/', title: 'hmm demo shop', viewport: { width: 1280 } },
		items: [],
		attachments: [],
	});

	await part(page, 'done').click();
	await expect(part(page, 'panel')).toBeHidden();
	await part(page, 'launcher').click();
	await expect(part(page, 'comment')).toHaveValue('');
});

test('selecting an element records it with a screenshot and does not click it', async ({
	page,
	request,
}) => {
	await page.goto('/');
	await page.evaluate(() => {
		document.querySelector('#buy')?.addEventListener('click', () => {
			document.title = 'clicked';
		});
	});
	await part(page, 'launcher').click();
	await part(page, 'pick').click();
	await expect(page.locator('[data-hmm] .hint')).toHaveText(
		'Click what you mean. Press Esc to cancel.',
	);
	await clickOnPage(page, '#buy');

	await expect(part(page, 'item-label')).toHaveText('<button> Add to cart');
	await expect(part(page, 'item').locator('img')).toBeVisible();
	await expect(part(page, 'item-comment')).toBeFocused();
	await expect(page.locator('[data-hmm] .pin')).toHaveText('1');
	expect(await page.title()).toBe('hmm demo shop');

	await part(page, 'item-comment').fill('Make this bigger');
	await sendDraft(page);
	await expect(part(page, 'message')).toBeVisible();

	const [report] = await received(request);
	expect(report?.comment).toBe('');
	expect(report?.items).toHaveLength(1);
	const item = report?.items[0];
	expect(item).toMatchObject({
		type: 'element',
		url: 'http://localhost:4188/',
		comment: 'Make this bigger',
		target: { selector: '#buy', tag: 'button', text: 'Add to cart', attrs: { type: 'button' } },
	});
	const attachment = report?.attachments[0];
	expect(attachment?.id).toBe(item?.attachment);
	expect(attachment?.data.startsWith('iVBORw0KGgo')).toBe(true);
	expect(attachment?.width).toBeGreaterThan(20);
	expect(attachment?.height).toBeGreaterThan(10);

	const pixel = await page.evaluate(async (data) => {
		const image = new Image();
		image.src = `data:image/png;base64,${data}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext('2d');
		context?.drawImage(image, 0, 0);
		return [...(context?.getImageData(4, Math.floor(image.height / 2), 1, 1).data ?? [])];
	}, attachment?.data ?? '');
	expect(pixel).toEqual([10, 125, 79, 255]);
});

test('test hooks win over ids in the recorded selector', async ({ page, request }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await pick(page, '[data-testid="wishlist"]');
	await sendDraft(page);
	await expect(part(page, 'message')).toBeVisible();
	const [report] = await received(request);
	expect(report?.items[0]).toMatchObject({ target: { selector: '[data-testid="wishlist"]' } });
});

test('Escape cancels a selection and then closes the panel', async ({ page }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await part(page, 'pick').click();
	await expect(part(page, 'panel')).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(part(page, 'panel')).toBeVisible();
	await expect(part(page, 'item')).toHaveCount(0);

	await part(page, 'comment').press('Escape');
	await expect(part(page, 'panel')).toBeHidden();
	await expect(part(page, 'launcher')).toBeVisible();
});

test('a viewport screenshot is attached at the viewport size', async ({ page, request }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await part(page, 'shot').click();
	await expect(part(page, 'item-label')).toHaveText('Screenshot');
	await sendDraft(page);
	await expect(part(page, 'message')).toBeVisible();

	const [report] = await received(request);
	expect(report?.items[0]).toMatchObject({ type: 'screenshot' });
	expect(report?.attachments[0]).toMatchObject({ mime: 'image/png', width: 1280, height: 800 });
});

test('items and their images can be removed, and the draft discarded', async ({
	page,
	request,
}) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await pick(page, '#buy');
	await pick(page, '.price');
	await part(page, 'shot').click();
	await expect(part(page, 'item')).toHaveCount(3);

	await part(page, 'remove-image').first().click();
	await expect(part(page, 'item').first().locator('img')).toHaveCount(0);
	await part(page, 'remove').nth(1).click();
	await expect(part(page, 'item')).toHaveCount(2);

	await sendDraft(page);
	await expect(part(page, 'message')).toBeVisible();
	const [report] = await received(request);
	expect(report?.items.map((i) => i.type)).toEqual(['element', 'screenshot']);
	expect(report?.items[0]).not.toHaveProperty('attachment');
	expect(report?.attachments).toHaveLength(1);

	await part(page, 'done').click();
	await part(page, 'launcher').click();
	await part(page, 'comment').fill('never mind');
	await part(page, 'discard').click();
	await expect(part(page, 'comment')).toHaveValue('');
	await expect(part(page, 'review')).toBeDisabled();
});

test('secrets are scrubbed before the review and never leave the page', async ({
	page,
	request,
}) => {
	await page.goto('/?access_token=supersecretvalue&q=1');
	await part(page, 'launcher').click();
	await part(page, 'comment').fill('login fails with token=abcd1234secret');
	await pick(page, 'input[name="password"]');

	await part(page, 'review').click();
	await expect(part(page, 'review-body')).toContainText('token=[redacted]');
	await expect(part(page, 'review-body')).not.toContainText('abcd1234secret');
	await expect(part(page, 'review-body')).not.toContainText('supersecretvalue');
	await part(page, 'send').click();
	await expect(part(page, 'message')).toBeVisible();

	const [report] = await received(request);
	const text = JSON.stringify({ ...report, attachments: [] });
	expect(text).not.toContain('abcd1234secret');
	expect(text).not.toContain('supersecretvalue');
	expect(text).not.toContain('hunter2');
	expect(report?.page?.url).toBe('http://localhost:4188/?access_token=redacted&q=1');
	expect(report?.items[0]).toMatchObject({ target: { tag: 'input', html: '' } });
});

test('the draft survives a reload', async ({ page }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	await category(page, 'Question').click();
	await part(page, 'comment').fill('Is there a dark mode?');
	await pick(page, '#buy');
	await part(page, 'item-comment').fill('here');

	await page.reload();
	await part(page, 'launcher').click();
	await expect(part(page, 'comment')).toHaveValue('Is there a dark mode?');
	await expect(category(page, 'Question')).toHaveAttribute('aria-checked', 'true');
	await expect(part(page, 'item-comment')).toHaveValue('here');
	await expect(part(page, 'item').locator('img')).toBeVisible();
});

test('a stored draft that is not well formed is ignored', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() =>
		sessionStorage.setItem(
			'hmm:draft:demo',
			JSON.stringify({
				category: 'idea',
				comment: 'stale',
				items: [{ id: 'x', type: 'element' }],
				attachments: [],
			}),
		),
	);
	await page.reload();
	await part(page, 'launcher').click();
	await expect(part(page, 'comment')).toHaveValue('');
	await expect(part(page, 'item')).toHaveCount(0);
});

test('a failed send is queued and delivered on the next visit', async ({ page, request }) => {
	await page.goto('/');
	await request.get('/__fail?n=1');
	await part(page, 'launcher').click();
	await part(page, 'comment').fill('sent while the server was down');
	await sendDraft(page);
	await expect(part(page, 'message')).toContainText('saved and will be sent automatically');
	expect(await received(request)).toHaveLength(0);

	await page.reload();
	await expect.poll(async () => (await received(request)).length).toBe(1);
	expect((await received(request))[0]?.comment).toBe('sent while the server was down');
	expect(await page.evaluate(() => localStorage.getItem('hmm:outbox:demo'))).toBeNull();
});

test('a rejected send keeps the draft and shows an error', async ({ page }) => {
	await page.goto('/bare.html');
	await page.evaluate(() => {
		const { init, SendError } = (window as any).hmm;
		init({
			projectKey: 'bare',
			transport: async () => {
				throw new SendError('rejected', false);
			},
		});
	});
	await part(page, 'launcher').click();
	await part(page, 'comment').fill('keep me');
	await sendDraft(page);
	await expect(part(page, 'error')).toHaveText('Sending failed. Please try again.');
	await part(page, 'back').click();
	await expect(part(page, 'comment')).toHaveValue('keep me');
	expect(await page.evaluate(() => localStorage.getItem('hmm:outbox:bare'))).toBeNull();
});

test('a host transport, context and beforeSend shape what is sent', async ({ page, request }) => {
	await page.goto('/bare.html');
	await page.evaluate(() => {
		const w = window as any;
		w.sent = [];
		w.notified = [];
		w.widget = w.hmm.init({
			projectKey: 'bare',
			launcher: false,
			labels: { title: 'Tell us', send: 'Ship it' },
			context: async () => ({ route: 'bare' }),
			beforeSend: (e: any) => ({ ...e, context: { ...e.context, checked: true } }),
			transport: async (e: any) => void w.sent.push(e),
			onSent: (e: any) => w.notified.push(e.id),
		});
	});
	await expect(part(page, 'launcher')).toHaveCount(0);
	await page.evaluate(() => (window as any).widget.open());
	expect(await page.evaluate(() => (window as any).widget.isOpen)).toBe(true);
	await expect(part(page, 'panel').locator('h2')).toHaveText('Tell us');

	await part(page, 'comment').fill('through the host');
	await part(page, 'review').click();
	await expect(part(page, 'send')).toHaveText('Ship it');
	await part(page, 'send').click();
	await expect(part(page, 'message')).toBeVisible();

	const sent = await page.evaluate(() => (window as any).sent);
	expect(sent).toHaveLength(1);
	expect(sent[0]).toMatchObject({
		project: 'bare',
		comment: 'through the host',
		context: { route: 'bare', checked: true },
	});
	expect(await page.evaluate(() => (window as any).notified)).toEqual([sent[0].id]);
	expect(await received(request)).toHaveLength(0);

	await page.evaluate(() => (window as any).widget.destroy());
	await expect(page.locator('[data-hmm]')).toHaveCount(0);
});

test('beforeSend returning null blocks the report', async ({ page }) => {
	await page.goto('/bare.html');
	await page.evaluate(() => {
		const w = window as any;
		w.sent = 0;
		w.hmm.init({
			projectKey: 'bare',
			beforeSend: () => null,
			transport: async () => void w.sent++,
		});
	});
	await part(page, 'launcher').click();
	await part(page, 'comment').fill('blocked');
	await part(page, 'review').click();
	await expect(part(page, 'error')).toHaveText('This feedback cannot be sent from this page.');
	await expect(part(page, 'send')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).sent)).toBe(0);
});

test('init validates its options and replaces a previous instance', async ({ page }) => {
	await page.goto('/bare.html');
	const errors = await page.evaluate(() => {
		const { init } = (window as any).hmm;
		const message = (fn: () => void) => {
			try {
				fn();
				return '';
			} catch (err) {
				return (err as Error).message;
			}
		};
		const out = [
			message(() => init({ projectKey: 'has space', endpoint: '/' })),
			message(() => init({ projectKey: 'ok' })),
		];
		init({ projectKey: 'one', endpoint: location.origin });
		init({ projectKey: 'two', endpoint: location.origin });
		return out;
	});
	expect(errors[0]).toContain('projectKey');
	expect(errors[1]).toContain('endpoint or transport');
	await expect(page.locator('[data-hmm]')).toHaveCount(1);
});

const surface = (page: Page) =>
	page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.background = 'var(--surface)';
		document.body.append(probe);
		const color = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return color;
	});
const background = (page: Page, id: string) =>
	part(page, id).evaluate((el) => getComputedStyle(el).backgroundColor);

test('the panel is drawn with the host theme and follows a theme switch', async ({ page }) => {
	await page.goto('/');
	await part(page, 'launcher').click();
	const light = await surface(page);
	expect(await background(page, 'panel')).toBe(light);

	await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dracula'));
	const dark = await surface(page);
	expect(dark).not.toBe(light);
	await expect.poll(() => background(page, 'panel')).toBe(dark);
});

test('as a component, the host opens it and reads its state', async ({ page, request }) => {
	await page.goto('/component.html');
	await expect(part(page, 'launcher')).toHaveCount(0);
	await expect(page.getByTestId('host-state')).toHaveText('closed');
	await page.getByTestId('host-open').click();
	await expect(page.getByTestId('host-state')).toHaveText('open');
	await expect(part(page, 'comment')).toBeFocused();

	await part(page, 'comment').fill('from a component');
	await sendDraft(page);
	await expect(part(page, 'message')).toBeVisible();
	const [report] = await received(request);
	expect(report).toMatchObject({ project: 'component', comment: 'from a component' });

	await part(page, 'done').click();
	await expect(page.getByTestId('host-state')).toHaveText('closed');
	await expect(part(page, 'panel')).toHaveCount(0);
});
