import type { Corner } from './launcher.ts';

export type Instance = {
	show(at?: Corner): void;
	hide(): void;
	isOpen(): boolean;
};

let mounted = $state<Instance[]>([]);
const active = () => mounted.at(-1);

export function register(instance: Instance): () => void {
	mounted = [...mounted, instance];
	return () => {
		mounted = mounted.filter((i) => i !== instance);
	};
}

export const hmm = {
	open(at?: Corner) {
		const instance = active();
		if (!instance) console.warn('[hmm] open() called with no panel mounted');
		instance?.show(at);
	},
	close() {
		active()?.hide();
	},
	toggle(at?: Corner) {
		if (this.isOpen) this.close();
		else this.open(at);
	},
	get isOpen() {
		return active()?.isOpen() ?? false;
	},
	get mounted() {
		return mounted.length > 0;
	},
};
