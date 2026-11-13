import { mount, unmount } from 'svelte';
import { type Handle, type Options, transportOf } from './core.ts';
import Hmm from './Hmm.svelte';
import HmmTrigger from './HmmTrigger.svelte';

export { hmm } from './controller.svelte.ts';
export type { Handle, Options } from './core.ts';
export {
	type Attachment,
	CATEGORIES,
	type Category,
	type ElementItem,
	ENVELOPE_VERSION,
	type Envelope,
	type Item,
	KINDS,
	type Kind,
	LIMITS,
	type Page,
	type Rect,
	type ScreenshotItem,
	type Target,
	type Validation,
	validateEnvelope,
} from './envelope.ts';
export { LABELS, type Labels } from './labels.ts';
export {
	ALIGNS,
	type Align,
	ANCHORS,
	type Anchor,
	CORNERS,
	type Corner,
	type Launcher,
	type Look,
	SIDES,
	type Side,
} from './launcher.ts';
export { redactEnvelope, redactText, redactUrl } from './redact.ts';
export { httpTransport, SendError, type Transport } from './transport.ts';
export { VERSION } from './version.ts';
export { Hmm, HmmTrigger };

let current: Handle | null = null;

/** Mounts `Hmm` on the document body, for hosts without a Svelte tree. A second call replaces the first instance. */
export function init(options: Options): Handle {
	transportOf(options);
	if (!document.body) throw new Error('hmm: call init after the document body exists');
	current?.destroy();
	const component = mount(Hmm, { target: document.body, props: options });
	const handle: Handle = {
		open: () => component.show(),
		close: () => component.hide(),
		destroy() {
			void unmount(component);
			if (current === handle) current = null;
		},
		get isOpen() {
			return component.isOpen();
		},
	};
	current = handle;
	return handle;
}
