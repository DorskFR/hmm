<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';
	import type { Resolved } from './launcher.ts';

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

	let revealed = $state(false);
	let pointer = '';
	const tucked = $derived(launcher.form !== 'floating');
	const iconOnly = $derived(!label || launcher.look === 'icon');
	const variant = $derived(launcher.look === 'button' ? 'primary' : 'default');

	function onclick() {
		if (tucked && pointer === 'touch' && !revealed && !active) {
			revealed = true;
			return;
		}
		revealed = false;
		onopen();
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

<div
	bind:this={element}
	class="launcher {launcher.form}"
	class:shown={revealed || active}
	class:hidden
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
		<!-- tsumikit-lint-ignore no-raw-control -->
		<button
			type="button"
			class="tab"
			class:primary={launcher.look === 'button' || launcher.form === 'corner'}
			{title}
			aria-label={iconOnly ? title : undefined}
			data-id="launcher"
			onpointerdown={(event) => (pointer = event.pointerType)}
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
	.edge:not(.shown, :hover, :focus-within)[data-side='right'] .tab {
		transform: translateX(calc(100% - var(--tuck) - var(--peek)));
	}
	.edge:not(.shown, :hover, :focus-within)[data-side='left'] .tab {
		transform: translateX(calc(var(--tuck) + var(--peek) - 100%));
	}
	.edge:not(.shown, :hover, :focus-within)[data-side='top'] .tab {
		transform: translateY(calc(var(--tuck) + var(--peek) - 100%));
	}
	.edge:not(.shown, :hover, :focus-within)[data-side='bottom'] .tab {
		transform: translateY(calc(100% - var(--tuck) - var(--peek)));
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
	.corner:not(.shown, :hover, :focus-within)[data-corner='top-left'] .tab {
		transform: translate(
			calc(var(--reach) - 100% - var(--sp-3)),
			calc(var(--reach) - 100% - var(--sp-3))
		);
	}
	.corner:not(.shown, :hover, :focus-within)[data-corner='top-right'] .tab {
		transform: translate(
			calc(100% + var(--sp-3) - var(--reach)),
			calc(var(--reach) - 100% - var(--sp-3))
		);
	}
	.corner:not(.shown, :hover, :focus-within)[data-corner='bottom-left'] .tab {
		transform: translate(
			calc(var(--reach) - 100% - var(--sp-3)),
			calc(100% + var(--sp-3) - var(--reach))
		);
	}
	.corner:not(.shown, :hover, :focus-within)[data-corner='bottom-right'] .tab {
		transform: translate(
			calc(100% + var(--sp-3) - var(--reach)),
			calc(100% + var(--sp-3) - var(--reach))
		);
	}
</style>
