export const ENVELOPE_VERSION = 1 as const;
export const KINDS = ['feedback', 'error', 'alert'] as const;
export const CATEGORIES = ['idea', 'problem', 'question', 'other'] as const;

export type Kind = (typeof KINDS)[number];
export type Category = (typeof CATEGORIES)[number];

export const LIMITS = {
	comment: 5000,
	items: 20,
	attachments: 10,
	attachmentChars: 2_800_000,
	attachmentSide: 8192,
	contextChars: 16_000,
	contextKeys: 50,
	url: 2000,
	selector: 1000,
	text: 400,
	html: 2000,
	attrs: 40,
	attrName: 100,
	attrValue: 400,
	short: 500,
} as const;

export type Rect = { x: number; y: number; width: number; height: number };

export type Target = {
	selector: string;
	tag: string;
	text: string;
	html: string;
	attrs: Record<string, string>;
	rect: Rect;
	source?: { file: string; line: number; column: number };
};

export type ElementItem = {
	id: string;
	type: 'element';
	url: string;
	comment: string;
	target: Target;
	attachment?: string;
};

export type ScreenshotItem = {
	id: string;
	type: 'screenshot';
	url: string;
	comment: string;
	attachment: string;
};

export type Item = ElementItem | ScreenshotItem;

export type Attachment = {
	id: string;
	mime: 'image/png';
	width: number;
	height: number;
	/** Base64 without a data URL prefix. */
	data: string;
};

export type Page = {
	url: string;
	title: string;
	viewport: { width: number; height: number };
	userAgent: string;
	language: string;
};

export type Envelope = {
	v: typeof ENVELOPE_VERSION;
	id: string;
	kind: Kind;
	category?: Category;
	/** Groups repeats of the same error or alert. */
	fingerprint?: string;
	project: string;
	createdAt: string;
	client: { name: string; version: string };
	page?: Page;
	context: Record<string, unknown>;
	comment: string;
	items: Item[];
	attachments: Attachment[];
};

export type Validation = { ok: true; envelope: Envelope } | { ok: false; errors: string[] };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECT = /^[A-Za-z0-9._-]{1,128}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Obj = Record<string, unknown>;

class Check {
	errors: string[] = [];

	fail(path: string, message: string): false {
		this.errors.push(`${path}: ${message}`);
		return false;
	}

	object(value: unknown, path: string, required: string[], optional: string[] = []): Obj | null {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			this.fail(path, 'must be an object');
			return null;
		}
		const obj = value as Obj;
		for (const key of required) if (!(key in obj)) this.fail(`${path}.${key}`, 'is required');
		for (const key of Object.keys(obj)) {
			if (!required.includes(key) && !optional.includes(key))
				this.fail(`${path}.${key}`, 'is not allowed');
		}
		return obj;
	}

	string(value: unknown, path: string, max: number, pattern?: RegExp): value is string {
		if (typeof value !== 'string') return this.fail(path, 'must be a string');
		if (value.length > max) return this.fail(path, `must be at most ${max} characters`);
		if (pattern && !pattern.test(value)) return this.fail(path, 'has an invalid format');
		return true;
	}

	int(value: unknown, path: string, min: number, max: number): value is number {
		if (typeof value !== 'number' || !Number.isInteger(value))
			return this.fail(path, 'must be an integer');
		if (value < min || value > max) return this.fail(path, `must be between ${min} and ${max}`);
		return true;
	}

	oneOf(value: unknown, path: string, values: readonly unknown[]): boolean {
		return values.includes(value) || this.fail(path, `must be one of ${values.join(', ')}`);
	}

	array(value: unknown, path: string, max: number): unknown[] | null {
		if (!Array.isArray(value)) {
			this.fail(path, 'must be an array');
			return null;
		}
		if (value.length > max) this.fail(path, `must have at most ${max} entries`);
		return value;
	}
}

const COORD = 1_000_000;

function checkTarget(c: Check, value: unknown, path: string) {
	const t = c.object(value, path, ['selector', 'tag', 'text', 'html', 'attrs', 'rect'], ['source']);
	if (!t) return;
	c.string(t.selector, `${path}.selector`, LIMITS.selector);
	c.string(t.tag, `${path}.tag`, 100);
	c.string(t.text, `${path}.text`, LIMITS.text);
	c.string(t.html, `${path}.html`, LIMITS.html);
	const attrs = c.object(t.attrs, `${path}.attrs`, [], Object.keys((t.attrs as Obj) ?? {}));
	if (attrs) {
		const names = Object.keys(attrs);
		if (names.length > LIMITS.attrs)
			c.fail(`${path}.attrs`, `must have at most ${LIMITS.attrs} entries`);
		for (const name of names) {
			if (name.length > LIMITS.attrName) c.fail(`${path}.attrs`, 'has a name that is too long');
			c.string(attrs[name], `${path}.attrs.${name}`, LIMITS.attrValue);
		}
	}
	const rect = c.object(t.rect, `${path}.rect`, ['x', 'y', 'width', 'height']);
	if (rect) {
		c.int(rect.x, `${path}.rect.x`, -COORD, COORD);
		c.int(rect.y, `${path}.rect.y`, -COORD, COORD);
		c.int(rect.width, `${path}.rect.width`, 0, COORD);
		c.int(rect.height, `${path}.rect.height`, 0, COORD);
	}
	if ('source' in t) {
		const source = c.object(t.source, `${path}.source`, ['file', 'line', 'column']);
		if (source) {
			c.string(source.file, `${path}.source.file`, LIMITS.short);
			c.int(source.line, `${path}.source.line`, 0, COORD);
			c.int(source.column, `${path}.source.column`, 0, COORD);
		}
	}
}

function checkItem(c: Check, value: unknown, path: string, attachmentIds: Set<string>) {
	const type = (value as Obj | null)?.type;
	if (type !== 'element' && type !== 'screenshot') {
		c.fail(`${path}.type`, 'must be one of element, screenshot');
		return;
	}
	const item =
		type === 'element'
			? c.object(value, path, ['id', 'type', 'url', 'comment', 'target'], ['attachment'])
			: c.object(value, path, ['id', 'type', 'url', 'comment', 'attachment']);
	if (!item) return;
	c.string(item.id, `${path}.id`, 64, ID);
	c.string(item.url, `${path}.url`, LIMITS.url);
	c.string(item.comment, `${path}.comment`, LIMITS.comment);
	if (type === 'element') checkTarget(c, item.target, `${path}.target`);
	if ('attachment' in item && c.string(item.attachment, `${path}.attachment`, 64, ID)) {
		if (!attachmentIds.has(item.attachment))
			c.fail(`${path}.attachment`, 'does not match an attachment');
	}
}

function checkAttachment(c: Check, value: unknown, path: string) {
	const a = c.object(value, path, ['id', 'mime', 'width', 'height', 'data']);
	if (!a) return;
	c.string(a.id, `${path}.id`, 64, ID);
	c.oneOf(a.mime, `${path}.mime`, ['image/png']);
	c.int(a.width, `${path}.width`, 1, LIMITS.attachmentSide);
	c.int(a.height, `${path}.height`, 1, LIMITS.attachmentSide);
	c.string(a.data, `${path}.data`, LIMITS.attachmentChars, BASE64);
}

function checkPage(c: Check, value: unknown, path: string) {
	const page = c.object(value, path, ['url', 'title', 'viewport', 'userAgent', 'language']);
	if (!page) return;
	c.string(page.url, `${path}.url`, LIMITS.url);
	c.string(page.title, `${path}.title`, LIMITS.short);
	c.string(page.userAgent, `${path}.userAgent`, LIMITS.short);
	c.string(page.language, `${path}.language`, 100);
	const viewport = c.object(page.viewport, `${path}.viewport`, ['width', 'height']);
	if (viewport) {
		c.int(viewport.width, `${path}.viewport.width`, 0, COORD);
		c.int(viewport.height, `${path}.viewport.height`, 0, COORD);
	}
}

/** Strict structural check, shared by the widget before sending and by servers on receipt. */
export function validateEnvelope(data: unknown): Validation {
	const c = new Check();
	const e = c.object(
		data,
		'envelope',
		[
			'v',
			'id',
			'kind',
			'project',
			'createdAt',
			'client',
			'context',
			'comment',
			'items',
			'attachments',
		],
		['category', 'fingerprint', 'page'],
	);
	if (!e) return { ok: false, errors: c.errors };

	c.oneOf(e.v, 'envelope.v', [ENVELOPE_VERSION]);
	c.string(e.id, 'envelope.id', 64, ID);
	c.oneOf(e.kind, 'envelope.kind', KINDS);
	if ('category' in e) c.oneOf(e.category, 'envelope.category', CATEGORIES);
	if ('fingerprint' in e) c.string(e.fingerprint, 'envelope.fingerprint', LIMITS.short);
	c.string(e.project, 'envelope.project', 128, PROJECT);
	c.string(e.createdAt, 'envelope.createdAt', 40, TIMESTAMP);
	c.string(e.comment, 'envelope.comment', LIMITS.comment);

	const client = c.object(e.client, 'envelope.client', ['name', 'version']);
	if (client) {
		c.string(client.name, 'envelope.client.name', 100);
		c.string(client.version, 'envelope.client.version', 100);
	}

	if ('page' in e) checkPage(c, e.page, 'envelope.page');

	const context = c.object(
		e.context,
		'envelope.context',
		[],
		Object.keys((e.context as Obj) ?? {}),
	);
	if (context) {
		if (Object.keys(context).length > LIMITS.contextKeys)
			c.fail('envelope.context', `must have at most ${LIMITS.contextKeys} keys`);
		let size = Number.POSITIVE_INFINITY;
		try {
			size = JSON.stringify(context).length;
		} catch {}
		if (size > LIMITS.contextChars)
			c.fail('envelope.context', `must serialise to at most ${LIMITS.contextChars} characters`);
	}

	const attachments = c.array(e.attachments, 'envelope.attachments', LIMITS.attachments);
	const ids = new Set<string>();
	attachments?.forEach((a, i) => {
		checkAttachment(c, a, `envelope.attachments[${i}]`);
		const id = (a as Obj | null)?.id;
		if (typeof id === 'string') {
			if (ids.has(id)) c.fail(`envelope.attachments[${i}].id`, 'is duplicated');
			ids.add(id);
		}
	});

	const items = c.array(e.items, 'envelope.items', LIMITS.items);
	items?.forEach((item, i) => {
		checkItem(c, item, `envelope.items[${i}]`, ids);
	});

	return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, envelope: e as Envelope };
}
