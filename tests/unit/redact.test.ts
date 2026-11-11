import { expect, test } from '@playwright/test';
import { redactEnvelope, redactText, redactUrl } from '../../src/redact.ts';
import { PNG, sample } from './fixture.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';

test('redacts tokens, keys and credentials in free text', () => {
	const cases: [string, string][] = [
		[`my session is ${JWT} ok`, 'my session is [redacted-jwt] ok'],
		['Authorization: Bearer abcdef1234567890', 'Authorization: [redacted] [redacted]'],
		['key sk-abcdefghijklmnopqrstuvwx here', 'key [redacted-key] here'],
		['ghp_abcdefghijklmnopqrstuvwxyz0123456789', '[redacted-key]'],
		['AKIAIOSFODNN7EXAMPLE', '[redacted-key]'],
		['password=hunter2secret', 'password=[redacted]'],
		['{"access_token": "abcd1234"}', '{"access_token": "[redacted]"}'],
		['API_KEY = zzzz9999', 'API_KEY = [redacted]'],
		[
			'-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
			'[redacted-private-key]',
		],
	];
	for (const [input, expected] of cases) expect(redactText(input)).toBe(expected);
});

test('leaves ordinary text alone and is stable when applied twice', () => {
	const plain = 'The author said the checkout button is hard to find: move it up, please.';
	expect(redactText(plain)).toBe(plain);
	const once = redactText('token=abcd1234 and password: hunter2');
	expect(redactText(once)).toBe(once);
});

test('redacts credentials and secret query parameters in URLs', () => {
	expect(redactUrl('https://user:pw@example.com/a?access_token=abc&q=shoes&code=xyz#top')).toBe(
		'https://example.com/a?access_token=redacted&q=shoes&code=redacted#top',
	);
	expect(redactUrl('https://example.com/cb#id_token=abcdefgh')).toBe(
		'https://example.com/cb#id_token=[redacted]',
	);
	expect(redactUrl('not a url token=abcd1234')).toBe('not a url token=[redacted]');
});

test('scrubs every string of a report except attachment data', () => {
	const envelope = sample();
	envelope.comment = 'token=abcd1234';
	envelope.context = { deep: { list: ['password=hunter2secret'] } };
	const [first] = envelope.items;
	if (!first || !envelope.page) throw new Error('the fixture lost its item or page');
	first.comment = `see ${JWT}`;
	first.url = 'https://example.com/?api_key=abc';
	envelope.page.url = 'https://example.com/?session=abc&q=1';

	const clean = redactEnvelope(envelope);

	expect(clean.comment).toBe('token=[redacted]');
	expect(clean.context).toEqual({ deep: { list: ['password=[redacted]'] } });
	expect(clean.items[0]?.comment).toBe('see [redacted-jwt]');
	expect(clean.items[0]?.url).toBe('https://example.com/?api_key=redacted');
	expect(clean.page?.url).toBe('https://example.com/?session=redacted&q=1');
	expect(clean.attachments[0]?.data).toBe(PNG);
	expect(envelope.comment).toBe('token=abcd1234');
});
