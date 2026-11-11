import { init } from './index.ts';

export * from './index.ts';

const script = document.currentScript as HTMLScriptElement | null;
const projectKey = script?.dataset.projectKey;
const endpoint = script?.dataset.endpoint;

if (projectKey && endpoint) {
	const start = () =>
		init({
			projectKey,
			endpoint,
			position: script?.dataset.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
		});
	if (document.body) start();
	else document.addEventListener('DOMContentLoaded', start, { once: true });
}
