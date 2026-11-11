import { httpTransport } from './transport.ts';
import { type Hmm, mount, type Options } from './ui.ts';

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
export { redactEnvelope, redactText, redactUrl } from './redact.ts';
export { httpTransport, SendError, type Transport } from './transport.ts';
export type { Hmm, Options } from './ui.ts';
export { VERSION } from './version.ts';

let current: Hmm | null = null;

/** Mounts the widget. A second call replaces the first instance. */
export function init(options: Options): Hmm {
	if (!/^[A-Za-z0-9._-]{1,128}$/.test(options?.projectKey ?? ''))
		throw new Error(
			'hmm: projectKey must be 1 to 128 letters, digits, dots, dashes or underscores',
		);
	const transport =
		options.transport ??
		(options.endpoint ? httpTransport(options.endpoint, options.projectKey) : null);
	if (!transport) throw new Error('hmm: either endpoint or transport is required');
	if (!document.body) throw new Error('hmm: call init after the document body exists');
	current?.destroy();
	current = mount(options, transport);
	return current;
}
