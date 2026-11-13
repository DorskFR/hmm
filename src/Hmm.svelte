<script lang="ts">
	import {
		Badge,
		Button,
		Callout,
		Card,
		Cluster,
		CodeBlock,
		Disclosure,
		Field,
		Heading,
		IconButton,
		KeyValue,
		type KeyValueRow,
		Stack,
		Text,
		Textarea,
	} from '@dorsk/tsumikit';
	import { onMount, tick, untrack } from 'svelte';
	import { register } from './controller.svelte.ts';
	import { clamp, type Options, readable, shortUrl, storageOf, transportOf, uid } from './core.ts';
	import { type Draft, emptyDraft, isEmpty, loadDraft, saveDraft } from './draft.ts';
	import {
		type Attachment,
		type ElementItem,
		ENVELOPE_VERSION,
		type Envelope,
		type Item,
		LIMITS,
		validateEnvelope,
	} from './envelope.ts';
	import { describeElement, labelOf } from './inspect.ts';
	import Launcher from './Launcher.svelte';
	import { type Corner, type Placement, panelOrigin, placementFor, resolveLauncher } from './launcher.ts';
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
		position,
		labels,
		onSent,
		launcherContent,
		open = $bindable(false),
	}: Options & { open?: boolean } = $props();

	const L = $derived<Labels>({ ...LABELS, ...labels });
	const deliver = $derived(transportOf({ projectKey, endpoint, transport }));
	untrack(() => deliver);
	const draftKey = $derived(`hmm:draft:${projectKey}`);
	const outboxKey = $derived(`hmm:outbox:${projectKey}`);
	const resolved = $derived(resolveLauncher(launcher, position));

	let host: HTMLElement | undefined;
	let launcherEl = $state<HTMLElement>();
	let panelEl = $state<HTMLElement>();
	let at = $state<Corner | null>(null);
	let spot = $state<{ left: number; top: number } | null>(null);
	let opener: HTMLElement | null = null;
	const EDGE_MARGIN = 16;
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
		pending?.page ? [{ label: L.page, value: shortUrl(pending.page.url) }] : [],
	);
	const ids = { title: uid(), comment: uid(), attach: uid() };

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
		const { comment, items, attachments } = $state.snapshot(draft) as Draft;
		const used = new Set(items.map((item) => item.attachment));
		const envelope: Envelope = {
			v: ENVELOPE_VERSION,
			id: uid(),
			kind: 'feedback',
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

	export function show(corner?: Corner) {
		at = corner ?? null;
		open = true;
	}

	export function hide() {
		open = false;
		const back = opener?.isConnected ? opener : part('[data-id="launcher"]');
		opener = null;
		void tick().then(() => back?.focus());
	}

	function placement(): Placement {
		if (!at && resolved && launcherEl) return placementFor(resolved, launcherEl.getBoundingClientRect());
		return { mode: 'corner', corner: at ?? (position === 'bottom-left' ? 'bottom-left' : 'bottom-right') };
	}

	function place() {
		if (!panelEl) return;
		const { width, height } = panelEl.getBoundingClientRect();
		const viewport = { width: innerWidth, height: innerHeight };
		spot = panelOrigin(placement(), { width, height }, viewport, EDGE_MARGIN, EDGE_MARGIN / 2);
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
		if (open)
			untrack(() => {
				const focused = document.activeElement;
				if (!opener && focused instanceof HTMLElement && !host?.contains(focused)) opener = focused;
				void tick().then(() => part('[data-id="comment"]')?.focus());
			});
		else
			untrack(() => {
				picking = false;
				at = null;
				spot = null;
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
		if (!panelEl) return;
		place();
		const observer = new ResizeObserver(place);
		observer.observe(panelEl);
		addEventListener('resize', place);
		return () => {
			observer.disconnect();
			removeEventListener('resize', place);
		};
	});

	$effect(() => {
		if (ready) saveDraft(session, draftKey, $state.snapshot(draft) as Draft);
	});

	onMount(() => {
		session = storageOf(() => sessionStorage);
		local = storageOf(() => localStorage);
		draft = loadDraft(session, draftKey);
		ready = true;
		const unregister = register({ show, hide, isOpen });

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
			unregister();
		};
	});
</script>

{#snippet pointerGlyph()}
	<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M4.04 3.4a.5.5 0 0 1 .64-.64l15.55 6.13a.5.5 0 0 1-.04.95l-6.04 1.83a2 2 0 0 0-1.34 1.34l-1.83 6.04a.5.5 0 0 1-.95.04z" />
	</svg>
{/snippet}

{#snippet cameraGlyph()}
	<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
		<circle cx="12" cy="13" r="3" />
	</svg>
{/snippet}

{#snippet itemHead(item: Item, n: number)}
	<Badge tone="accent" size="sm" numeric>{n}</Badge>
	<Text tone="muted" size="sm" truncate grow data-id="item-label">{titleOf(item)}</Text>
{/snippet}

<div
	bind:this={host}
	data-hmm
	class="hmm"
	role="presentation"
	onkeydown={onKey}
>
	{#if resolved}
		<Launcher
			launcher={resolved}
			label={L.launcher}
			title={L.title}
			hidden={picking || (open && resolved.form === 'floating')}
			active={open}
			content={launcherContent}
			onopen={() => (open ? hide() : show())}
			bind:element={launcherEl}
		/>
	{/if}

	{#if open && !picking}
		<div
			class="panel"
			class:placed={spot !== null}
			bind:this={panelEl}
			style:left={spot ? `${spot.left}px` : undefined}
			style:top={spot ? `${spot.top}px` : undefined}
		>
			<Card
				as="section"
				padding="none"
				surface="raised"
				role="dialog"
				aria-labelledby={ids.title}
				data-id="panel"
				style="display: flex; flex-direction: column; flex: 1; min-height: 0"
			>
				<header class="head">
					<Stack gap="var(--sp-1)">
						<Heading level={2} size="lg" id={ids.title}>{L.title}</Heading>
						{#if view !== 'done'}
							<Text as="p" tone="muted" data-id="subtitle">
								{view === 'review' ? L.reviewIntro : L.subtitle}
							</Text>
						{/if}
					</Stack>
					<IconButton icon="x" label={L.close} data-id="close" onclick={hide} />
				</header>

				{#if view === 'review' && pending}
					<div class="body" data-id="review-body">
						{#if pending.comment}
							<Stack gap="var(--sp-2)">
								<Text weight="medium">{L.yourFeedback}</Text>
								<div class="said" data-id="said">
									<Text as="p" wrap="anywhere">{pending.comment}</Text>
								</div>
							</Stack>
						{/if}
						{#each pending.items as item, i (item.id)}
							{@const image = imageOf(pending.attachments, item)}
							<Card padding="sm" gap="var(--sp-2)">
								<Cluster wrap={false}>{@render itemHead(item, i + 1)}</Cluster>
								{#if item.comment}<Text as="p" wrap="anywhere">{item.comment}</Text>{/if}
								{#if image}<img class="shot" src={image} alt={titleOf(item)} />{/if}
							</Card>
						{/each}
						<KeyValue {rows} />
						<Disclosure size="compact" data-id="raw">
							{#snippet header()}{L.technical}{/snippet}
							<CodeBlock code={readable(pending)} lang="json" wrap copy={false} maxHeight="12rem" />
						</Disclosure>
						{#if error}<Callout tone="danger" data-id="error">{error}</Callout>{/if}
					</div>
					<footer class="foot end">
						<Button
							variant="ghost"
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
						<Field label={L.details} for={ids.comment}>
							<Textarea
								block
								rows={4}
								maxlength={4000}
								id={ids.comment}
								data-id="comment"
								placeholder={L.commentPlaceholder}
								bind:value={draft.comment}
							/>
						</Field>
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
						<Stack gap="var(--sp-2)" role="group" aria-labelledby={ids.attach}>
							<Text tone="muted" size="sm" id={ids.attach}>{L.attach}</Text>
							<Cluster>
								<Button data-id="pick" glyph={pointerGlyph} disabled={!!busy} onclick={beginPick}>
									{L.pick}
								</Button>
								<Button
									data-id="shot"
									glyph={cameraGlyph}
									loading={busy === 'capture'}
									onclick={addShot}
								>
									{L.shot}
								</Button>
							</Cluster>
						</Stack>
						{#if busy === 'capture'}
							<Text as="p" tone="muted" size="sm" role="status">{L.capturing}</Text>
						{/if}
						{#if error}<Callout tone="danger" data-id="error">{error}</Callout>{/if}
					</div>
					<footer class="foot">
						<Text tone="muted" size="sm" grow>{L.reviewHint}</Text>
						<Button
							variant="ghost"
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
	.panel {
		position: fixed;
		top: 0;
		left: 0;
		z-index: var(--z);
		visibility: hidden;
		display: flex;
		flex-direction: column;
		width: 30rem;
		max-width: calc(100vw - 2 * var(--sp-4));
		max-height: min(42rem, calc(100dvh - 2 * var(--sp-4)));
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
	}
	.panel.placed {
		visibility: visible;
	}
	.head,
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2);
		padding: var(--sp-4);
	}
	.head {
		align-items: flex-start;
		padding-bottom: 0;
	}
	.foot {
		border-top: var(--edge-width) solid var(--surface-edge);
		background: color-mix(in srgb, var(--text) 4%, transparent);
		border-radius: 0 0 var(--r-lg) var(--r-lg);
	}
	.foot.end {
		justify-content: flex-end;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		min-height: 0;
		padding: var(--sp-4);
		overflow-y: auto;
	}
	.said {
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--r-md);
		background: var(--control-fill);
	}
	.glyph {
		width: 1.1em;
		height: 1.1em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
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
