import { expect, test } from '@playwright/test';
import {
	ALIGNS,
	ANCHORS,
	CORNERS,
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
