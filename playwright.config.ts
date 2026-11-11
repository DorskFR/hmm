import { defineConfig } from '@playwright/test';

export default defineConfig({
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	expect: { timeout: 10000 },
	workers: 1,
	projects: [
		{ name: 'unit', testDir: 'tests/unit', testMatch: '**/*.test.ts' },
		{
			name: 'browser',
			testDir: 'tests/browser',
			testMatch: '**/*.spec.ts',
			use: {
				browserName: 'chromium',
				viewport: { width: 1280, height: 800 },
				baseURL: 'http://localhost:4188',
			},
		},
	],
	webServer: {
		command: 'node demo/serve.mjs 4188',
		url: 'http://localhost:4188/',
		reuseExistingServer: !process.env.CI,
	},
});
