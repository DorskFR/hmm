import { expect, test } from '@playwright/test';
import { shortUrl } from '../../src/core.ts';

test('the page URL drops the scheme and keeps the ends of long segments', () => {
	expect(shortUrl('https://cctui.dorsk.dev/sessions/6e330306-1b2c-4d5e-8f90-a1b2c3c508226')).toBe(
		'cctui.dorsk.dev/sessions/6e330306…c508226',
	);
	expect(shortUrl('https://shop.example/')).toBe('shop.example');
	expect(shortUrl('http://localhost:4188/cart?q=1')).toBe('localhost:4188/cart?q=1');
	expect(shortUrl('not a url')).toBe('not a url');
});
