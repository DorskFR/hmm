import { expect, test } from '@playwright/test';
import type { Envelope } from '../../src/envelope.ts';
import {
	BACKOFF_CAP,
	backoff,
	discard,
	enqueue,
	failureOf,
	flush,
	httpTransport,
	MAX_500_ATTEMPTS,
	MAX_AGE,
	MAX_ATTEMPTS,
	nextDue,
	OUTBOX_MAX,
	readOutbox,
	retryAfterOf,
	SendError,
} from '../../src/transport.ts';
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

	const outcomes = await flush(storage, 'k', async (e) => void seen.push(e.id));

	expect(outcomes.map((o) => [o.envelope.id, o.state])).toEqual([
		['a', 'sent'],
		['b', 'sent'],
	]);
	expect(seen).toEqual(['a', 'b']);
	expect(storage.getItem('k')).toBeNull();
});

test('plain envelopes queued by older versions still load and send', async () => {
	const storage = memoryStorage();
	const old = report('old');
	storage.setItem('k', JSON.stringify([old]));

	const [entry] = readOutbox(storage, 'k', 42);
	expect(entry).toEqual({ envelope: old, queuedAt: 42, attempts: 0 });
	expect(enqueue(storage, 'k', report('new'))).toBe(true);

	const seen: string[] = [];
	await flush(storage, 'k', async (e) => void seen.push(e.id));
	expect(seen).toEqual(['old', 'new']);
	expect(storage.getItem('k')).toBeNull();
});

test('a failed send is stored with its error, attempt and backoff', () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'), new TypeError('Failed to fetch'), 1000);
	expect(readOutbox(storage, 'k', 1000)).toEqual([
		{
			envelope: report('a'),
			queuedAt: 1000,
			attempts: 1,
			triedAt: 1000,
			nextAt: 1000 + backoff(1),
			error: { message: 'Failed to fetch', network: true },
		},
	]);
});

test('malformed metadata falls back to safe defaults', () => {
	const storage = memoryStorage();
	storage.setItem(
		'k',
		JSON.stringify([
			{ envelope: report('a'), attempts: 'x', queuedAt: null, error: { message: 3 } },
		]),
	);
	expect(readOutbox(storage, 'k', 5)).toEqual([
		{ envelope: report('a'), queuedAt: 5, attempts: 0 },
	]);
});

test('backoff doubles and is capped', () => {
	expect([1, 2, 3, 4].map(backoff)).toEqual([30_000, 60_000, 120_000, 240_000]);
	expect(backoff(50)).toBe(BACKOFF_CAP);
});

test('entries are not retried before they are due, unless forced', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'), new SendError('down', true), 0);
	const seen: string[] = [];
	const send = async (e: Envelope) => void seen.push(e.id);

	expect(await flush(storage, 'k', send, { now: () => backoff(1) - 1 })).toEqual([]);
	expect(seen).toEqual([]);
	await flush(storage, 'k', send, { now: () => 1, force: true });
	expect(seen).toEqual(['a']);
});

test('a retryable failure keeps the report and pushes back its next try', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'), new SendError('down', true), 0);
	let t = backoff(1);
	await flush(
		storage,
		'k',
		async () => {
			throw new SendError('the server answered 503', true, { status: 503, detail: 'busy' });
		},
		{ now: () => t },
	);
	expect(readOutbox(storage, 'k', t)[0]).toMatchObject({
		attempts: 2,
		triedAt: t,
		nextAt: t + backoff(2),
		error: { status: 503, message: 'busy' },
	});
	t += 1;
	await flush(
		storage,
		'k',
		async () => {
			throw new SendError('slow down', true, { status: 429, retryAfter: 3_600_000 });
		},
		{ now: () => t, force: true },
	);
	expect(readOutbox(storage, 'k', t)[0]?.nextAt).toBe(t + 3_600_000);
});

test('a stuck entry does not block the ones behind it', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('stuck'));
	enqueue(storage, 'k', report('fine'));
	const outcomes = await flush(storage, 'k', async (e) => {
		if (e.id === 'stuck') throw new SendError('down', true, { status: 503 });
	});
	expect(outcomes.map((o) => [o.envelope.id, o.state])).toEqual([['fine', 'sent']]);
	expect(readOutbox(storage, 'k').map((e) => e.envelope.id)).toEqual(['stuck']);
});

test('a permanent rejection is reported as rejected, not sent', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'));
	const outcomes = await flush(storage, 'k', async () => {
		throw new SendError('the server answered 400: bad', false, { status: 400, detail: 'bad' });
	});
	expect(outcomes).toEqual([
		{ state: 'rejected', envelope: report('a'), error: { status: 400, message: 'bad' } },
	]);
	expect(storage.getItem('k')).toBeNull();
});

test('entries give up after the attempt limit, sooner for a plain 500', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'));
	enqueue(storage, 'k', report('b'));
	const fail = async (e: Envelope) => {
		throw e.id === 'a'
			? new SendError('x', true, { status: 500 })
			: new SendError('x', true, { status: 503 });
	};
	const states: Record<string, number> = {};
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		for (const o of await flush(storage, 'k', fail, { force: true })) states[o.envelope.id] = i + 1;
	}
	expect(states).toEqual({ a: MAX_500_ATTEMPTS, b: MAX_ATTEMPTS });
	expect(storage.getItem('k')).toBeNull();
});

test('entries older than the maximum age expire without being sent', async () => {
	const storage = memoryStorage();
	enqueue(storage, 'k', report('a'), new SendError('down', true), 0);
	let calls = 0;
	const outcomes = await flush(storage, 'k', async () => void calls++, {
		now: () => MAX_AGE + 1,
		force: true,
	});
	expect(outcomes.map((o) => o.state)).toEqual(['expired']);
	expect(calls).toBe(0);
	expect(storage.getItem('k')).toBeNull();
});

test('one entry can be retried or discarded on its own', async () => {
	const storage = memoryStorage();
	for (const id of ['a', 'b', 'c'])
		enqueue(storage, 'k', report(id), new SendError('down', true), 0);
	const seen: string[] = [];
	await flush(storage, 'k', async (e) => void seen.push(e.id), {
		only: 'b',
		force: true,
		now: () => 1,
	});
	expect(seen).toEqual(['b']);
	discard(storage, 'k', 'a');
	expect(readOutbox(storage, 'k').map((e) => e.envelope.id)).toEqual(['c']);
});

test('nextDue is the earliest next try', () => {
	expect(nextDue([])).toBeNull();
	const base = { envelope: report('a'), queuedAt: 0, attempts: 1 };
	expect(
		nextDue([
			{ ...base, nextAt: 50 },
			{ ...base, nextAt: 20 },
		]),
	).toBe(20);
	expect(nextDue([{ ...base, nextAt: 50 }, base])).toBe(0);
});

test('failureOf explains network errors and keeps the server message', () => {
	expect(failureOf(new TypeError('Failed to fetch'))).toEqual({
		message: 'Failed to fetch',
		network: true,
	});
	expect(failureOf(new SendError('blocked', true, { network: true }))).toEqual({
		message: 'blocked',
		network: true,
	});
	expect(failureOf(new SendError('the server answered 507', false, { status: 507 }))).toEqual({
		message: '',
		status: 507,
	});
	expect(failureOf('nope')).toEqual({ message: 'nope' });
});

test('Retry-After is read as seconds or a date', () => {
	expect(retryAfterOf('120')).toBe(120_000);
	expect(retryAfterOf(new Date(61_000).toUTCString(), 1000)).toBe(60_000);
	expect(retryAfterOf(null)).toBeUndefined();
	expect(retryAfterOf('soon')).toBeUndefined();
	expect(retryAfterOf('0')).toBeUndefined();
});

test('enqueue reports failure when the queue is full or the quota is exceeded', () => {
	const storage = memoryStorage();
	for (let i = 0; i < OUTBOX_MAX; i++) expect(enqueue(storage, 'k', report(`r${i}`))).toBe(true);
	expect(enqueue(storage, 'k', report('r5'))).toBe(false);
	expect(enqueue(memoryStorage(10), 'k', report('a'))).toBe(false);
});

test('corrupt or invalid queue entries are ignored', async () => {
	const storage = memoryStorage();
	storage.setItem('k', JSON.stringify([{ nope: true }, { envelope: { id: 1 } }, report('ok')]));
	const seen: string[] = [];
	await flush(storage, 'k', async (e) => void seen.push(e.id));
	expect(seen).toEqual(['ok']);

	storage.setItem('k', 'not json');
	expect(await flush(storage, 'k', async () => {})).toEqual([]);
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
			expect(err).toMatchObject({ retryable: true, status, detail: 'busy' });
		}
	});

	test('a full storage budget and other permanent 5xx are not retried', async () => {
		for (const status of [501, 507]) {
			const err = await failure(status, JSON.stringify({ error: 'storage budget reached' }));
			expect(err).toMatchObject({ retryable: false, status, detail: 'storage budget reached' });
		}
	});

	test('Retry-After is carried on the error', async () => {
		globalThis.fetch = (async () =>
			new Response('', { status: 503, headers: { 'retry-after': '90' } })) as typeof fetch;
		const err = await httpTransport('https://hmm.test', 'app')(sample()).catch((e) => e);
		expect(err).toMatchObject({ retryable: true, status: 503, retryAfter: 90_000 });
	});

	test('a request that never gets a response is a retryable network error', async () => {
		globalThis.fetch = (async () => {
			throw new TypeError('Failed to fetch');
		}) as typeof fetch;
		const err = await httpTransport('https://hmm.test', 'app')(sample()).catch((e) => e);
		expect(err).toBeInstanceOf(SendError);
		expect(err).toMatchObject({ retryable: true, network: true, message: 'Failed to fetch' });
		expect(err.status).toBeUndefined();
	});
});
