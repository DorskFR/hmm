import { type Envelope, validateEnvelope } from './envelope.ts';

export type Transport = (envelope: Envelope) => Promise<void>;

export class SendError extends Error {
	retryable: boolean;
	status?: number;
	detail?: string;
	/** True when no HTTP response came back at all. */
	network?: boolean;
	/** Milliseconds the server asked to wait, from `Retry-After`. */
	retryAfter?: number;
	constructor(
		message: string,
		retryable: boolean,
		info: { status?: number; detail?: string; network?: boolean; retryAfter?: number } = {},
	) {
		super(message);
		this.name = 'SendError';
		this.retryable = retryable;
		this.status = info.status;
		this.detail = info.detail;
		this.network = info.network;
		this.retryAfter = info.retryAfter;
	}
}

async function detailOf(res: Response): Promise<string | undefined> {
	try {
		const body: unknown = await res.json();
		const error = (body as { error?: unknown } | null)?.error;
		return typeof error === 'string' && error ? error.slice(0, 300) : undefined;
	} catch {
		return undefined;
	}
}

export function retryAfterOf(value: string | null, now = Date.now()): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
	return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

const PERMANENT_5XX = new Set([501, 505, 507, 508]);

export function httpTransport(endpoint: string, projectKey: string): Transport {
	const url = `${endpoint.replace(/\/+$/, '')}/v1/reports`;
	return async (envelope) => {
		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-hmm-key': projectKey },
				body: JSON.stringify(envelope),
				credentials: 'omit',
			});
		} catch (err) {
			throw new SendError(err instanceof Error ? err.message : String(err), true, {
				network: true,
			});
		}
		if (res.ok) return;
		const { status } = res;
		const retryable =
			(status >= 500 && !PERMANENT_5XX.has(status)) || status === 408 || status === 429;
		const detail = await detailOf(res);
		throw new SendError(`the server answered ${status}${detail ? `: ${detail}` : ''}`, retryable, {
			status,
			detail,
			retryAfter: retryAfterOf(res.headers.get('retry-after')),
		});
	};
}

export const isRetryable = (err: unknown) =>
	(err as { retryable?: unknown } | null)?.retryable !== false;

export type SendFailure = { message: string; status?: number; network?: boolean };

export function failureOf(err: unknown): SendFailure {
	if (err instanceof SendError) {
		const failure: SendFailure = { message: err.status ? (err.detail ?? '') : err.message };
		if (err.status) failure.status = err.status;
		if (err.network) failure.network = true;
		return failure;
	}
	if (err instanceof TypeError) return { message: err.message, network: true };
	return { message: err instanceof Error ? err.message : String(err) };
}

export type Pending = {
	envelope: Envelope;
	queuedAt: number;
	attempts: number;
	triedAt?: number;
	nextAt?: number;
	error?: SendFailure;
};

export type Outcome = {
	state: 'sent' | 'rejected' | 'expired';
	envelope: Envelope;
	error?: SendFailure;
};

export const OUTBOX_MAX = 5;
export const MAX_ATTEMPTS = 10;
export const MAX_500_ATTEMPTS = 3;
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_BASE = 30_000;
export const BACKOFF_CAP = 15 * 60_000;
const RETRY_AFTER_CAP = 60 * 60_000;

export const backoff = (attempts: number) =>
	Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** Math.max(0, attempts - 1));

const delayOf = (attempts: number, err: unknown) =>
	Math.max(
		backoff(attempts),
		Math.min(RETRY_AFTER_CAP, (err instanceof SendError && err.retryAfter) || 0),
	);

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function failureFrom(raw: unknown): SendFailure | undefined {
	const f = raw as Partial<SendFailure> | null;
	if (!f || typeof f.message !== 'string') return undefined;
	const failure: SendFailure = { message: f.message.slice(0, 500) };
	if (finite(f.status)) failure.status = f.status;
	if (f.network === true) failure.network = true;
	return failure;
}

/** Plain envelopes are what 0.9.0 and earlier stored; they read as new and never tried. */
function entryOf(raw: unknown, now: number): Pending | null {
	if (validateEnvelope(raw).ok) {
		return { envelope: raw as Envelope, queuedAt: now, attempts: 0 };
	}
	const r = raw as Partial<Pending> | null;
	if (!r || typeof r !== 'object' || !validateEnvelope(r.envelope).ok) return null;
	const entry: Pending = {
		envelope: r.envelope as Envelope,
		queuedAt: finite(r.queuedAt) ? r.queuedAt : now,
		attempts: finite(r.attempts) && r.attempts > 0 ? Math.floor(r.attempts) : 0,
	};
	if (finite(r.triedAt)) entry.triedAt = r.triedAt;
	if (finite(r.nextAt)) entry.nextAt = r.nextAt;
	const error = failureFrom(r.error);
	if (error) entry.error = error;
	return entry;
}

export function readOutbox(storage: Storage, key: string, now = Date.now()): Pending[] {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((raw) => entryOf(raw, now) ?? []);
	} catch {
		return [];
	}
}

function write(storage: Storage, key: string, queue: Pending[]): boolean {
	try {
		if (queue.length) storage.setItem(key, JSON.stringify(queue));
		else storage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

function edit(storage: Storage, key: string, id: string, change: (e: Pending) => Pending | null) {
	write(
		storage,
		key,
		readOutbox(storage, key).flatMap((e) => (e.envelope.id === id ? (change(e) ?? []) : e)),
	);
}

/** Stores a report whose send just failed with `err`. False when the outbox is full or the quota is exceeded. */
export function enqueue(
	storage: Storage,
	key: string,
	envelope: Envelope,
	err?: unknown,
	now = Date.now(),
): boolean {
	const queue = readOutbox(storage, key, now);
	if (queue.length >= OUTBOX_MAX) return false;
	const entry: Pending = { envelope, queuedAt: now, attempts: 0 };
	if (err !== undefined) {
		entry.attempts = 1;
		entry.triedAt = now;
		entry.nextAt = now + delayOf(1, err);
		entry.error = failureOf(err);
	}
	return write(storage, key, [...queue, entry]);
}

export function discard(storage: Storage, key: string, id: string) {
	edit(storage, key, id, () => null);
}

export type FlushOptions = {
	force?: boolean;
	only?: string;
	now?: () => number;
};

/** Sends every due entry; a failing entry never blocks the ones after it. */
export async function flush(
	storage: Storage,
	key: string,
	transport: Transport,
	{ force = false, only, now = Date.now }: FlushOptions = {},
): Promise<Outcome[]> {
	const outcomes: Outcome[] = [];
	const drop = (outcome: Outcome) => {
		discard(storage, key, outcome.envelope.id);
		outcomes.push(outcome);
	};
	for (const entry of readOutbox(storage, key, now())) {
		const { envelope } = entry;
		if (only && envelope.id !== only) continue;
		if (now() - entry.queuedAt > MAX_AGE) {
			drop({ state: 'expired', envelope, error: entry.error });
			continue;
		}
		if (!force && (entry.nextAt ?? 0) > now()) continue;
		try {
			await transport(envelope);
		} catch (err) {
			const error = failureOf(err);
			if (!isRetryable(err)) {
				drop({ state: 'rejected', envelope, error });
				continue;
			}
			const attempts = entry.attempts + 1;
			if (attempts >= (error.status === 500 ? MAX_500_ATTEMPTS : MAX_ATTEMPTS)) {
				drop({ state: 'expired', envelope, error });
				continue;
			}
			const at = now();
			edit(storage, key, envelope.id, (e) => ({
				...e,
				attempts,
				triedAt: at,
				nextAt: at + delayOf(attempts, err),
				error,
			}));
			continue;
		}
		drop({ state: 'sent', envelope });
	}
	return outcomes;
}

export const nextDue = (queue: Pending[]) =>
	queue.length ? Math.min(...queue.map((e) => e.nextAt ?? 0)) : null;
