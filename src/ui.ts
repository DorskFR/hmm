import { type Draft, emptyDraft, isEmpty, loadDraft, saveDraft } from './draft.ts';
import {
	type Attachment,
	CATEGORIES,
	type ElementItem,
	ENVELOPE_VERSION,
	type Envelope,
	type Item,
	LIMITS,
	validateEnvelope,
} from './envelope.ts';
import { describeElement, labelOf } from './inspect.ts';
import { LABELS, type Labels } from './labels.ts';
import { type PickSession, startPick } from './picker.ts';
import { redactEnvelope } from './redact.ts';
import { capture, type Shot } from './shot.ts';
import { STYLES } from './styles.ts';
import { enqueue, flush, isRetryable, type Transport } from './transport.ts';
import { VERSION } from './version.ts';

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
	/** Set to false to hide the floating button and call `open()` from your own UI. */
	launcher?: boolean;
	position?: 'bottom-right' | 'bottom-left';
	labels?: Partial<Labels>;
	onSent?: (envelope: Envelope) => void;
};

export type Hmm = {
	open(): void;
	close(): void;
	destroy(): void;
	readonly isOpen: boolean;
};

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | undefined | ((event: Event) => void)>;

const uid = () => {
	const c = globalThis.crypto;
	if (c.randomUUID) return c.randomUUID();
	return [...c.getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
};

function storageOf(get: () => Storage): Storage | null {
	try {
		const storage = get();
		storage.getItem('hmm');
		return storage;
	} catch {
		return null;
	}
}

function clamp(envelope: Envelope): Envelope {
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

export function mount(options: Options, transport: Transport): Hmm {
	const doc = document;
	const win = window;
	const L: Labels = { ...LABELS, ...options.labels };
	const side = options.position === 'bottom-left' ? 'left' : 'right';
	const draftKey = `hmm:draft:${options.projectKey}`;
	const outboxKey = `hmm:outbox:${options.projectKey}`;
	const session = storageOf(() => win.sessionStorage);
	const local = storageOf(() => win.localStorage);

	const el = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		props: Props = {},
		...children: Child[]
	): HTMLElementTagNameMap[K] => {
		const node = doc.createElement(tag);
		for (const [key, value] of Object.entries(props)) {
			if (typeof value === 'function') node.addEventListener(key.slice(2), value);
			else if (value === true) node.setAttribute(key, '');
			else if (value !== false && value !== undefined) node.setAttribute(key, String(value));
		}
		node.append(...children.filter((c): c is Node | string => Boolean(c)));
		return node;
	};
	const button = (id: string, label: string, onclick: () => void, cls = 'btn') =>
		el('button', { type: 'button', class: cls, 'data-id': id, onclick }, label);
	const iconButton = (id: string, label: string, onclick: () => void) =>
		el(
			'button',
			{ type: 'button', class: 'icon', 'data-id': id, 'aria-label': label, title: label, onclick },
			'×',
		);

	const host = el('div', { 'data-hmm': '' });
	const root = host.attachShadow({ mode: 'open' });
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLES);
		root.adoptedStyleSheets = [sheet];
	} catch {
		root.append(el('style', {}, STYLES));
	}

	const adopt = () => {
		let bg = '';
		for (let node = host.parentElement; node && !bg; node = node.parentElement) {
			const color = win.getComputedStyle(node).backgroundColor;
			if (!/^transparent$|,\s*0\)$|\/\s*0\)$/.test(color)) bg = color;
		}
		const own = win.getComputedStyle(host);
		const set = (name: string, value: string) =>
			value ? host.style.setProperty(name, value) : host.style.removeProperty(name);
		set('--_bg', bg);
		set('--_fg', own.color);
		set('--_accent', own.accentColor === 'auto' ? '' : own.accentColor);
	};
	const themeWatch = new MutationObserver(adopt);
	const schemeQuery = win.matchMedia('(prefers-color-scheme: dark)');

	let draft: Draft = loadDraft(session, draftKey);
	let view: 'edit' | 'review' | 'done' = 'edit';
	let open = false;
	let busy = '';
	let error = '';
	let message = '';
	let pending: Envelope | null = null;
	let pick: PickSession | null = null;
	let focus: string | null = null;
	let frame = 0;

	const launcher =
		options.launcher === false
			? null
			: el(
					'button',
					{ type: 'button', class: `launcher ${side}`, 'data-id': 'launcher', onclick: show },
					L.launcher,
				);
	const panel = el('section', {
		class: `panel ${side}`,
		role: 'dialog',
		'aria-label': L.title,
		'data-id': 'panel',
		hidden: true,
	});
	const pins = el('div', { 'aria-hidden': 'true' });
	if (launcher) root.append(launcher);
	root.append(panel, pins);

	const persist = () => saveDraft(session, draftKey, draft);
	const imageOf = (attachment: Attachment | undefined, alt: string) =>
		attachment && el('img', { src: `data:image/png;base64,${attachment.data}`, alt });
	const attachmentOf = (item: Item) => draft.attachments.find((a) => a.id === item.attachment);
	const titleOf = (item: Item) => (item.type === 'element' ? labelOf(item.target) : L.screenshot);

	function placePins() {
		pins.replaceChildren();
		if (!open || pick || view !== 'edit') return;
		draft.items.forEach((item, i) => {
			if (item.type !== 'element' || item.url !== win.location.href) return;
			let target: Element | null = null;
			try {
				target = doc.querySelector(item.target.selector);
			} catch {}
			if (!target) return;
			const r = target.getBoundingClientRect();
			if (!r.width && !r.height) return;
			const pin = el('div', { class: 'pin' }, String(i + 1));
			pin.style.transform = `translate(${Math.max(0, r.left - 8)}px, ${Math.max(0, r.top - 8)}px)`;
			pins.append(pin);
		});
	}
	const schedulePins = () => {
		win.cancelAnimationFrame(frame);
		frame = win.requestAnimationFrame(placePins);
	};

	function removeItem(item: Item) {
		draft.items = draft.items.filter((i) => i !== item);
		draft.attachments = draft.attachments.filter((a) => a.id !== item.attachment);
		persist();
		render();
	}

	function removeImage(item: ElementItem) {
		draft.attachments = draft.attachments.filter((a) => a.id !== item.attachment);
		delete item.attachment;
		persist();
		render();
	}

	function attach(shot: Shot): string {
		const attachment: Attachment = { id: uid(), mime: 'image/png', ...shot };
		draft.attachments.push(attachment);
		return attachment.id;
	}

	function beginPick() {
		if (busy) return;
		if (draft.items.length >= LIMITS.items) {
			error = L.full;
			render();
			return;
		}
		error = '';
		pick = startPick({
			doc,
			root,
			host,
			hint: L.pickHint,
			onPick: (target) => {
				endPick();
				void addElement(target);
			},
			onCancel: () => {
				endPick();
				render();
			},
		});
		render();
	}

	function endPick() {
		pick?.stop();
		pick = null;
	}

	async function addElement(target: Element) {
		const item: ElementItem = {
			id: uid(),
			type: 'element',
			url: win.location.href,
			comment: '',
			target: describeElement(target),
		};
		busy = L.capturing;
		render();
		if (draft.attachments.length < LIMITS.attachments) {
			try {
				item.attachment = attach(await capture(win, target, host));
			} catch (err) {
				console.warn('[hmm] screenshot failed', err);
			}
		}
		draft.items.push(item);
		busy = '';
		focus = item.id;
		persist();
		render();
	}

	async function addShot() {
		if (busy) return;
		if (draft.items.length >= LIMITS.items || draft.attachments.length >= LIMITS.attachments) {
			error = L.full;
			render();
			return;
		}
		busy = L.capturing;
		error = '';
		render();
		try {
			const id = uid();
			const attachment = attach(await capture(win, null, host));
			draft.items.push({ id, type: 'screenshot', url: win.location.href, comment: '', attachment });
			focus = id;
		} catch (err) {
			console.warn('[hmm] screenshot failed', err);
			error = L.shotFailed;
		}
		busy = '';
		persist();
		render();
	}

	async function build(): Promise<Envelope | null> {
		const used = new Set(draft.items.map((item) => item.attachment));
		const envelope: Envelope = {
			v: ENVELOPE_VERSION,
			id: uid(),
			kind: 'feedback',
			category: draft.category,
			project: options.projectKey,
			createdAt: new Date().toISOString(),
			client: { name: '@dorsk/hmm', version: VERSION },
			page: {
				url: win.location.href,
				title: doc.title.slice(0, 300),
				viewport: { width: win.innerWidth, height: win.innerHeight },
				userAgent: win.navigator.userAgent.slice(0, 400),
				language: win.navigator.language.slice(0, 50),
			},
			context: (await options.context?.()) ?? {},
			comment: draft.comment.trim(),
			items: draft.items,
			attachments: draft.attachments.filter((a) => used.has(a.id)),
		};
		const clean = clamp(redactEnvelope(envelope));
		return options.beforeSend ? await options.beforeSend(clean) : clean;
	}

	async function review() {
		if (busy || isEmpty(draft)) return;
		error = '';
		pending = null;
		try {
			const envelope = await build();
			if (!envelope) error = L.blocked;
			else {
				const check = validateEnvelope(envelope);
				if (check.ok) pending = envelope;
				else {
					console.warn('[hmm] invalid report', check.errors);
					error = L.failed;
				}
			}
		} catch (err) {
			console.warn('[hmm] could not build the report', err);
			error = L.failed;
		}
		if (pending) view = 'review';
		render();
	}

	function finish(text: string) {
		busy = '';
		pending = null;
		draft = emptyDraft();
		persist();
		message = text;
		view = 'done';
		render();
	}

	async function send() {
		const envelope = pending;
		if (!envelope || busy) return;
		busy = L.sending;
		error = '';
		render();
		try {
			await transport(envelope);
		} catch (err) {
			console.warn('[hmm] sending failed', err);
			if (isRetryable(err) && local && enqueue(local, outboxKey, envelope)) finish(L.queued);
			else {
				busy = '';
				error = L.failed;
				render();
			}
			return;
		}
		finish(L.sent);
		options.onSent?.(envelope);
	}

	function editView(): Node[] {
		const reviewButton = button('review', L.review, () => void review(), 'btn primary');
		const discardButton = button('discard', L.discard, () => {
			draft = emptyDraft();
			error = '';
			persist();
			render();
		});
		const sync = () => {
			reviewButton.disabled = Boolean(busy) || isEmpty(draft);
			discardButton.disabled = Boolean(busy) || isEmpty(draft);
		};

		const chips = el(
			'div',
			{ class: 'chips', role: 'radiogroup', 'aria-label': L.category },
			...CATEGORIES.map((category) =>
				el(
					'button',
					{
						type: 'button',
						class: 'chip',
						role: 'radio',
						'data-id': `category-${category}`,
						'aria-checked': String(draft.category === category),
						onclick: () => {
							draft.category = category;
							persist();
							for (const chip of chips.children)
								chip.setAttribute(
									'aria-checked',
									String(chip.getAttribute('data-id') === `category-${category}`),
								);
						},
					},
					L[category],
				),
			),
		);

		const main = el('textarea', {
			class: 'main',
			'data-id': 'comment',
			placeholder: L.commentPlaceholder,
			'aria-label': L.comment,
			maxlength: 4000,
		});
		main.value = draft.comment;
		main.addEventListener('input', () => {
			draft.comment = main.value;
			persist();
			sync();
		});

		const items = el(
			'ul',
			{ class: 'items' },
			...draft.items.map((item, i) => {
				const area = el('textarea', {
					'data-id': 'item-comment',
					'data-item': item.id,
					placeholder: L.itemPlaceholder,
					'aria-label': `${L.comment} ${i + 1}`,
					maxlength: 4000,
				});
				area.value = item.comment;
				area.addEventListener('input', () => {
					item.comment = area.value;
					persist();
				});
				const image = imageOf(attachmentOf(item), titleOf(item));
				return el(
					'li',
					{ class: 'item', 'data-id': 'item' },
					el(
						'div',
						{ class: 'item-head' },
						el('span', { class: 'badge' }, String(i + 1)),
						el('span', { class: 'item-label', 'data-id': 'item-label' }, titleOf(item)),
						iconButton('remove', L.remove, () => removeItem(item)),
					),
					image &&
						el(
							'div',
							{ class: 'thumb' },
							image,
							item.type === 'element' &&
								iconButton('remove-image', L.removeImage, () => removeImage(item)),
						),
					area,
				);
			}),
		);

		const pickButton = button('pick', L.pick, beginPick);
		const shotButton = button('shot', L.shot, () => void addShot());
		pickButton.disabled = shotButton.disabled = Boolean(busy);
		sync();

		return [
			el(
				'div',
				{ class: 'body' },
				chips,
				main,
				draft.items.length > 0 && items,
				el('div', { class: 'actions' }, pickButton, shotButton),
				busy && el('p', { class: 'note', role: 'status' }, busy),
				error && el('p', { class: 'error', role: 'alert', 'data-id': 'error' }, error),
			),
			el('div', { class: 'foot' }, discardButton, reviewButton),
		];
	}

	function reviewView(envelope: Envelope): Node[] {
		const row = (term: Child, ...detail: Child[]) => [el('dt', {}, term), el('dd', {}, ...detail)];
		const raw = {
			...envelope,
			attachments: envelope.attachments.map((a) => ({
				...a,
				data: `<${Math.round((a.data.length * 3) / 4 / 1024)} KB of PNG>`,
			})),
		};
		const sendButton = button('send', busy || L.send, () => void send(), 'btn primary');
		const backButton = button('back', L.back, () => {
			view = 'edit';
			error = '';
			render();
		});
		sendButton.disabled = backButton.disabled = Boolean(busy);

		return [
			el(
				'div',
				{ class: 'body review', 'data-id': 'review-body' },
				el('p', { class: 'note' }, L.reviewIntro),
				el(
					'dl',
					{},
					...row(L.category, envelope.category ? L[envelope.category] : envelope.kind),
					...row(L.page, envelope.page?.url),
					...(envelope.comment ? row(L.comment, envelope.comment) : []),
					...envelope.items.flatMap((item, i) =>
						row(
							el('span', { class: 'badge' }, String(i + 1)),
							el('div', { class: 'note' }, titleOf(item)),
							item.comment && el('div', {}, item.comment),
							imageOf(
								envelope.attachments.find((a) => a.id === item.attachment),
								titleOf(item),
							),
						),
					),
				),
				Object.keys(envelope.context).length > 0 &&
					el(
						'details',
						{},
						el('summary', {}, L.context),
						el('pre', {}, JSON.stringify(envelope.context, null, 2)),
					),
				el(
					'details',
					{},
					el('summary', {}, L.raw),
					el('pre', { 'data-id': 'raw' }, JSON.stringify(raw, null, 2)),
				),
				error && el('p', { class: 'error', role: 'alert', 'data-id': 'error' }, error),
			),
			el('div', { class: 'foot' }, backButton, sendButton),
		];
	}

	function doneView(): Node[] {
		return [
			el(
				'div',
				{ class: 'body' },
				el('p', { class: 'message', role: 'status', 'data-id': 'message' }, message),
			),
			el('div', { class: 'foot' }, el('span'), button('done', L.done, hide, 'btn primary')),
		];
	}

	function render() {
		if (launcher) launcher.hidden = open || Boolean(pick);
		panel.hidden = !open || Boolean(pick);
		placePins();
		if (panel.hidden) return;
		const body =
			view === 'review' && pending
				? reviewView(pending)
				: view === 'done'
					? doneView()
					: editView();
		panel.replaceChildren(
			el('div', { class: 'head' }, el('h2', {}, L.title), iconButton('close', L.close, hide)),
			...body,
		);
		if (focus) {
			panel.querySelector<HTMLElement>(`[data-item="${focus}"]`)?.focus();
			focus = null;
		}
	}

	function show() {
		if (open) return;
		open = true;
		adopt();
		render();
		panel.querySelector<HTMLElement>('[data-id="comment"]')?.focus();
	}

	function hide() {
		endPick();
		open = false;
		if (view === 'done') view = 'edit';
		render();
		launcher?.focus();
	}

	const onKey = (event: Event) => {
		if ((event as KeyboardEvent).key !== 'Escape' || !open || pick) return;
		event.stopPropagation();
		hide();
	};
	const flushOutbox = () => {
		if (local) void flush(local, outboxKey, transport).catch(() => {});
	};

	root.addEventListener('keydown', onKey);
	win.addEventListener('scroll', schedulePins, { capture: true, passive: true });
	win.addEventListener('resize', schedulePins);
	win.addEventListener('online', flushOutbox);
	doc.body.append(host);
	adopt();
	const watched = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
	themeWatch.observe(doc.documentElement, watched);
	themeWatch.observe(doc.body, watched);
	schemeQuery.addEventListener('change', adopt);
	win.addEventListener('load', adopt);
	render();
	flushOutbox();

	return {
		open: show,
		close: hide,
		destroy() {
			endPick();
			win.cancelAnimationFrame(frame);
			win.removeEventListener('scroll', schedulePins, { capture: true });
			win.removeEventListener('resize', schedulePins);
			win.removeEventListener('online', flushOutbox);
			themeWatch.disconnect();
			schemeQuery.removeEventListener('change', adopt);
			win.removeEventListener('load', adopt);
			host.remove();
		},
		get isOpen() {
			return open;
		},
	};
}
