import { expect, type Page, test } from '@playwright/test';

const ENDPOINT = 'https://feedback.example.com';

async function mountEdge(page: Page) {
	await page.goto('/bare.html');
	await page.evaluate(
		(endpoint) =>
			(window as any).hmm.init({
				projectKey: 'my-app',
				endpoint,
				launcher: { form: 'edge', side: 'right', align: 'end' },
			}),
		ENDPOINT,
	);
}

for (const device of [
	{},
	{ hasTouch: true, isMobile: true, viewport: { width: 390, height: 760 } },
])
	test.describe(device.hasTouch ? 'on a phone' : 'with a mouse', () => {
		test.use(device);

		test('the README recipe sends a report through a routed endpoint', async ({ page }) => {
			const reports: unknown[] = [];
			await page.route(`${ENDPOINT}/v1/reports`, async (route) => {
				const post = route.request().method() === 'POST';
				if (post) reports.push(route.request().postDataJSON());
				await route.fulfill({
					status: post ? 202 : 204,
					headers: {
						'access-control-allow-origin': '*',
						'access-control-allow-headers': 'content-type, x-hmm-key',
						'access-control-allow-methods': 'POST, OPTIONS',
					},
				});
			});
			await mountEdge(page);

			const hmm = (id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
			await hmm('launcher').press('Enter');
			await hmm('comment').fill('The total looks wrong');
			await hmm('review').click();
			await hmm('send').click();
			await expect(hmm('result')).toBeVisible();
			expect(reports).toMatchObject([{ project: 'my-app', comment: 'The total looks wrong' }]);
		});
	});

test('the README pointer recipe opens an edge tab without force or coordinates', async ({
	page,
}) => {
	await mountEdge(page);
	const hmm = (id: string) => page.locator(`[data-hmm] [data-id="${id}"]`);
	await hmm('launcher-zone').hover();
	await expect(page.locator('[data-hmm-launcher]')).toHaveAttribute('data-state', 'out');
	await hmm('launcher').click();
	await expect(hmm('panel')).toBeVisible();
});
