<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import type { Snippet } from 'svelte';
	import { uid } from './core.ts';
	import Glyph from './Glyph.svelte';
	import {
		type Arrow,
		approach,
		distance,
		dragPull,
		inward,
		nudge,
		type Resolved,
		type Spot,
		snapSpot,
		spotBox,
		spotOf,
	} from './launcher.ts';

	let {
		launcher,
		label,
		title,
		hint = '',
		hidden = false,
		active = false,
		onopen,
		onmove,
		onreset,
		content,
		element = $bindable(),
	}: {
		launcher: Resolved;
		label: string;
		title: string;
		hint?: string;
		hidden?: boolean;
		active?: boolean;
		onopen: () => void;
		onmove?: (spot: Spot) => void;
		onreset?: () => void;
		content?: Snippet;
		element?: HTMLElement;
	} = $props();

	const REACH = 96;
	const SLOP = 8;
	const LONG_PRESS = 400;
	const TOUCH = 32;
	const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
	const hintId = uid();

	let revealed = $state(false);
	let pointer = $state('');
	let near = $state(0);
	let close = $state(false);
	let touched = $state(false);
	let within = $state(false);
	let drag = $state<number | null>(null);
	let moving = $state<{ dx: number; dy: number; spot: Spot } | null>(null);
	let focused = $state(false);
	let hovered = $state(false);
	let keyboard = false;
	let tab = $state<HTMLButtonElement>();
	let press: {
		id: number;
		x: number;
		y: number;
		from: number;
		swipes: boolean;
		mode: 'pending' | 'swipe' | 'move';
	} | null = null;
	let hold = 0;
	let swallow = false;
	const tucked = $derived(launcher.form !== 'floating');
	const movable = $derived(launcher.movable && !!onmove);
	const iconOnly = $derived(!label || launcher.look === 'icon');
	const variant = $derived(launcher.look === 'button' ? 'primary' : 'default');
	const dir = $derived(inward(launcher));
	const shown = $derived(revealed || active || focused || moving !== null);
	const pull = $derived(drag ?? (tucked && !revealed && !active ? near : 0));
	const raised = $derived(shown || close || touched || within || hovered || drag !== null);
	const offset = $derived(launcher.form === 'edge' ? launcher.offset : undefined);
	const upright = $derived(
		launcher.form === 'edge' && (launcher.side === 'left' || launcher.side === 'right'),
	);
	const phase = $derived.by(() => {
		if (!tucked) return 'out';
		if (drag !== null) return drag > 0 ? 'peek' : 'tucked';
		if (shown || (hovered && pointer !== 'touch')) return 'out';
		return pull > 0 ? 'peek' : 'tucked';
	});

	const viewport = () => ({
		width: document.documentElement.clientWidth,
		height: document.documentElement.clientHeight,
	});
	const size = () => ({ width: element?.offsetWidth ?? 0, height: element?.offsetHeight ?? 0 });
	const preview = $derived(moving && spotBox(moving.spot, size(), viewport()));

	function onclick(event: MouseEvent) {
		if (swallow) {
			swallow = false;
			return;
		}
		if (movable && event.detail > 1 && pointer !== 'touch') return;
		if (tucked && pointer === 'touch' && !revealed && !active) {
			revealed = true;
			return;
		}
		revealed = false;
		onopen();
	}

	function ondblclick() {
		if (movable && pointer !== 'touch') onreset?.();
	}

	function onkeydown(event: KeyboardEvent) {
		if (!movable || !event.altKey || !ARROWS.includes(event.key) || !element) return;
		event.preventDefault();
		const from = spotOf(launcher, element.getBoundingClientRect());
		onmove?.(nudge(from, event.key as Arrow, viewport(), size()));
	}

	function begin(x: number, y: number) {
		if (!press) return;
		clearTimeout(hold);
		press.mode = 'move';
		moving = {
			dx: x - press.x,
			dy: y - press.y,
			spot: snapSpot(launcher.form, x, y, viewport(), size()),
		};
	}

	function ondown(event: PointerEvent) {
		pointer = event.pointerType;
		swallow = false;
		if (active || event.button !== 0) return;
		const swipes = tucked && event.pointerType === 'touch';
		if (!swipes && !movable) return;
		press = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			from: revealed ? 1 : 0,
			swipes,
			mode: 'pending',
		};
		try {
			(event.target as Element).setPointerCapture(event.pointerId);
		} catch {}
		clearTimeout(hold);
		if (event.pointerType === 'touch' && movable) {
			const { clientX, clientY } = event;
			hold = window.setTimeout(() => {
				if (press?.mode === 'pending') begin(clientX, clientY);
			}, LONG_PRESS);
		}
	}

	function onmovepointer(event: PointerEvent) {
		if (!press || event.pointerId !== press.id) return;
		const dx = event.clientX - press.x;
		const dy = event.clientY - press.y;
		if (press.mode === 'pending') {
			const length = Math.hypot(dx, dy);
			if (length < SLOP) return;
			clearTimeout(hold);
			const inwardish = Math.abs(dx * dir.x + dy * dir.y) >= Math.SQRT1_2 * length;
			press.mode = press.swipes && (inwardish || !movable) ? 'swipe' : 'move';
			if (press.mode === 'move') begin(event.clientX, event.clientY);
		}
		if (press.mode === 'move') {
			moving = {
				dx,
				dy,
				spot: snapSpot(launcher.form, event.clientX, event.clientY, viewport(), size()),
			};
			return;
		}
		if (!tab) return;
		const travel = Math.abs(dir.x) * tab.offsetWidth + Math.abs(dir.y) * tab.offsetHeight;
		drag = dragPull(press.from, dx, dy, dir, travel);
	}

	function onup(event: PointerEvent) {
		if (!press || event.pointerId !== press.id) return;
		clearTimeout(hold);
		const { mode } = press;
		press = null;
		if (mode === 'move' && moving) {
			const { spot, dx, dy } = moving;
			moving = null;
			swallow = true;
			revealed = false;
			if (event.type === 'pointerup' && Math.hypot(dx, dy) >= SLOP) onmove?.(spot);
			return;
		}
		if (drag === null) return;
		revealed = drag > 0.5;
		if (!revealed) tab?.blur();
		drag = null;
		swallow = true;
	}

	$effect(() => () => clearTimeout(hold));

	const gap = (x: number, y: number) => {
		const box = element?.getBoundingClientRect();
		return box ? distance(box, x, y) : Infinity;
	};

	$effect(() => {
		let frame = 0;
		let at = { x: 0, y: 0 };
		const measure = () => {
			frame = 0;
			const d = gap(at.x, at.y);
			near = approach(d, REACH);
			close = d < REACH;
		};
		const move = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return;
			at = { x: event.clientX, y: event.clientY };
			frame ||= requestAnimationFrame(measure);
		};
		const out = (event: PointerEvent) => {
			if (event.relatedTarget) return;
			near = 0;
			close = false;
		};
		document.addEventListener('pointermove', move, { passive: true });
		document.addEventListener('pointerout', out);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener('pointermove', move);
			document.removeEventListener('pointerout', out);
		};
	});

	$effect(() => {
		const key = () => (keyboard = true);
		const point = (event: PointerEvent) => {
			keyboard = false;
			if (event.pointerType !== 'touch') return;
			touched = gap(event.clientX, event.clientY) < TOUCH;
			if (touched) pointer = 'touch';
		};
		document.addEventListener('keydown', key, true);
		document.addEventListener('pointerdown', point, true);
		return () => {
			document.removeEventListener('keydown', key, true);
			document.removeEventListener('pointerdown', point, true);
		};
	});

	function onfocusout(event: FocusEvent) {
		if (element?.contains(event.relatedTarget as Node)) return;
		focused = false;
		within = false;
	}

	$effect(() => {
		if (!revealed) return;
		const away = (event: PointerEvent) => {
			if (!element?.contains(event.target as Node)) revealed = false;
		};
		document.addEventListener('pointerdown', away, true);
		return () => document.removeEventListener('pointerdown', away, true);
	});
</script>

{#snippet face()}
	{#if content}
		{@render content()}
	{:else}
		<Glyph />
		{#if !iconOnly}<span data-id="launcher-label">{label}</span>{/if}
	{/if}
{/snippet}

{#if preview}
	<div
		class="preview"
		aria-hidden="true"
		data-id="launcher-preview"
		style:left="{preview.left}px"
		style:top="{preview.top}px"
		style:width="{preview.right - preview.left}px"
		style:height="{preview.bottom - preview.top}px"
	></div>
{/if}

<div
	bind:this={element}
	class="launcher {launcher.form}"
	class:shown
	class:dragging={drag !== null}
	class:moving={moving !== null}
	class:movable
	class:touch={pointer === 'touch'}
	class:hidden
	class:raised
	style:--pull={pull}
	style:transform={moving ? `translate(${moving.dx}px, ${moving.dy}px)` : undefined}
	style:top={offset !== undefined && upright ? `${offset}px` : undefined}
	style:bottom={offset !== undefined && upright ? 'auto' : undefined}
	style:left={offset !== undefined && !upright ? `${offset}px` : undefined}
	style:right={offset !== undefined && !upright ? 'auto' : undefined}
	style:translate={offset === undefined ? undefined : upright ? '0 -50%' : '-50% 0'}
	inert={hidden}
	role="presentation"
	onfocusin={() => {
		focused = keyboard;
		within = true;
	}}
	{onfocusout}
	onpointerover={(event) => (hovered = event.pointerType !== 'touch')}
	onpointerout={(event) => {
		if (!element?.contains(event.relatedTarget as Node)) hovered = false;
	}}
	onpointerdown={ondown}
	onpointermove={onmovepointer}
	onpointerup={onup}
	onpointercancel={onup}
	oncontextmenu={(event) => {
		if (moving) event.preventDefault();
	}}
	data-hmm-launcher={launcher.form}
	data-state={phase}
	data-movable={movable ? '' : undefined}
	data-anchor={launcher.form === 'floating' ? launcher.anchor : undefined}
	data-side={launcher.form === 'edge' ? launcher.side : undefined}
	data-align={launcher.form === 'edge' ? launcher.align : undefined}
	data-offset={offset === undefined ? undefined : Math.round(offset)}
	data-corner={launcher.form === 'corner' ? launcher.corner : undefined}
>
	{#if movable && hint}<span class="move-hint" id={hintId}>{hint}</span>{/if}
	{#if launcher.form === 'floating'}
		<Button
			pill={launcher.look !== 'button'}
			icon={iconOnly}
			{variant}
			{title}
			aria-label={iconOnly ? title : undefined}
			aria-describedby={movable && hint ? hintId : undefined}
			data-id="launcher"
			{onclick}
			{ondblclick}
			{onkeydown}
		>
			{@render face()}
		</Button>
	{:else}
		<div class="zone" aria-hidden="true" data-id="launcher-zone" {onclick}></div>
		<!-- tsumikit-lint-ignore no-raw-control -->
		<button
			type="button"
			class="tab"
			class:primary={launcher.look === 'button' || launcher.form === 'corner'}
			{title}
			aria-label={iconOnly ? title : undefined}
			aria-describedby={movable && hint ? hintId : undefined}
			data-id="launcher"
			bind:this={tab}
			{onclick}
			{ondblclick}
			{onkeydown}
		>
			{#if launcher.form === 'edge'}<span class="grip"></span>{/if}
			{@render face()}
		</button>
	{/if}
</div>

<style>
	.launcher {
		--peek: var(--hmm-peek, var(--sp-2));
		--tuck: var(--sp-3);
		--gap: var(--sp-4);
		--along: var(--sp-12);
		--ox: var(--hmm-offset-x, 0rem);
		--oy: var(--hmm-offset-y, 0rem);
		--zone: var(--hmm-zone, var(--sp-8));
		--pull: 0;
		position: fixed;
		z-index: var(--z);
		pointer-events: none;
	}
	.launcher > :global(*) {
		pointer-events: auto;
	}
	.hidden {
		visibility: hidden;
	}
	.move-hint {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.movable.floating > :global(*) {
		touch-action: none;
	}
	.raised {
		z-index: var(--z-top);
	}
	.moving {
		cursor: grabbing;
	}
	.moving .tab {
		transition: none;
		cursor: grabbing;
	}
	.preview {
		position: fixed;
		z-index: var(--z-top);
		border: 2px dashed var(--accent);
		border-radius: var(--r-lg);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		pointer-events: none;
	}

	.floating[data-anchor^='top'] {
		top: calc(var(--gap) + var(--oy));
	}
	.floating[data-anchor^='bottom'] {
		bottom: calc(var(--gap) + var(--oy));
	}
	.floating[data-anchor$='left'] {
		left: calc(var(--gap) + var(--ox));
	}
	.floating[data-anchor$='right'] {
		right: calc(var(--gap) + var(--ox));
	}
	.floating:is([data-anchor='top'], [data-anchor='bottom']) {
		left: calc(50% + var(--ox));
		translate: -50% 0;
	}
	.floating:is([data-anchor='left'], [data-anchor='right']) {
		top: calc(50% + var(--oy));
		translate: 0 -50%;
	}

	.tab {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		min-height: var(--control-height-default);
		padding: 0 var(--sp-3);
		border: var(--edge-width) solid var(--btn-edge);
		border-radius: var(--r-lg);
		background: var(--btn-fill);
		box-shadow: var(--shadow-md);
		color: var(--text);
		font: inherit;
		font-size: var(--control-fs-md);
		font-weight: var(--fw-medium);
		white-space: nowrap;
		cursor: pointer;
		transition:
			transform var(--dur-base) var(--ease-out),
			box-shadow var(--dur-base) var(--ease-out);
	}
	.tab:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.tab.primary {
		border-color: var(--btn-primary-edge);
		background: var(--btn-primary-fill);
		color: var(--text-on-accent);
	}
	.dragging .tab {
		transition: none;
	}
	.zone {
		position: absolute;
		touch-action: none;
	}
	.edge .tab,
	.corner .tab {
		touch-action: none;
	}
	.edge[data-side='right'] .zone {
		top: calc(-1 * var(--sp-4));
		right: var(--tuck);
		bottom: calc(-1 * var(--sp-4));
		width: var(--zone);
	}
	.edge[data-side='left'] .zone {
		top: calc(-1 * var(--sp-4));
		bottom: calc(-1 * var(--sp-4));
		left: var(--tuck);
		width: var(--zone);
	}
	.edge[data-side='top'] .zone {
		top: var(--tuck);
		right: calc(-1 * var(--sp-4));
		left: calc(-1 * var(--sp-4));
		height: var(--zone);
	}
	.edge[data-side='bottom'] .zone {
		right: calc(-1 * var(--sp-4));
		bottom: var(--tuck);
		left: calc(-1 * var(--sp-4));
		height: var(--zone);
	}
	.corner .zone {
		width: calc(var(--reach) + var(--zone));
		height: calc(var(--reach) + var(--zone));
	}
	.corner[data-corner^='top'] .zone {
		top: 0;
	}
	.corner[data-corner^='bottom'] .zone {
		bottom: 0;
	}
	.corner[data-corner$='left'] .zone {
		left: 0;
	}
	.corner[data-corner$='right'] .zone {
		right: 0;
	}
	.shown .tab,
	.launcher:hover .tab {
		box-shadow: var(--shadow-lg);
	}
	.grip {
		position: absolute;
		border-radius: var(--r-pill);
		background: var(--accent);
	}

	.edge[data-side='right'] {
		right: calc(-1 * var(--tuck));
	}
	.edge[data-side='left'] {
		left: calc(-1 * var(--tuck));
	}
	.edge[data-side='top'] {
		top: calc(-1 * var(--tuck));
	}
	.edge[data-side='bottom'] {
		bottom: calc(-1 * var(--tuck));
	}
	.edge:is([data-side='left'], [data-side='right'])[data-align='start'] {
		top: calc(var(--along) + var(--oy));
	}
	.edge:is([data-side='left'], [data-side='right'])[data-align='center'] {
		top: calc(50% + var(--oy));
		translate: 0 -50%;
	}
	.edge:is([data-side='left'], [data-side='right'])[data-align='end'] {
		bottom: calc(var(--along) + var(--oy));
	}
	.edge:is([data-side='top'], [data-side='bottom'])[data-align='start'] {
		left: calc(var(--along) + var(--ox));
	}
	.edge:is([data-side='top'], [data-side='bottom'])[data-align='center'] {
		left: calc(50% + var(--ox));
		translate: -50% 0;
	}
	.edge:is([data-side='top'], [data-side='bottom'])[data-align='end'] {
		right: calc(var(--along) + var(--ox));
	}

	.edge[data-side='right'] .tab {
		padding-right: calc(var(--sp-3) + var(--tuck));
	}
	.edge[data-side='left'] .tab {
		flex-direction: row-reverse;
		padding-left: calc(var(--sp-3) + var(--tuck));
	}
	.edge[data-side='top'] .tab {
		min-height: calc(var(--control-height-default) + var(--tuck));
		padding-top: var(--tuck);
	}
	.edge[data-side='bottom'] .tab {
		min-height: calc(var(--control-height-default) + var(--tuck));
		padding-bottom: var(--tuck);
	}
	.edge[data-side='right'] .grip,
	.edge[data-side='left'] .grip {
		top: var(--sp-2);
		bottom: var(--sp-2);
		width: var(--sp-0-5);
	}
	.edge[data-side='right'] .grip {
		left: var(--sp-1);
	}
	.edge[data-side='left'] .grip {
		right: var(--sp-1);
	}
	.edge[data-side='top'] .grip,
	.edge[data-side='bottom'] .grip {
		right: var(--sp-3);
		left: var(--sp-3);
		height: var(--sp-0-5);
	}
	.edge[data-side='top'] .grip {
		bottom: var(--sp-1);
	}
	.edge[data-side='bottom'] .grip {
		top: var(--sp-1);
	}
	.edge:is(:not(.shown, :hover:not(.touch)), .dragging)[data-side='right'] .tab {
		transform: translateX(calc((100% - var(--tuck) - var(--peek)) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch)), .dragging)[data-side='left'] .tab {
		transform: translateX(calc((var(--tuck) + var(--peek) - 100%) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch)), .dragging)[data-side='top'] .tab {
		transform: translateY(calc((var(--tuck) + var(--peek) - 100%) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch)), .dragging)[data-side='bottom'] .tab {
		transform: translateY(calc((100% - var(--tuck) - var(--peek)) * (1 - var(--pull))));
	}

	.corner {
		--reach: calc(var(--peek) * 3);
	}
	.corner[data-corner^='top'] {
		top: var(--oy);
	}
	.corner[data-corner^='bottom'] {
		bottom: var(--oy);
	}
	.corner[data-corner$='left'] {
		left: var(--ox);
	}
	.corner[data-corner$='right'] {
		right: var(--ox);
	}
	.corner .tab {
		margin: var(--sp-3);
		border-radius: var(--r-pill);
	}
	.corner:is(:not(.shown, :hover:not(.touch)), .dragging)[data-corner='top-left'] .tab {
		transform: translate(
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull))),
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch)), .dragging)[data-corner='top-right'] .tab {
		transform: translate(
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull))),
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch)), .dragging)[data-corner='bottom-left'] .tab {
		transform: translate(
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull))),
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch)), .dragging)[data-corner='bottom-right'] .tab {
		transform: translate(
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull))),
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull)))
		);
	}
</style>
