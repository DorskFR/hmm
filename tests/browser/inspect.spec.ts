import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type { Target } from '../../src/envelope.ts';

const inspect = readFileSync(new URL('../../dist/inspect.js', import.meta.url), 'utf8');

const FORM = `
	<form id="account" action="/save" method="post">
		<input type="HIDDEN" name="authenticity_token" value="SECRETTOKEN123">
		<label>Email <input name="email" value="user@example.com"></label>
		<textarea name="notes">prefilled secret</textarea>
		<select name="account"><option value="acct-42" selected>x</option></select>
		<button type="submit">Save</button>
	</form>
	<div id="card"><input name="number" autocomplete="cc-number" value="4111111111111111"></div>
	<div id="login"><input name="pin" type="Password" value="hunter2"></div>
`;

async function capture(page: Page, selector: string): Promise<Target> {
	return page.evaluate(
		async ([source, sel]) => {
			const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
			const { describeElement } = await import(url);
			return describeElement(document.querySelector(sel));
		},
		[inspect, selector] as const,
	);
}

test.beforeEach(async ({ page }) => {
	await page.setContent(FORM);
});

test('a picked form keeps its structure but none of its field values', async ({ page }) => {
	const target = await capture(page, '#account');
	for (const secret of ['SECRETTOKEN123', 'user@example.com', 'prefilled secret', 'acct-42'])
		expect(JSON.stringify(target)).not.toContain(secret);
	expect(target.html).not.toContain('authenticity_token');
	expect(target.html).toContain('<form id="account" action="/save" method="post">');
	expect(target.html).toContain('<input name="email">');
	expect(target.html).toContain('<textarea name="notes"></textarea>');
	expect(target.html).toContain('<option selected="">x</option>');
	expect(target.html).toContain('<button type="submit">Save</button>');
	await expect(page.locator('#account input[name="email"]')).toHaveValue('user@example.com');
	await expect(page.locator('#account input[type="hidden"]')).toHaveCount(1);
});

test('a picked field is captured without its value', async ({ page }) => {
	const input = await capture(page, 'input[name="email"]');
	expect(input.html).toBe('<input name="email">');
	expect(input.attrs).toEqual({ name: 'email' });
	const textarea = await capture(page, 'textarea');
	expect(textarea.html).toBe('<textarea name="notes"></textarea>');
	expect(JSON.stringify(textarea)).not.toContain('prefilled secret');
});

test('card and password fields blank the whole capture', async ({ page }) => {
	for (const selector of ['#card', '#card input', '#login', '#login input']) {
		const target = await capture(page, selector);
		expect(target.html).toBe('');
		expect(JSON.stringify(target)).not.toMatch(/4111111111111111|hunter2/);
	}
});
