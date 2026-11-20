import { expect, test } from '@playwright/test';
import {
	ALIGNS,
	ANCHORS,
	approach,
	CORNERS,
	distance,
	dragPull,
	inward,
	type Launcher,
	panelOrigin,
	placementFor,
	resolveLauncher,
	SIDES,
} from '../../src/launcher.ts';

const resolve = (launcher: Launcher) => {
	const resolved = resolveLauncher(launcher);
	if (!resolved) throw new Error('no launcher');
	return resolved;
};
const viewport = { width: 1000, height: 800 };
const panel = { width: 300, height: 400 };
const box = (left: number, top: number, width: number, height: number) => ({
	left,
	top,
	right: left + width,
	bottom: top + height,
});
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
	a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('the 0.1 options keep their meaning', () => {
	expect(resolveLauncher(undefined)).toEqual({
		form: 'floating',
		anchor: 'bottom-right',
		look: 'pill',
	});
	expect(resolveLauncher(true, 'bottom-left')).toMatchObject({ anchor: 'bottom-left' });
	expect(resolveLauncher(false)).toBeNull();
});

test('launcher options get defaults and reject unknown values', () => {
	expect(resolveLauncher({ form: 'edge', side: 'left' })).toEqual({
		form: 'edge',
		side: 'left',
		align: 'center',
		look: 'pill',
	});
	expect(resolveLauncher({ form: 'corner', corner: 'top-left' })).toMatchObject({ look: 'pill' });
	expect(() => resolveLauncher({ form: 'edge', side: 'middle' } as unknown as Launcher)).toThrow(
		'middle',
	);
	expect(() => resolveLauncher({ form: 'sticker' } as unknown as Launcher)).toThrow('form');
});

test('a floating panel takes the place of its launcher', () => {
	const from = box(880, 740, 100, 40);
	const spot = panelOrigin(
		placementFor(resolve({ form: 'floating', anchor: 'bottom-right' }), from),
		panel,
		viewport,
		16,
		8,
	);
	expect(spot).toEqual({ left: 680, top: 380 });
});

test('an edge or corner panel sits next to its launcher, inside the viewport', () => {
	const tabs = {
		top: (a: number) => box(a, -12, 120, 52),
		bottom: (a: number) => box(a, 760, 120, 52),
		left: (a: number) => box(-12, a, 120, 40),
		right: (a: number) => box(892, a, 120, 40),
	};
	const at = { start: 48, center: 400, end: 700 };
	const cases: [Launcher, ReturnType<typeof box>][] = [];
	for (const side of SIDES)
		for (const align of ALIGNS) cases.push([{ form: 'edge', side, align }, tabs[side](at[align])]);
	for (const corner of CORNERS) {
		const left = corner.endsWith('left') ? 0 : 870;
		const top = corner.startsWith('top') ? 0 : 736;
		cases.push([{ form: 'corner', corner }, box(left, top, 130, 64)]);
	}
	for (const [launcher, from] of cases) {
		const spot = panelOrigin(placementFor(resolve(launcher), from), panel, viewport, 16, 8);
		const placed = box(spot.left, spot.top, panel.width, panel.height);
		expect(placed.left, JSON.stringify(launcher)).toBeGreaterThanOrEqual(16);
		expect(placed.top, JSON.stringify(launcher)).toBeGreaterThanOrEqual(16);
		expect(placed.right, JSON.stringify(launcher)).toBeLessThanOrEqual(984);
		expect(placed.bottom, JSON.stringify(launcher)).toBeLessThanOrEqual(784);
		expect(overlaps(placed, from), JSON.stringify(launcher)).toBe(false);
	}
});

test('on a phone an edge panel that cannot sit beside its tab stacks above or below it', () => {
	const phone = { width: 390, height: 844 };
	const sheet = { width: 358, height: 385 };
	const at = { start: 48, center: 400, end: 752 };
	for (const side of ['left', 'right'] as const)
		for (const align of ALIGNS) {
			const from = box(side === 'left' ? -12 : 302, at[align], 100, 44);
			const spot = panelOrigin(
				placementFor(resolve({ form: 'edge', side, align }), from),
				sheet,
				phone,
				16,
				8,
			);
			const placed = box(spot.left, spot.top, sheet.width, sheet.height);
			expect(overlaps(placed, from), `${side} ${align}`).toBe(false);
			expect(placed.top).toBeGreaterThanOrEqual(0);
			expect(placed.bottom).toBeLessThanOrEqual(phone.height);
		}
});

test('a panel taller than the room above or below its tab is shortened to fit', () => {
	const phone = { width: 390, height: 844 };
	const tall = { width: 358, height: 560 };
	const from = box(-12, 400, 100, 44);
	const spot = panelOrigin(
		placementFor(resolve({ form: 'edge', side: 'left', align: 'center' }), from),
		tall,
		phone,
		16,
		8,
	);
	expect(spot.maxHeight).toBeDefined();
	const placed = box(spot.left, spot.top, tall.width, spot.maxHeight ?? tall.height);
	expect(overlaps(placed, from)).toBe(false);
	expect(placed.top).toBeGreaterThanOrEqual(16);
	expect(placed.bottom).toBeLessThanOrEqual(phone.height - 16);
});

test('on a short screen a top or bottom panel sits beside its tab', () => {
	const short = { width: 1000, height: 360 };
	for (const side of ['top', 'bottom'] as const)
		for (const [align, left] of [
			['start', 48],
			['end', 832],
		] as const) {
			const from = box(left, side === 'top' ? -12 : 320, 120, 52);
			const spot = panelOrigin(
				placementFor(resolve({ form: 'edge', side, align }), from),
				panel,
				short,
				16,
				8,
			);
			const placed = box(spot.left, spot.top, panel.width, panel.height);
			expect(overlaps(placed, from), `${side} ${align}`).toBe(false);
		}
});

test('every floating anchor keeps the panel inside the viewport', () => {
	for (const anchor of ANCHORS) {
		const spot = panelOrigin(
			placementFor(resolve({ form: 'floating', anchor }), box(450, 380, 100, 40)),
			panel,
			viewport,
			16,
			8,
		);
		expect(spot.left).toBeGreaterThanOrEqual(16);
		expect(spot.top + panel.height).toBeLessThanOrEqual(784);
	}
});

test('a panel opened without a launcher goes to the requested corner', () => {
	expect(panelOrigin({ mode: 'corner', corner: 'top-right' }, panel, viewport, 16, 8)).toEqual({
		left: 684,
		top: 16,
	});
});

test('tucked launchers slide toward the middle of the screen', () => {
	expect(inward(resolve({ form: 'edge', side: 'right' }))).toEqual({ x: -1, y: 0 });
	expect(inward(resolve({ form: 'edge', side: 'top' }))).toEqual({ x: 0, y: 1 });
	const d = inward(resolve({ form: 'corner', corner: 'bottom-left' }));
	expect(d.x).toBeCloseTo(Math.SQRT1_2);
	expect(d.y).toBeCloseTo(-Math.SQRT1_2);
});

test('approaching a launcher pulls it out up to half way', () => {
	const tab = box(900, 400, 100, 40);
	expect(distance(tab, 950, 420)).toBe(0);
	expect(distance(tab, 860, 420)).toBe(40);
	expect(distance(tab, 897, 397)).toBeCloseTo(Math.hypot(3, 3));
	expect(approach(0, 96)).toBe(0.5);
	expect(approach(48, 96)).toBe(0.25);
	expect(approach(96, 96)).toBe(0);
	expect(approach(200, 96)).toBe(0);
});

test('a swipe drags the tab along its slide and clamps', () => {
	const left = { x: -1, y: 0 };
	expect(dragPull(0, -50, 0, left, 100)).toBe(0.5);
	expect(dragPull(0, -50, 30, left, 100)).toBe(0.5);
	expect(dragPull(0, 40, 0, left, 100)).toBe(0);
	expect(dragPull(1, 30, 0, left, 100)).toBeCloseTo(0.7);
	expect(dragPull(0, -400, 0, left, 100)).toBe(1);
});
