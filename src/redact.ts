import type { Envelope } from './envelope.ts';

const RULES: [RegExp, string][] = [
	[
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		'[redacted-private-key]',
	],
	[/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[redacted-jwt]'],
	[/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, '$1 [redacted]'],
	[/\b(?:sk|pk|rk)-[\w-]{20,}/g, '[redacted-key]'],
	[/\bgh[pousr]_\w{30,}/g, '[redacted-key]'],
	[/\bgithub_pat_\w{30,}/g, '[redacted-key]'],
	[/\bxox[abposr]-[\w-]{10,}/g, '[redacted-key]'],
	[/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-key]'],
	[
		/([\w-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|authorization))(["']?\s*[:=]\s*["']?)(?!\[?redacted)([^\s"'&,;]{4,})/gi,
		'$1$2[redacted]',
	],
];

const SECRET_PARAM = /token|key|secret|pass|code|sig|auth|session/i;

export function redactText(text: string): string {
	let out = text;
	for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
	return out;
}

export function redactUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return redactText(url);
	}
	parsed.username = '';
	parsed.password = '';
	for (const name of [...parsed.searchParams.keys()]) {
		if (SECRET_PARAM.test(name)) parsed.searchParams.set(name, 'redacted');
	}
	if (parsed.hash.includes('=')) parsed.hash = redactText(parsed.hash);
	return redactText(parsed.toString());
}

function deep(value: unknown): unknown {
	if (typeof value === 'string') return redactText(value);
	if (Array.isArray(value)) return value.map(deep);
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]));
	}
	return value;
}

/** Scrubs every string except attachment image data; images cannot be scrubbed. */
export function redactEnvelope(envelope: Envelope): Envelope {
	const { attachments, ...rest } = envelope;
	const withUrls = {
		...rest,
		page: rest.page ? { ...rest.page, url: redactUrl(rest.page.url) } : undefined,
		items: rest.items.map((item) => ({ ...item, url: redactUrl(item.url) })),
	};
	if (!withUrls.page) delete withUrls.page;
	return { ...(deep(withUrls) as Omit<Envelope, 'attachments'>), attachments };
}
