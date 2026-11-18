import { expect, test } from '@playwright/test';
import { setupOf, transportOf } from '../../src/core.ts';

const transport = async () => {};

test('a blank endpoint without a transport turns the panel off without an error', () => {
	for (const endpoint of ['', '   ', '\n\t'])
		expect(setupOf({ projectKey: 'app', endpoint })).toEqual({ transport: null });
	expect(setupOf({ projectKey: 'has space', endpoint: ' ' })).toEqual({ transport: null });
});

test('invalid options are reported instead of thrown', () => {
	expect(setupOf({ projectKey: 'has space', endpoint: 'https://x.test' })).toMatchObject({
		transport: null,
		error: expect.stringContaining('projectKey'),
	});
	expect(setupOf({ projectKey: 'app' })).toMatchObject({
		transport: null,
		error: expect.stringContaining('endpoint or transport'),
	});
});

test('valid options give a transport', () => {
	expect(setupOf({ projectKey: 'app', endpoint: 'https://x.test' }).transport).toBeInstanceOf(
		Function,
	);
	expect(setupOf({ projectKey: 'app', endpoint: '', transport })).toEqual({ transport });
});

test('transportOf still throws, and treats a blank endpoint as missing', () => {
	expect(() => transportOf({ projectKey: 'app', endpoint: '  ' })).toThrow('endpoint or transport');
	expect(() => transportOf({ projectKey: '', endpoint: 'https://x.test' })).toThrow('projectKey');
});
