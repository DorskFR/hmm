export type PickOptions = {
	doc: Document;
	root: ShadowRoot;
	host: Element;
	hint: string;
	onPick(el: Element): void;
	onCancel(): void;
};

export type PickSession = { stop(): void };

export function startPick({ doc, root, host, hint, onPick, onCancel }: PickOptions): PickSession {
	const glass = doc.createElement('div');
	glass.className = 'glass';
	const box = doc.createElement('div');
	box.className = 'box';
	box.hidden = true;
	const bar = doc.createElement('div');
	bar.className = 'hint';
	bar.setAttribute('role', 'status');
	bar.textContent = hint;
	root.append(glass, box, bar);

	const under = (x: number, y: number) =>
		doc
			.elementsFromPoint(x, y)
			.find(
				(el) => el !== host && !host.contains(el) && el !== doc.documentElement && el !== doc.body,
			) ?? null;

	const onMove = (e: MouseEvent) => {
		const el = under(e.clientX, e.clientY);
		box.hidden = !el;
		if (!el) return;
		const r = el.getBoundingClientRect();
		box.style.transform = `translate(${r.left}px, ${r.top}px)`;
		box.style.width = `${r.width}px`;
		box.style.height = `${r.height}px`;
	};
	const onClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const el = under(e.clientX, e.clientY);
		if (el) onPick(el);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		onCancel();
	};

	glass.addEventListener('mousemove', onMove);
	glass.addEventListener('click', onClick);
	doc.addEventListener('keydown', onKey, true);

	return {
		stop() {
			doc.removeEventListener('keydown', onKey, true);
			glass.remove();
			box.remove();
			bar.remove();
		},
	};
}
