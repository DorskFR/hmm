import type { Target } from './envelope.ts';

type SvelteMeta = { loc?: { file: string; line: number; column?: number } };

const SCOPED_CLASS = /^(svelte|s)-[\w-]{5,}$/;
const HOOK_ATTRS = ['data-testid', 'data-test'];
const KEPT_ATTRS = ['role', 'aria-label', 'href', 'name', 'type', 'title', 'alt'];
const SECRET_INPUT = 'input[type="password"]';

function sourceOf(el: Element): Target['source'] {
	for (let node: Element | null = el; node; node = node.parentElement) {
		const loc = (node as Element & { __svelte_meta?: SvelteMeta }).__svelte_meta?.loc;
		if (loc) return { file: loc.file.slice(0, 400), line: loc.line, column: loc.column ?? 0 };
	}
	return undefined;
}

export function selectorOf(el: Element): string {
	const doc = el.ownerDocument;
	const parts: string[] = [];
	for (
		let node: Element | null = el;
		node && node.nodeType === 1 && node !== doc.documentElement;
		node = node.parentElement
	) {
		for (const attr of HOOK_ATTRS) {
			const value = node.getAttribute(attr);
			if (value) {
				parts.unshift(`[${attr}="${CSS.escape(value)}"]`);
				return parts.join(' > ');
			}
		}
		if (node.id && !/\d{3,}/.test(node.id)) {
			parts.unshift(`#${CSS.escape(node.id)}`);
			return parts.join(' > ');
		}
		let part = node.localName;
		const classes = [...node.classList].filter((c) => !SCOPED_CLASS.test(c)).slice(0, 2);
		if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('');
		const current = node;
		const siblings = current.parentElement
			? [...current.parentElement.children].filter((s) => s.localName === current.localName)
			: [];
		if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
		parts.unshift(part);
		if (parts.length >= 6) break;
	}
	return parts.join(' > ').slice(0, 800);
}

const squash = (text: string, max: number) => {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export function describeElement(el: Element): Target {
	const attrs: Record<string, string> = {};
	for (const a of [...el.attributes].slice(0, 30)) {
		if ((a.name.startsWith('data-') || KEPT_ATTRS.includes(a.name)) && a.name.length <= 80)
			attrs[a.name] = a.value.slice(0, 200);
	}
	const r = el.getBoundingClientRect();
	const secret = el.matches(SECRET_INPUT) || el.querySelector(SECRET_INPUT) !== null;
	const target: Target = {
		selector: selectorOf(el),
		tag: el.localName.slice(0, 80),
		// biome-ignore lint/performance/useDomNodeTextContent: innerText leaves out hidden text
		text: squash((el as HTMLElement).innerText ?? el.textContent ?? '', 200),
		html: secret ? '' : squash(el.outerHTML, 1000),
		attrs,
		rect: {
			x: Math.round(r.x),
			y: Math.round(r.y),
			width: Math.round(r.width),
			height: Math.round(r.height),
		},
	};
	const source = sourceOf(el);
	if (source) target.source = source;
	return target;
}

export const labelOf = (target: Target) =>
	target.text ? `<${target.tag}> ${target.text.slice(0, 40)}` : `<${target.tag}>`;
