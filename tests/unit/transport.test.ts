import { expect, test } from '@playwright/test';
import type { Envelope } from '../../src/envelope.ts';
import { enqueue, flush, SendError } from '../../src/transport.ts';
import { sample } from './fixture.ts';

function memoryStorage(quota = Number.POSITIVE_INFINITY): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (value.length > quota) throw new Error('quota exceeded');
			map.set(key, value);
		},
		removeItem: (key: string) => void map.delete(key),
	} as Storage;
}

const report = (id: string): Envelope => ({ ...sample(), id });

test('queued reports are sent in order and removed', async () => {
	const storage = memoryStorage();
	expect(enqueue(storage, 'k', report('a'))).toBe(true);
	expect(enqueue(storage, 'k', report('b'))).toBe(true);
	const seen: string[] = [];

	const sent = await flush(storage, 'k', async (e) => void seen.push(e.id));

	expect(sent).toBe(2);
	expect(seen).toEqual(['a', 'b']);
	expect(storage.getItem('k')).toBeNull();
});

test('a retryable failure keeps the report queued, a permanent one drops it', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'));

	await flush(storage, 'k', async () => {
		throw new SendError('down', true);
	});
	expect(JSON.parse(storage.getItem('k') ?? '[]')).toHaveLength(1);

	await flush(storage, 'k', async () => {
		throw new SendError('rejected', false);
	});
	expect(storage.getItem('k')).toBeNull();
});

test('enqueue reports failure when the queue is full or the quota is exceeded', () => {
	const storage = memoryStorage();
	for (let i = 0; i < 5; i++) expect(enqueue(storage, 'k', report(`r${i}`))).toBe(true);
	expect(enqueue(storage, 'k', report('r5'))).toBe(false);
	expect(enqueue(memoryStorage(10), 'k', report('a'))).toBe(false);
});

test('corrupt or invalid queue entries are ignored', async () => {
	const storage = memoryStorage();
	storage.setItem('k', JSON.stringify([{ nope: true }, report('ok')]));
	const seen: string[] = [];
	await flush(storage, 'k', async (e) => void seen.push(e.id));
	expect(seen).toEqual(['ok']);

	storage.setItem('k', 'not json');
	expect(await flush(storage, 'k', async () => {})).toBe(0);
});
