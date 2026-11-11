import { type Envelope, validateEnvelope } from './envelope.ts';

export type Transport = (envelope: Envelope) => Promise<void>;

export class SendError extends Error {
	retryable: boolean;
	constructor(message: string, retryable: boolean) {
		super(message);
		this.name = 'SendError';
		this.retryable = retryable;
	}
}

export function httpTransport(endpoint: string, projectKey: string): Transport {
	const url = `${endpoint.replace(/\/+$/, '')}/v1/reports`;
	return async (envelope) => {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-hmm-key': projectKey },
			body: JSON.stringify(envelope),
			credentials: 'omit',
		});
		if (res.ok) return;
		const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
		throw new SendError(`the server answered ${res.status}`, retryable);
	};
}

export const isRetryable = (err: unknown) =>
	(err as { retryable?: unknown } | null)?.retryable !== false;

const OUTBOX_MAX = 5;

function read(storage: Storage, key: string): Envelope[] {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((e): e is Envelope => validateEnvelope(e).ok);
	} catch {
		return [];
	}
}

function write(storage: Storage, key: string, queue: Envelope[]): boolean {
	try {
		if (queue.length) storage.setItem(key, JSON.stringify(queue));
		else storage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

/** False when the report could not be stored, for example when the quota is exceeded. */
export function enqueue(storage: Storage, key: string, envelope: Envelope): boolean {
	const queue = read(storage, key);
	if (queue.length >= OUTBOX_MAX) return false;
	return write(storage, key, [...queue, envelope]);
}

export async function flush(storage: Storage, key: string, transport: Transport): Promise<number> {
	let sent = 0;
	for (const envelope of read(storage, key)) {
		try {
			await transport(envelope);
		} catch (err) {
			if (isRetryable(err)) break;
		}
		write(
			storage,
			key,
			read(storage, key).filter((e) => e.id !== envelope.id),
		);
		sent++;
	}
	return sent;
}
