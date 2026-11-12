<script lang="ts">
	import {
		Badge,
		Button,
		Callout,
		Card,
		Cluster,
		CodeBlock,
		Disclosure,
		Heading,
		IconButton,
		KeyValue,
		type KeyValueRow,
		SegmentedControl,
		Stack,
		Text,
		Textarea,
	} from '@dorsk/tsumikit';
	import { onMount, tick, untrack } from 'svelte';
	import { clamp, type Options, readable, storageOf, transportOf, uid } from './core.ts';
	import { type Draft, emptyDraft, isEmpty, loadDraft, saveDraft } from './draft.ts';
	import {
		type Attachment,
		CATEGORIES,
		type Category,
		type ElementItem,
		ENVELOPE_VERSION,
		type Envelope,
		type Item,
		LIMITS,
		validateEnvelope,
	} from './envelope.ts';
	import { describeElement, labelOf } from './inspect.ts';
	import { LABELS, type Labels } from './labels.ts';
	import { elementAt } from './picker.ts';
	import { redactEnvelope } from './redact.ts';
	import { capture, type Shot } from './shot.ts';
	import { enqueue, flush, isRetryable } from './transport.ts';
	import { VERSION } from './version.ts';

	let {
		projectKey,
		endpoint,
		transport,
		context,
		beforeSend,
		launcher = true,
		position = 'bottom-right',
		labels,
		onSent,
		open = $bindable(false),
	}: Options & { open?: boolean } = $props();

	const L = $derived<Labels>({ ...LABELS, ...labels });
	const deliver = $derived(transportOf({ projectKey, endpoint, transport }));
	untrack(() => deliver);
	const draftKey = $derived(`hmm:draft:${projectKey}`);
	const outboxKey = $derived(`hmm:outbox:${projectKey}`);
	const categories = $derived(CATEGORIES.map((value) => ({ value, label: L[value] })));

	let host: HTMLElement | undefined;
	let session: Storage | null = null;
	let local: Storage | null = null;
	let frame = 0;

	let ready = $state(false);
	let draft = $state<Draft>(emptyDraft());
	let view = $state<'edit' | 'review' | 'done'>('edit');
	let busy = $state<'' | 'capture' | 'send'>('');
	let error = $state('');
	let message = $state('');
	let delivered = $state(true);
	let pending = $state.raw<Envelope | null>(null);
	let picking = $state(false);
	let outline = $state.raw<DOMRect | null>(null);
	let pins = $state.raw<{ n: number; x: number; y: number }[]>([]);

	const empty = $derived(isEmpty(draft));
	const rows = $derived<KeyValueRow[]>(
		pending
			? [
					{
						label: L.category,
						value: pending.category ? L[pending.category] : pending.kind,
					},
					{ label: L.page, value: pending.page?.url ?? '' },
					...(pending.comment ? [{ label: L.comment, value: pending.comment }] : []),
				]
			: [],
	);

	const titleOf = (item: Item) => (item.type === 'element' ? labelOf(item.target) : L.screenshot);
	const imageOf = (attachments: Attachment[], item: Item) => {
		const found = attachments.find((a) => a.id === item.attachment);
		return found && `data:image/png;base64,${found.data}`;
	};
	const part = (selector: string) => host?.querySelector<HTMLElement>(selector);

	function placePins() {
		if (!open || picking || view !== 'edit') {
			pins = [];
			return;
		}
		pins = draft.items.flatMap((item, i) => {
			if (item.type !== 'element' || item.url !== location.href) return [];
			let target: Element | null = null;
			try {
				target = document.querySelector(item.target.selector);
			} catch {}
			const r = target?.getBoundingClientRect();
			if (!r || (!r.width && !r.height)) return [];
			return [{ n: i + 1, x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8) }];
		});
	}

	function removeItem(item: Item) {
		draft.items = draft.items.filter((i) => i.id !== item.id);
		draft.attachments = draft.attachments.filter((a) => a.id !== item.attachment);
	}

	function removeImage(item: ElementItem) {
		draft.attachments = draft.attachments.filter((a) => a.id !== item.attachment);
		delete item.attachment;
	}

	function attach(shot: Shot): string {
		const attachment: Attachment = { id: uid(), mime: 'image/png', ...shot };
		draft.attachments.push(attachment);
		return attachment.id;
	}

	async function focusItem(id: string) {
		await tick();
		part(`[data-item="${id}"]`)?.focus();
	}

	function beginPick() {
		if (busy) return;
		error = draft.items.length >= LIMITS.items ? L.full : '';
		picking = !error;
	}

	function onMove(event: MouseEvent) {
		if (!host) return;
		outline =
			elementAt(document, host, event.clientX, event.clientY)?.getBoundingClientRect() ?? null;
	}

	function onPick(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const target = host && elementAt(document, host, event.clientX, event.clientY);
		if (!target) return;
		picking = false;
		void addElement(target);
	}

	async function addElement(target: Element) {
		if (!host) return;
		const item: ElementItem = {
			id: uid(),
			type: 'element',
			url: location.href,
			comment: '',
			target: describeElement(target),
		};
		busy = 'capture';
		if (draft.attachments.length < LIMITS.attachments) {
			try {
				item.attachment = attach(await capture(window, target, host));
			} catch (err) {
				console.warn('[hmm] screenshot failed', err);
			}
		}
		draft.items.push(item);
		busy = '';
		await focusItem(item.id);
	}

	async function addShot() {
		if (busy || !host) return;
		if (draft.items.length >= LIMITS.items || draft.attachments.length >= LIMITS.attachments) {
			error = L.full;
			return;
		}
		busy = 'capture';
		error = '';
		try {
			const id = uid();
			const attachment = attach(await capture(window, null, host));
			draft.items.push({ id, type: 'screenshot', url: location.href, comment: '', attachment });
			void focusItem(id);
		} catch (err) {
			console.warn('[hmm] screenshot failed', err);
			error = L.shotFailed;
		}
		busy = '';
	}

	async function build(): Promise<Envelope | null> {
		const { category, comment, items, attachments } = $state.snapshot(draft) as Draft;
		const used = new Set(items.map((item) => item.attachment));
		const envelope: Envelope = {
			v: ENVELOPE_VERSION,
			id: uid(),
			kind: 'feedback',
			category,
			project: projectKey,
			createdAt: new Date().toISOString(),
			client: { name: '@dorsk/hmm', version: VERSION },
			page: {
				url: location.href,
				title: document.title.slice(0, 300),
				viewport: { width: innerWidth, height: innerHeight },
				userAgent: navigator.userAgent.slice(0, 400),
				language: navigator.language.slice(0, 50),
			},
			context: (await context?.()) ?? {},
			comment: comment.trim(),
			items,
			attachments: attachments.filter((a) => used.has(a.id)),
		};
		const clean = clamp(redactEnvelope(envelope));
		return beforeSend ? await beforeSend(clean) : clean;
	}

	async function review() {
		if (busy || empty) return;
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
	}

	function finish(sent: boolean) {
		busy = '';
		pending = null;
		draft = emptyDraft();
		delivered = sent;
		message = sent ? L.sent : L.queued;
		view = 'done';
	}

	async function send() {
		const envelope = pending;
		if (!envelope || busy) return;
		busy = 'send';
		error = '';
		try {
			await deliver(envelope);
		} catch (err) {
			console.warn('[hmm] sending failed', err);
			if (isRetryable(err) && local && enqueue(local, outboxKey, envelope)) finish(false);
			else {
				busy = '';
				error = L.failed;
			}
			return;
		}
		finish(true);
		onSent?.(envelope);
	}

	export function show() {
		open = true;
	}

	export function hide() {
		open = false;
		void tick().then(() => part('[data-id="launcher"]')?.focus());
	}

	export function isOpen() {
		return open;
	}

	function onKey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open || picking) return;
		event.stopPropagation();
		hide();
	}

	$effect(() => {
		if (open) void tick().then(() => part('[data-id="comment"]')?.focus());
		else
			untrack(() => {
				picking = false;
				if (view === 'done') view = 'edit';
			});
	});

	$effect(() => {
		if (!picking) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			picking = false;
		};
		document.addEventListener('keydown', cancel, true);
		return () => {
			document.removeEventListener('keydown', cancel, true);
			outline = null;
		};
	});

	$effect(placePins);

	$effect(() => {
		if (ready) saveDraft(session, draftKey, $state.snapshot(draft) as Draft);
	});

	onMount(() => {
		session = storageOf(() => sessionStorage);
		local = storageOf(() => localStorage);
		draft = loadDraft(session, draftKey);
		ready = true;

		const schedulePins = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(placePins);
		};
		const flushOutbox = () => {
			if (local) void flush(local, outboxKey, deliver).catch(() => {});
		};
		addEventListener('scroll', schedulePins, { capture: true, passive: true });
		addEventListener('resize', schedulePins);
		addEventListener('online', flushOutbox);
		flushOutbox();
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', schedulePins, { capture: true });
			removeEventListener('resize', schedulePins);
			removeEventListener('online', flushOutbox);
		};
	});
</script>

{#snippet itemHead(item: Item, n: number)}
	<Badge tone="accent" size="sm" numeric>{n}</Badge>
	<Text tone="muted" size="sm" truncate grow data-id="item-label">{titleOf(item)}</Text>
{/snippet}

<div
	bind:this={host}
	data-hmm
	class="hmm"
	class:left={position === 'bottom-left'}
	role="presentation"
	onkeydown={onKey}
>
	{#if launcher && !open && !picking}
		<div class="corner">
			<Button pill data-id="launcher" onclick={show}>{L.launcher}</Button>
		</div>
	{/if}

	{#if open && !picking}
		<div class="corner panel">
			<Card
				as="section"
				padding="none"
				surface="raised"
				role="dialog"
				aria-label={L.title}
				data-id="panel"
				style="display: flex; flex-direction: column; flex: 1; min-height: 0"
			>
				<header class="head">
					<Heading level={2} size="sm">{L.title}</Heading>
					<IconButton icon="x" label={L.close} data-id="close" onclick={hide} />
				</header>

				{#if view === 'review' && pending}
					<div class="body" data-id="review-body">
						<Text as="p" tone="muted" size="sm">{L.reviewIntro}</Text>
						<KeyValue {rows} />
						{#each pending.items as item, i (item.id)}
							{@const image = imageOf(pending.attachments, item)}
							<Card padding="sm" gap="var(--sp-2)">
								<Cluster wrap={false}>{@render itemHead(item, i + 1)}</Cluster>
								{#if item.comment}<Text as="p" wrap="anywhere">{item.comment}</Text>{/if}
								{#if image}<img class="shot" src={image} alt={titleOf(item)} />{/if}
							</Card>
						{/each}
						{#if Object.keys(pending.context).length > 0}
							<Disclosure size="compact">
								{#snippet header()}{L.context}{/snippet}
								<CodeBlock
									code={JSON.stringify(pending.context, null, 2)}
									lang="json"
									wrap
									copy={false}
									maxHeight="12rem"
								/>
							</Disclosure>
						{/if}
						<Disclosure size="compact" data-id="raw">
							{#snippet header()}{L.raw}{/snippet}
							<CodeBlock code={readable(pending)} lang="json" wrap copy={false} maxHeight="12rem" />
						</Disclosure>
						{#if error}<Callout tone="danger" data-id="error">{error}</Callout>{/if}
					</div>
					<footer class="foot">
						<Button
							data-id="back"
							disabled={!!busy}
							onclick={() => {
								view = 'edit';
								error = '';
							}}
						>
							{L.back}
						</Button>
						<Button variant="primary" data-id="send" loading={busy === 'send'} onclick={send}>
							{L.send}
						</Button>
					</footer>
				{:else if view === 'done'}
					<div class="body">
						<Callout tone={delivered ? 'ok' : 'warn'} data-id="message">{message}</Callout>
					</div>
					<footer class="foot end">
						<Button variant="primary" data-id="done" onclick={hide}>{L.done}</Button>
					</footer>
				{:else}
					<div class="body">
						<SegmentedControl
							label={L.category}
							size="sm"
							options={categories}
							value={draft.category}
							onchange={(value) => {
								draft.category = value as Category;
							}}
						/>
						<Textarea
							block
							rows={3}
							maxlength={4000}
							data-id="comment"
							aria-label={L.comment}
							placeholder={L.commentPlaceholder}
							bind:value={draft.comment}
						/>
						{#each draft.items as item, i (item.id)}
							{@const image = imageOf(draft.attachments, item)}
							<Card padding="sm" gap="var(--sp-2)" data-id="item">
								<Cluster wrap={false}>
									{@render itemHead(item, i + 1)}
									<IconButton
										icon="x"
										box="sm"
										label={L.remove}
										data-id="remove"
										onclick={() => removeItem(item)}
									/>
								</Cluster>
								{#if image}
									<Cluster wrap={false} align="start">
										<img class="shot" src={image} alt={titleOf(item)} />
										{#if item.type === 'element'}
											<IconButton
												icon="trash"
												box="sm"
												label={L.removeImage}
												data-id="remove-image"
												onclick={() => removeImage(item)}
											/>
										{/if}
									</Cluster>
								{/if}
								<Textarea
									block
									rows={2}
									maxlength={4000}
									data-id="item-comment"
									data-item={item.id}
									aria-label="{L.comment} {i + 1}"
									placeholder={L.itemPlaceholder}
									bind:value={item.comment}
								/>
							</Card>
						{/each}
						<Cluster>
							<Button size="sm" data-id="pick" disabled={!!busy} onclick={beginPick}>
								{L.pick}
							</Button>
							<Button size="sm" data-id="shot" loading={busy === 'capture'} onclick={addShot}>
								{L.shot}
							</Button>
						</Cluster>
						{#if busy === 'capture'}
							<Text as="p" tone="muted" size="sm" role="status">{L.capturing}</Text>
						{/if}
						{#if error}<Callout tone="danger" data-id="error">{error}</Callout>{/if}
					</div>
					<footer class="foot">
						<Button
							data-id="discard"
							disabled={!!busy || empty}
							onclick={() => {
								draft = emptyDraft();
								error = '';
							}}
						>
							{L.discard}
						</Button>
						<Button variant="primary" data-id="review" disabled={!!busy || empty} onclick={review}>
							{L.review}
						</Button>
					</footer>
				{/if}
			</Card>
		</div>
	{/if}

	<div aria-hidden="true">
		{#each pins as pin (pin.n)}
			<div class="pin" style:transform="translate({pin.x}px, {pin.y}px)">
				<Badge tone="accent" size="sm" numeric>{pin.n}</Badge>
			</div>
		{/each}
	</div>

	{#if picking}
		<div class="glass" role="presentation" onmousemove={onMove} onclick={onPick}></div>
		{#if outline}
			<div
				class="outline"
				style:transform="translate({outline.left}px, {outline.top}px)"
				style:width="{outline.width}px"
				style:height="{outline.height}px"
			></div>
		{/if}
		<div class="hint" role="status">
			<Card padding="sm" surface="raised">{L.pickHint}</Card>
		</div>
	{/if}
</div>

<style>
	.hmm {
		display: contents;
		--z: var(--hmm-z-index, var(--z-toast, 300));
	}
	.corner {
		position: fixed;
		right: var(--sp-4);
		bottom: var(--sp-4);
		z-index: var(--z);
	}
	.left .corner {
		right: auto;
		left: var(--sp-4);
	}
	.panel {
		display: flex;
		flex-direction: column;
		width: 24rem;
		max-width: calc(100vw - 2 * var(--sp-4));
		max-height: min(42rem, calc(100dvh - 2 * var(--sp-4)));
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
	}
	.head,
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2);
		padding: var(--sp-2) var(--sp-3);
	}
	.head {
		border-bottom: var(--edge-width) solid var(--surface-edge);
	}
	.foot {
		border-top: var(--edge-width) solid var(--surface-edge);
	}
	.foot.end {
		justify-content: flex-end;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
		min-height: 0;
		padding: var(--sp-3);
		overflow-y: auto;
	}
	.shot {
		display: block;
		align-self: flex-start;
		min-width: 0;
		max-width: 100%;
		max-height: 10rem;
		border: var(--edge-width) solid var(--surface-edge);
		border-radius: var(--r-sm);
	}
	.pin {
		position: fixed;
		top: 0;
		left: 0;
		z-index: calc(var(--z) - 1);
		border-radius: var(--r-pill);
		background: var(--surface);
		box-shadow: var(--shadow-md);
		pointer-events: none;
	}
	.glass {
		position: fixed;
		inset: 0;
		z-index: var(--z);
		cursor: crosshair;
	}
	.outline {
		position: fixed;
		top: 0;
		left: 0;
		z-index: var(--z);
		border: 2px solid var(--accent);
		border-radius: var(--r-xs);
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		pointer-events: none;
	}
	.hint {
		position: fixed;
		top: var(--sp-4);
		left: 50%;
		z-index: var(--z);
		transform: translateX(-50%);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		pointer-events: none;
	}
</style>
