const isModal = (dialog: Element) => {
	try {
		return dialog.matches(':modal');
	} catch {
		return false;
	}
};

export function stackModals<T>(stack: readonly T[], open: readonly T[]): T[] {
	const kept = stack.filter((item) => open.includes(item));
	return [...kept, ...open.filter((item) => !kept.includes(item))];
}

export function followModals(host: HTMLElement): () => void {
	const home = document.createComment('hmm');
	host.before(home);
	let stack: Element[] = [];

	const sync = () => {
		const open = [...document.querySelectorAll('dialog')].filter(isModal);
		stack = stackModals(stack, open);
		const top = stack.at(-1);
		const into = top && !top.contains(home) ? top : null;
		if (into ? host.parentNode === into : host.parentNode === home.parentNode) return;
		if (!home.isConnected) return;
		const active = document.activeElement;
		const focused = active instanceof HTMLElement && host.contains(active) ? active : null;
		if (into) into.append(host);
		else home.after(host);
		focused?.focus({ preventScroll: true });
	};

	const observer = new MutationObserver(sync);
	observer.observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['open'],
	});
	sync();
	return () => {
		observer.disconnect();
		if (host.isConnected && home.isConnected && host.parentNode !== home.parentNode)
			home.after(host);
		home.remove();
	};
}
