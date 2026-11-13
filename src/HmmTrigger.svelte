<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import type { ComponentProps, Snippet } from 'svelte';
	import { hmm } from './controller.svelte.ts';
	import Glyph from './Glyph.svelte';
	import { LABELS } from './labels.ts';
	import type { Corner } from './launcher.ts';

	type Props = Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'icon' | 'onclick'> & {
		look?: 'icon' | 'pill' | 'button' | 'link';
		label?: string;
		title?: string;
		panel?: Corner;
		children?: Snippet;
		custom?: Snippet<[{ open: () => void; isOpen: boolean }]>;
	};

	let {
		look = 'pill',
		label = LABELS.launcher,
		title = LABELS.title,
		panel = 'bottom-right',
		children,
		custom,
		...rest
	}: Props = $props();

	const open = () => hmm.toggle(panel);
	const iconOnly = $derived(look === 'icon' || (!children && !label));
</script>

{#if custom}
	{@render custom({ open, isOpen: hmm.isOpen })}
{:else}
	<Button
		variant={look === 'button' ? 'primary' : look === 'link' ? 'link' : 'default'}
		pill={look === 'pill' || look === 'icon'}
		icon={iconOnly}
		{title}
		aria-label={iconOnly ? title : undefined}
		aria-haspopup="dialog"
		aria-expanded={hmm.isOpen}
		data-hmm-trigger
		{...rest}
		onclick={open}
	>
		{#if children}
			{@render children()}
		{:else}
			{#if look !== 'link'}<Glyph />{/if}
			{#if !iconOnly}<span>{label}</span>{/if}
		{/if}
	</Button>
{/if}
