import { expect, test } from '@playwright/test';
import type { Envelope } from '../../src/envelope.ts';
import { enqueue, flush, httpTransport, SendError } from '../../src/transport.ts';
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

test.describe('httpTransport', () => {
	const realFetch = globalThis.fetch;
	test.afterEach(() => {
		globalThis.fetch = realFetch;
	});
	const answer = (status: number, body: string) => {
		const calls: { url: string; init: RequestInit }[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(body, { status, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		return calls;
	};
	const failure = async (status: number, body: string) => {
		answer(status, body);
		try {
			await httpTransport('https://hmm.test', 'app')(sample());
		} catch (err) {
			return err as SendError;
		}
		throw new Error('the transport did not throw');
	};

	test('posts the envelope with the project key and no credentials', async () => {
		const calls = answer(202, '{}');
		await httpTransport('https://hmm.test//', 'app')(sample());
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe('https://hmm.test/v1/reports');
		expect(calls[0]?.init).toMatchObject({
			method: 'POST',
			credentials: 'omit',
			headers: { 'x-hmm-key': 'app' },
		});
	});

	test('a permanent rejection carries the status and the server message', async () => {
		const err = await failure(403, JSON.stringify({ error: 'unknown project' }));
		expect(err).toBeInstanceOf(SendError);
		expect(err).toMatchObject({ retryable: false, status: 403, detail: 'unknown project' });
		expect(err.message).toBe('the server answered 403: unknown project');
	});

	test('a rejection without a readable body still has its status', async () => {
		for (const body of ['<html>nope</html>', '', '{"error": 42}']) {
			const err = await failure(400, body);
			expect(err).toMatchObject({ retryable: false, status: 400, detail: undefined });
			expect(err.message).toBe('the server answered 400');
		}
	});

	test('server errors, timeouts and rate limits are retryable', async () => {
		for (const status of [500, 503, 408, 429]) {
			const err = await failure(status, JSON.stringify({ error: 'busy' }));
			expect(err).toMatchObject({ retryable: true, status, detail: undefined });
		}
	});
});
