<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';
	import { approach, distance, dragPull, inward, type Resolved } from './launcher.ts';

	let {
		launcher,
		label,
		title,
		hidden = false,
		active = false,
		onopen,
		content,
		element = $bindable(),
	}: {
		launcher: Resolved;
		label: string;
		title: string;
		hidden?: boolean;
		active?: boolean;
		onopen: () => void;
		content?: Snippet;
		element?: HTMLElement;
	} = $props();

	const REACH = 96;
	const SLOP = 8;

	let revealed = $state(false);
	let pointer = $state('');
	let near = $state(0);
	let drag = $state<number | null>(null);
	let tab = $state<HTMLButtonElement>();
	let swipe: { id: number; x: number; y: number; from: number } | null = null;
	let swallow = false;
	const tucked = $derived(launcher.form !== 'floating');
	const iconOnly = $derived(!label || launcher.look === 'icon');
	const variant = $derived(launcher.look === 'button' ? 'primary' : 'default');
	const dir = $derived(inward(launcher));

	function onclick() {
		if (swallow) {
			swallow = false;
			return;
		}
		if (tucked && pointer === 'touch' && !revealed && !active) {
			revealed = true;
			return;
		}
		revealed = false;
		onopen();
	}

	function ondown(event: PointerEvent) {
		pointer = event.pointerType;
		swallow = false;
		if (!tucked || active || event.pointerType !== 'touch') return;
		swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, from: revealed ? 1 : 0 };
	}

	function onmove(event: PointerEvent) {
		if (!swipe || event.pointerId !== swipe.id || !tab) return;
		const dx = event.clientX - swipe.x;
		const dy = event.clientY - swipe.y;
		if (drag === null && Math.hypot(dx, dy) < SLOP) return;
		const travel = Math.abs(dir.x) * tab.offsetWidth + Math.abs(dir.y) * tab.offsetHeight;
		drag = dragPull(swipe.from, dx, dy, dir, travel);
	}

	function onup(event: PointerEvent) {
		if (!swipe || event.pointerId !== swipe.id) return;
		swipe = null;
		if (drag === null) return;
		revealed = drag > 0.5;
		if (!revealed) tab?.blur();
		drag = null;
		swallow = true;
	}

	$effect(() => {
		if (!tucked || revealed || active) {
			near = 0;
			return;
		}
		let frame = 0;
		let at = { x: 0, y: 0 };
		const measure = () => {
			frame = 0;
			const box = element?.getBoundingClientRect();
			if (box) near = approach(distance(box, at.x, at.y), REACH);
		};
		const move = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return;
			at = { x: event.clientX, y: event.clientY };
			frame ||= requestAnimationFrame(measure);
		};
		const out = (event: PointerEvent) => {
			if (!event.relatedTarget) near = 0;
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

<div
	bind:this={element}
	class="launcher {launcher.form}"
	class:shown={revealed || active}
	class:dragging={drag !== null}
	class:touch={pointer === 'touch'}
	class:hidden
	style:--pull={drag ?? near}
	inert={hidden}
	data-hmm-launcher={launcher.form}
	data-anchor={launcher.form === 'floating' ? launcher.anchor : undefined}
	data-side={launcher.form === 'edge' ? launcher.side : undefined}
	data-align={launcher.form === 'edge' ? launcher.align : undefined}
	data-corner={launcher.form === 'corner' ? launcher.corner : undefined}
>
	{#if launcher.form === 'floating'}
		<Button
			pill={launcher.look !== 'button'}
			icon={iconOnly}
			{variant}
			{title}
			aria-label={iconOnly ? title : undefined}
			data-id="launcher"
			{onclick}
		>
			{@render face()}
		</Button>
	{:else}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="zone"
			aria-hidden="true"
			data-id="launcher-zone"
			onpointerdown={ondown}
			onpointermove={onmove}
			onpointerup={onup}
			onpointercancel={onup}
			{onclick}
		></div>
		<!-- tsumikit-lint-ignore no-raw-control -->
		<button
			type="button"
			class="tab"
			class:primary={launcher.look === 'button' || launcher.form === 'corner'}
			{title}
			aria-label={iconOnly ? title : undefined}
			data-id="launcher"
			bind:this={tab}
			onpointerdown={ondown}
			onpointermove={onmove}
			onpointerup={onup}
			onpointercancel={onup}
			{onclick}
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
	.launcher:hover .tab,
	.launcher:focus-within .tab {
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
	.edge:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-side='right'] .tab {
		transform: translateX(calc((100% - var(--tuck) - var(--peek)) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-side='left'] .tab {
		transform: translateX(calc((var(--tuck) + var(--peek) - 100%) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-side='top'] .tab {
		transform: translateY(calc((var(--tuck) + var(--peek) - 100%) * (1 - var(--pull))));
	}
	.edge:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-side='bottom'] .tab {
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
	.corner:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-corner='top-left'] .tab {
		transform: translate(
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull))),
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-corner='top-right'] .tab {
		transform: translate(
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull))),
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-corner='bottom-left'] .tab {
		transform: translate(
			calc((var(--reach) - 100% - var(--sp-3)) * (1 - var(--pull))),
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull)))
		);
	}
	.corner:is(:not(.shown, :hover:not(.touch), :focus-within), .dragging)[data-corner='bottom-right'] .tab {
		transform: translate(
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull))),
			calc((100% + var(--sp-3) - var(--reach)) * (1 - var(--pull)))
		);
	}
</style>
