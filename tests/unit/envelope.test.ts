import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { type Envelope, LIMITS, validateEnvelope } from '../../src/envelope.ts';
import { sample } from './fixture.ts';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const schema = JSON.parse(
	readFileSync(new URL('../../schema/envelope.v1.json', import.meta.url), 'utf8'),
);
const matchesSchema = new (Ajv.default ?? Ajv)({ allErrors: true }).compile(schema);

type Loose = Record<string, any>;
const mutate = (change: (e: Loose) => void) => {
	const envelope = sample() as Loose;
	change(envelope);
	return envelope;
};

test('a complete report is valid for both the validator and the JSON schema', () => {
	expect(validateEnvelope(sample())).toEqual({ ok: true, envelope: sample() });
	expect(matchesSchema(sample())).toBe(true);
});

test('a minimal report without page, category or items is valid', () => {
	const minimal = mutate((e) => {
		delete e.page;
		delete e.category;
		e.items = [];
		e.attachments = [];
		e.context = {};
		e.kind = 'alert';
		e.fingerprint = 'disk-full';
	});
	expect(validateEnvelope(minimal).ok).toBe(true);
	expect(matchesSchema(minimal)).toBe(true);
});

const rejectedByBoth: [string, (e: Loose) => void, string][] = [
	['unknown top-level key', (e) => (e.extra = 1), 'envelope.extra'],
	['wrong version', (e) => (e.v = 2), 'envelope.v'],
	['missing project', (e) => delete e.project, 'envelope.project'],
	['project with a slash', (e) => (e.project = 'a/b'), 'envelope.project'],
	['id with spaces', (e) => (e.id = 'not an id'), 'envelope.id'],
	['unknown kind', (e) => (e.kind = 'spam'), 'envelope.kind'],
	['unknown category', (e) => (e.category = 'rant'), 'envelope.category'],
	['timestamp without zone', (e) => (e.createdAt = '2026-11-12 08:00'), 'envelope.createdAt'],
	['comment too long', (e) => (e.comment = 'x'.repeat(LIMITS.comment + 1)), 'envelope.comment'],
	['comment not a string', (e) => (e.comment = 5), 'envelope.comment'],
	['context as an array', (e) => (e.context = []), 'envelope.context'],
	[
		'too many items',
		(e) => (e.items = Array.from({ length: 21 }, (_, i) => ({ ...e.items[1], id: `i${i}` }))),
		'envelope.items',
	],
	['unknown item type', (e) => (e.items[0].type = 'note'), 'envelope.items[0].type'],
	['element item without target', (e) => delete e.items[0].target, 'envelope.items[0].target'],
	[
		'screenshot item without attachment',
		(e) => delete e.items[1].attachment,
		'envelope.items[1].attachment',
	],
	[
		'screenshot item with a target',
		(e) => (e.items[1].target = e.items[0].target),
		'envelope.items[1].target',
	],
	['fractional rect', (e) => (e.items[0].target.rect.x = 1.5), 'envelope.items[0].target.rect.x'],
	[
		'non-string attribute',
		(e) => (e.items[0].target.attrs.role = 3),
		'envelope.items[0].target.attrs.role',
	],
	['non-PNG attachment', (e) => (e.attachments[0].mime = 'image/svg+xml'), 'attachments[0].mime'],
	[
		'attachment that is not base64',
		(e) => (e.attachments[0].data = '<svg onload=alert(1)>'),
		'attachments[0].data',
	],
	['attachment with zero width', (e) => (e.attachments[0].width = 0), 'attachments[0].width'],
	[
		'attachment too large',
		(e) => (e.attachments[0].data = 'A'.repeat(LIMITS.attachmentChars + 4)),
		'attachments[0].data',
	],
	['unknown page key', (e) => (e.page.cookies = 'a=b'), 'envelope.page.cookies'],
];

for (const [name, change, path] of rejectedByBoth) {
	test(`rejects ${name}`, () => {
		const envelope = mutate(change);
		const result = validateEnvelope(envelope);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join('\n')).toContain(path);
		expect(matchesSchema(envelope)).toBe(false);
	});
}

test('rejects an item pointing at an attachment that is not in the report', () => {
	const result = validateEnvelope(mutate((e) => (e.items[0].attachment = 'ghost')));
	expect(result).toEqual({
		ok: false,
		errors: ['envelope.items[0].attachment: does not match an attachment'],
	});
});

test('rejects duplicated attachment ids', () => {
	const result = validateEnvelope(mutate((e) => (e.attachments[1].id = 'att-1')));
	expect(result.ok).toBe(false);
});

test('rejects a context that serialises beyond the cap', () => {
	const result = validateEnvelope(
		mutate((e) => (e.context = { blob: 'x'.repeat(LIMITS.contextChars) })),
	);
	expect(result).toEqual({
		ok: false,
		errors: [`envelope.context: must serialise to at most ${LIMITS.contextChars} characters`],
	});
});

test('rejects values that are not objects', () => {
	for (const value of [null, 'text', 42, [], undefined])
		expect(validateEnvelope(value as unknown as Envelope).ok).toBe(false);
});
