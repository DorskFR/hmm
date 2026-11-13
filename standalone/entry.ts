import tokens from 'hmm:tokens';
import { init as mountPanel, type Options } from '../src/index.ts';

export { hmm, LABELS, VERSION } from '../src/index.ts';

function injectTokens(): void {
	if (document.querySelector('style[data-hmm-tokens]')) return;
	const style = document.createElement('style');
	style.dataset.hmmTokens = '';
	style.textContent = tokens;
	document.head.prepend(style);
}

export function init(options: Options) {
	injectTokens();
	return mountPanel(options);
}
