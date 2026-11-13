export type Look = 'icon' | 'pill' | 'button';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type Anchor = Corner | 'top' | 'bottom' | 'left' | 'right';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

export type Launcher =
	| { form: 'floating'; anchor?: Anchor; look?: Look }
	| { form: 'edge'; side: Side; align?: Align; look?: Look }
	| { form: 'corner'; corner: Corner };

export type Resolved =
	| { form: 'floating'; anchor: Anchor; look: Look }
	| { form: 'edge'; side: Side; align: Align; look: Look }
	| { form: 'corner'; corner: Corner; look: Look };

export const ANCHORS: readonly Anchor[] = [
	'top-left',
	'top',
	'top-right',
	'left',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right',
];
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const ALIGNS: readonly Align[] = ['start', 'center', 'end'];
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function resolveLauncher(
	launcher: boolean | Launcher | undefined,
	position?: 'bottom-right' | 'bottom-left',
): Resolved | null {
	if (launcher === false) return null;
	if (launcher === undefined || launcher === true)
		return { form: 'floating', anchor: position ?? 'bottom-right', look: 'pill' };
	switch (launcher.form) {
		case 'floating':
			return {
				form: 'floating',
				anchor: pick(ANCHORS, launcher.anchor, 'bottom-right'),
				look: pick(LOOKS, launcher.look, 'pill'),
			};
		case 'edge':
			return {
				form: 'edge',
				side: pick(SIDES, launcher.side, 'right'),
				align: pick(ALIGNS, launcher.align, 'center'),
				look: pick(LOOKS, launcher.look, 'pill'),
			};
		case 'corner':
			return {
				form: 'corner',
				corner: pick(CORNERS, launcher.corner, 'bottom-right'),
				look: 'pill',
			};
		default:
			throw new Error("hmm: launcher.form must be 'floating', 'edge' or 'corner'");
	}
}

const LOOKS: readonly Look[] = ['icon', 'pill', 'button'];
const pick = <T extends string>(allowed: readonly T[], value: T | undefined, fallback: T): T => {
	if (value === undefined) return fallback;
	if (!allowed.includes(value))
		throw new Error(`hmm: "${value}" is not one of ${allowed.join(', ')}`);
	return value;
};

export type Box = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type Placement =
	| { mode: 'cover' | 'beside' | 'stack'; from: Box; h: Align; v: Align; flip?: 'before' | 'after' }
	| { mode: 'corner'; corner: Corner };

export function placementFor(launcher: Resolved, from: Box): Placement {
	if (launcher.form === 'floating') {
		const [v, h] = split(launcher.anchor);
		return { mode: 'cover', from, h, v };
	}
	if (launcher.form === 'corner') {
		const [v, h] = split(launcher.corner);
		return { mode: 'stack', from, h, v, flip: v === 'start' ? 'after' : 'before' };
	}
	const { side, align } = launcher;
	if (side === 'left' || side === 'right')
		return {
			mode: 'beside',
			from,
			h: 'center',
			v: align,
			flip: side === 'left' ? 'after' : 'before',
		};
	return { mode: 'stack', from, h: align, v: 'center', flip: side === 'top' ? 'after' : 'before' };
}

function split(anchor: Anchor): [Align, Align] {
	const v: Align = anchor.startsWith('top')
		? 'start'
		: anchor.startsWith('bottom')
			? 'end'
			: 'center';
	const h: Align = anchor.endsWith('left') ? 'start' : anchor.endsWith('right') ? 'end' : 'center';
	return [v, h];
}

const along = (align: Align, start: number, end: number, size: number) =>
	align === 'start' ? start : align === 'end' ? end - size : (start + end) / 2 - size / 2;

const within = (value: number, size: number, room: number, margin: number) =>
	Math.max(margin, Math.min(room - size - margin, value));

export function panelOrigin(
	placement: Placement,
	panel: Size,
	viewport: Size,
	margin: number,
	gap: number,
): { left: number; top: number } {
	if (placement.mode === 'corner') {
		const [v, h] = split(placement.corner);
		return {
			left: h === 'start' ? margin : viewport.width - panel.width - margin,
			top: v === 'start' ? margin : viewport.height - panel.height - margin,
		};
	}
	const { from, h, v, mode, flip } = placement;
	let left = along(h, from.left, from.right, panel.width);
	let top = along(v, from.top, from.bottom, panel.height);
	if (mode === 'beside') left = flip === 'after' ? from.right + gap : from.left - gap - panel.width;
	if (mode === 'stack') top = flip === 'after' ? from.bottom + gap : from.top - gap - panel.height;
	return {
		left: within(left, panel.width, viewport.width, margin),
		top: within(top, panel.height, viewport.height, margin),
	};
}
