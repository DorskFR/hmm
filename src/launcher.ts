export type Look = 'icon' | 'pill' | 'button';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type Anchor = Corner | 'top' | 'bottom' | 'left' | 'right';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

type Moving = {
	/** Users can drag the launcher to another spot, remembered in localStorage. Default `true`. */
	movable?: boolean;
	/** localStorage key for the user's spot. Defaults to one per origin and `projectKey`. */
	storageKey?: string;
};

export type Launcher = Moving &
	(
		| { form: 'floating'; anchor?: Anchor; look?: Look }
		| { form: 'edge'; side: Side; align?: Align; look?: Look }
		| { form: 'corner'; corner: Corner }
	);

export type Resolved = { movable: boolean; storageKey?: string } & (
	| { form: 'floating'; anchor: Anchor; look: Look }
	| { form: 'edge'; side: Side; align: Align; look: Look; offset?: number }
	| { form: 'corner'; corner: Corner; look: Look }
);

/** Where a user put the launcher. `offset` is the tab centre in px from the top or left end of its edge. */
export type Spot =
	| { form: 'floating'; anchor: Anchor }
	| { form: 'edge'; side: Side; offset: number }
	| { form: 'corner'; corner: Corner };

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
		return { form: 'floating', anchor: position ?? 'bottom-right', look: 'pill', movable: true };
	const moving = {
		movable: launcher.movable !== false,
		...(launcher.storageKey ? { storageKey: launcher.storageKey } : {}),
	};
	switch (launcher.form) {
		case 'floating':
			return {
				...moving,
				form: 'floating',
				anchor: pick(ANCHORS, launcher.anchor, 'bottom-right'),
				look: pick(LOOKS, launcher.look, 'pill'),
			};
		case 'edge':
			return {
				...moving,
				form: 'edge',
				side: pick(SIDES, launcher.side, 'right'),
				align: pick(ALIGNS, launcher.align, 'center'),
				look: pick(LOOKS, launcher.look, 'pill'),
			};
		case 'corner':
			return {
				...moving,
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
): { left: number; top: number; maxHeight?: number } {
	if (placement.mode === 'corner') {
		const [v, h] = split(placement.corner);
		return {
			left: h === 'start' ? margin : viewport.width - panel.width - margin,
			top: v === 'start' ? margin : viewport.height - panel.height - margin,
		};
	}
	const { from, h, v } = placement;
	let { mode, flip } = placement;
	const fits = (start: number, end: number, size: number, span: number) =>
		flip === 'after' ? end + gap + size <= span - margin : start - gap - size >= margin;
	const roomier = (start: number, end: number, span: number) =>
		start + end > span ? 'before' : 'after';
	if (mode === 'beside' && !fits(from.left, from.right, panel.width, viewport.width)) {
		mode = 'stack';
		flip = roomier(from.top, from.bottom, viewport.height);
	} else if (mode === 'stack' && !fits(from.top, from.bottom, panel.height, viewport.height)) {
		mode = 'beside';
		flip = roomier(from.left, from.right, viewport.width);
	}
	const room =
		mode === 'stack'
			? flip === 'after'
				? viewport.height - margin - from.bottom - gap
				: from.top - gap - margin
			: Number.POSITIVE_INFINITY;
	const height = Math.min(panel.height, Math.max(0, room));
	let left = along(h, from.left, from.right, panel.width);
	let top = along(v, from.top, from.bottom, height);
	if (mode === 'beside') left = flip === 'after' ? from.right + gap : from.left - gap - panel.width;
	if (mode === 'stack') top = flip === 'after' ? from.bottom + gap : from.top - gap - height;
	const origin = {
		left: within(left, panel.width, viewport.width, mode === 'beside' ? gap : margin),
		top: within(top, height, viewport.height, mode === 'stack' ? gap : margin),
	};
	return height < panel.height ? { ...origin, maxHeight: height } : origin;
}

export function inward(launcher: Resolved): { x: number; y: number } {
	if (launcher.form === 'floating') return { x: 0, y: 0 };
	if (launcher.form === 'edge') {
		const { side } = launcher;
		return {
			x: side === 'left' ? 1 : side === 'right' ? -1 : 0,
			y: side === 'top' ? 1 : side === 'bottom' ? -1 : 0,
		};
	}
	const [v, h] = split(launcher.corner);
	return { x: (h === 'start' ? 1 : -1) * Math.SQRT1_2, y: (v === 'start' ? 1 : -1) * Math.SQRT1_2 };
}

export function distance(box: Box, x: number, y: number): number {
	const dx = Math.max(box.left - x, 0, x - box.right);
	const dy = Math.max(box.top - y, 0, y - box.bottom);
	return Math.hypot(dx, dy);
}

export const approach = (gap: number, radius: number, most = 0.5) =>
	gap >= radius ? 0 : most * (1 - Math.max(0, gap) / radius);

export function dragPull(
	start: number,
	dx: number,
	dy: number,
	dir: { x: number; y: number },
	travel: number,
): number {
	const along = dx * dir.x + dy * dir.y;
	return Math.min(1, Math.max(0, start + along / Math.max(1, travel)));
}

export const EDGE_INSET = 16;
export const FLOAT_GAP = 16;

const third = (at: number, span: number): Align =>
	at < span / 3 ? 'start' : at > (span * 2) / 3 ? 'end' : 'center';

const anchorOf = (v: Align, h: Align): Anchor => {
	const row = v === 'start' ? 'top' : v === 'end' ? 'bottom' : '';
	const col = h === 'start' ? 'left' : h === 'end' ? 'right' : '';
	return (row && col ? `${row}-${col}` : row || col) as Anchor;
};

const nearestSide = (x: number, y: number, viewport: Size): Side => {
	const gaps: [Side, number][] = [
		['left', x],
		['right', viewport.width - x],
		['top', y],
		['bottom', viewport.height - y],
	];
	return gaps.reduce((best, next) => (next[1] < best[1] ? next : best))[0];
};

const vertical = (side: Side) => side === 'left' || side === 'right';

/** Keeps an edge tab of `size` fully on its edge. */
export function clampOffset(side: Side, offset: number, viewport: Size, size: Size): number {
	const span = vertical(side) ? viewport.height : viewport.width;
	const half = (vertical(side) ? size.height : size.width) / 2;
	const low = EDGE_INSET + half;
	const high = span - EDGE_INSET - half;
	return low > high ? span / 2 : Math.max(low, Math.min(high, offset));
}

/** The spot nearest to a pointer at (x, y), for a launcher of the given form. */
export function snapSpot(
	form: Resolved['form'],
	x: number,
	y: number,
	viewport: Size,
	size: Size,
): Spot {
	if (form === 'corner') {
		const v = y < viewport.height / 2 ? 'top' : 'bottom';
		const h = x < viewport.width / 2 ? 'left' : 'right';
		return { form, corner: `${v}-${h}` };
	}
	if (form === 'edge') {
		const side = nearestSide(x, y, viewport);
		return { form, side, offset: clampOffset(side, vertical(side) ? y : x, viewport, size) };
	}
	const v = third(y, viewport.height);
	const h = third(x, viewport.width);
	if (v !== 'center' || h !== 'center') return { form, anchor: anchorOf(v, h) };
	return { form, anchor: nearestSide(x, y, viewport) };
}

/** The spot a launcher currently sits at. */
export function spotOf(launcher: Resolved, box: Box): Spot {
	if (launcher.form === 'floating') return { form: 'floating', anchor: launcher.anchor };
	if (launcher.form === 'corner') return { form: 'corner', corner: launcher.corner };
	const { side } = launcher;
	const offset = vertical(side) ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2;
	return { form: 'edge', side, offset };
}

/** A stored spot brought back inside the viewport, or null when it does not fit this launcher. */
export function fitSpot(spot: Spot, launcher: Resolved, viewport: Size, size: Size): Spot | null {
	if (spot.form !== launcher.form) return null;
	if (spot.form !== 'edge') return spot;
	return { ...spot, offset: clampOffset(spot.side, spot.offset, viewport, size) };
}

/** The launcher moved to `spot`. */
export function moveTo(launcher: Resolved, spot: Spot | null, viewport: Size): Resolved {
	if (!spot || spot.form !== launcher.form) return launcher;
	if (launcher.form === 'floating' && spot.form === 'floating')
		return { ...launcher, anchor: spot.anchor };
	if (launcher.form === 'corner' && spot.form === 'corner')
		return { ...launcher, corner: spot.corner };
	if (launcher.form === 'edge' && spot.form === 'edge') {
		const span = vertical(spot.side) ? viewport.height : viewport.width;
		return { ...launcher, side: spot.side, offset: spot.offset, align: third(spot.offset, span) };
	}
	return launcher;
}

export type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
const STEP = 0.1;

/** The spot one arrow key press away. Edge tabs walk along their edge and turn at its ends. */
export function nudge(spot: Spot, key: Arrow, viewport: Size, size: Size): Spot {
	const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
	const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
	if (spot.form === 'corner') {
		const [v, h] = split(spot.corner);
		const row = dy < 0 ? 'top' : dy > 0 ? 'bottom' : v === 'start' ? 'top' : 'bottom';
		const col = dx < 0 ? 'left' : dx > 0 ? 'right' : h === 'start' ? 'left' : 'right';
		return { form: 'corner', corner: `${row}-${col}` };
	}
	if (spot.form === 'floating') {
		const [v, h] = split(spot.anchor);
		const order: Align[] = ['start', 'center', 'end'];
		const step = (align: Align, by: number) =>
			order[Math.max(0, Math.min(2, order.indexOf(align) + by))] as Align;
		let nv = step(v, dy);
		let nh = step(h, dx);
		if (nv === 'center' && nh === 'center') {
			nv = dy ? step(nv, dy) : nv;
			nh = dx ? step(nh, dx) : nh;
		}
		return { form: 'floating', anchor: anchorOf(nv, nh) };
	}
	const { side, offset } = spot;
	const alongBy = vertical(side) ? dy : dx;
	const across = vertical(side) ? dx : dy;
	const span = vertical(side) ? viewport.height : viewport.width;
	const fit = (s: Side, o: number): Spot => ({
		form: 'edge',
		side: s,
		offset: clampOffset(s, o, viewport, size),
	});
	if (across) {
		const opposite: Record<Side, Side> = {
			left: 'right',
			right: 'left',
			top: 'bottom',
			bottom: 'top',
		};
		const outward = (side === 'right' || side === 'bottom') === across > 0;
		return outward ? spot : fit(opposite[side], offset);
	}
	const next = clampOffset(side, offset + alongBy * span * STEP, viewport, size);
	if (Math.abs(next - offset) > 0.5) return { form: 'edge', side, offset: next };
	const turn: Side = vertical(side)
		? alongBy < 0
			? 'top'
			: 'bottom'
		: alongBy < 0
			? 'left'
			: 'right';
	return fit(turn, side === 'right' || side === 'bottom' ? Number.POSITIVE_INFINITY : 0);
}

/** The box a launcher of `size` takes at `spot`, for the drag preview. */
export function spotBox(spot: Spot, size: Size, viewport: Size): Box {
	const at = (left: number, top: number): Box => ({
		left,
		top,
		right: left + size.width,
		bottom: top + size.height,
	});
	if (spot.form === 'edge') {
		const { side, offset } = spot;
		if (side === 'left') return at(0, offset - size.height / 2);
		if (side === 'right') return at(viewport.width - size.width, offset - size.height / 2);
		if (side === 'top') return at(offset - size.width / 2, 0);
		return at(offset - size.width / 2, viewport.height - size.height);
	}
	const inset = spot.form === 'floating' ? FLOAT_GAP : 0;
	const [v, h] = split(spot.form === 'floating' ? spot.anchor : spot.corner);
	const place = (align: Align, span: number, extent: number) =>
		align === 'start' ? inset : align === 'end' ? span - extent - inset : (span - extent) / 2;
	return at(place(h, viewport.width, size.width), place(v, viewport.height, size.height));
}
