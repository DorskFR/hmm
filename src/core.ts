import type { Snippet } from 'svelte';
import { type Envelope, LIMITS } from './envelope.ts';
import type { Labels } from './labels.ts';
import type { Launcher } from './launcher.ts';
import { httpTransport, type Transport } from './transport.ts';

export type Options = {
	/** Public identifier of the project the reports belong to. */
	projectKey: string;
	/** Base URL of the ingest server; reports go to `<endpoint>/v1/reports`. */
	endpoint?: string;
	/** Replaces the HTTP POST, for hosts that relay reports through their own backend. */
	transport?: Transport;
	/** Extra host data added to every report: app version, route name, install id. */
	context?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
	/** Last chance to change a report, or to drop it by returning null. Runs before the review. */
	beforeSend?: (envelope: Envelope) => Envelope | null | Promise<Envelope | null>;
	/** Built-in launcher: floating, edge tab or corner bubble. `false` leaves opening to `HmmTrigger` or `hmm.open()`. */
	launcher?: boolean | Launcher;
	/** @deprecated use `launcher: { form: 'floating', anchor }` */
	position?: 'bottom-right' | 'bottom-left';
	/** Replaces the icon and label inside the built-in launcher. */
	launcherContent?: Snippet;
	labels?: Partial<Labels>;
	onSent?: (envelope: Envelope) => void;
};

export type Handle = {
	open(): void;
	close(): void;
	destroy(): void;
	readonly isOpen: boolean;
};

export const uid = () => {
	const c = globalThis.crypto;
	if (c.randomUUID) return c.randomUUID();
	return [...c.getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
};

export function storageOf(get: () => Storage): Storage | null {
	try {
		const storage = get();
		storage.getItem('hmm');
		return storage;
	} catch {
		return null;
	}
}

export function clamp(envelope: Envelope): Envelope {
	return {
		...envelope,
		comment: envelope.comment.slice(0, LIMITS.comment),
		page: envelope.page && { ...envelope.page, url: envelope.page.url.slice(0, LIMITS.url) },
		items: envelope.items.map((item) => ({
			...item,
			url: item.url.slice(0, LIMITS.url),
			comment: item.comment.slice(0, LIMITS.comment),
		})),
	};
}

/** Throws when the options cannot deliver a report. */
export function transportOf(
	options: Pick<Options, 'projectKey' | 'endpoint' | 'transport'>,
): Transport {
	if (!/^[A-Za-z0-9._-]{1,128}$/.test(options?.projectKey ?? ''))
		throw new Error(
			'hmm: projectKey must be 1 to 128 letters, digits, dots, dashes or underscores',
		);
	const transport =
		options.transport ??
		(options.endpoint ? httpTransport(options.endpoint, options.projectKey) : null);
	if (!transport) throw new Error('hmm: either endpoint or transport is required');
	return transport;
}

/** The report as shown to the user: image data replaced by its size. */
export const readable = (envelope: Envelope) =>
	JSON.stringify(
		{
			...envelope,
			attachments: envelope.attachments.map((a) => ({
				...a,
				data: `<${Math.round((a.data.length * 3) / 4 / 1024)} KB of PNG>`,
			})),
		},
		null,
		2,
	);

/** Host and path without the scheme; long path segments keep their ends. */
export function shortUrl(href: string, segment = 16): string {
	try {
		const url = new URL(href);
		const path = url.pathname
			.split('/')
			.map((part) => (part.length > segment ? `${part.slice(0, 8)}…${part.slice(-7)}` : part))
			.join('/');
		return `${url.host}${path === '/' ? '' : path}${url.search}`;
	} catch {
		return href;
	}
}
