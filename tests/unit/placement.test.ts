import { expect, test } from '@playwright/test';
import {
	fitSpot,
	type Launcher,
	moveTo,
	nudge,
	type Resolved,
	resolveLauncher,
	snapSpot,
	spotBox,
	spotOf,
} from '../../src/launcher.ts';
import { loadSpot, parseSpot, saveSpot, spotKey } from '../../src/placement-store.ts';

const viewport = { width: 1000, height: 800 };
const tab = { width: 100, height: 40 };
const resolve = (launcher: Launcher): Resolved => {
	const resolved = resolveLauncher(launcher);
	if (!resolved) throw new Error('no launcher');
	return resolved;
};
const memory = (): Storage => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	} as Storage;
};

test('launchers are movable unless the app locks them', () => {
	expect(resolveLauncher(true)).toMatchObject({ movable: true });
	expect(resolve({ form: 'edge', side: 'right' })).toMatchObject({ movable: true });
	expect(resolve({ form: 'corner', corner: 'top-left', movable: false })).toMatchObject({
		movable: false,
	});
	expect(resolve({ form: 'floating', storageKey: 'shop' })).toMatchObject({ storageKey: 'shop' });
});

test('an edge tab snaps to the nearest edge, centred on the pointer along it', () => {
	expect(snapSpot('edge', 30, 300, viewport, tab)).toEqual({
		form: 'edge',
		side: 'left',
		offset: 300,
	});
	expect(snapSpot('edge', 990, 500, viewport, tab)).toEqual({
		form: 'edge',
		side: 'right',
		offset: 500,
	});
	expect(snapSpot('edge', 600, 10, viewport, tab)).toEqual({
		form: 'edge',
		side: 'top',
		offset: 600,
	});
	expect(snapSpot('edge', 400, 790, viewport, tab)).toMatchObject({ side: 'bottom', offset: 400 });
});

test('an edge tab never snaps past the ends of its edge', () => {
	expect(snapSpot('edge', 5, 2, viewport, tab)).toMatchObject({ side: 'top', offset: 66 });
	expect(snapSpot('edge', 2, 795, viewport, tab)).toMatchObject({ side: 'left', offset: 764 });
});

test('a corner bubble snaps to the corner of the quadrant', () => {
	expect(snapSpot('corner', 100, 100, viewport, tab)).toEqual({
		form: 'corner',
		corner: 'top-left',
	});
	expect(snapSpot('corner', 900, 700, viewport, tab)).toMatchObject({ corner: 'bottom-right' });
	expect(snapSpot('corner', 501, 399, viewport, tab)).toMatchObject({ corner: 'top-right' });
});

test('a floating launcher snaps to one of its eight anchors', () => {
	const at = (x: number, y: number) => snapSpot('floating', x, y, viewport, tab);
	expect(at(50, 50)).toEqual({ form: 'floating', anchor: 'top-left' });
	expect(at(500, 50)).toMatchObject({ anchor: 'top' });
	expect(at(950, 400)).toMatchObject({ anchor: 'right' });
	expect(at(950, 750)).toMatchObject({ anchor: 'bottom-right' });
	expect(at(400, 400)).toMatchObject({ anchor: 'left' });
	expect(at(500, 500)).toMatchObject({ anchor: 'bottom' });
});

test('a moved edge tab takes its side and an align that matches its offset', () => {
	const base = resolve({ form: 'edge', side: 'right', align: 'center' });
	const moved = moveTo(base, { form: 'edge', side: 'left', offset: 100 }, viewport);
	expect(moved).toMatchObject({ form: 'edge', side: 'left', align: 'start', offset: 100 });
	expect(moveTo(base, { form: 'edge', side: 'top', offset: 900 }, viewport)).toMatchObject({
		align: 'end',
	});
	expect(moveTo(base, { form: 'corner', corner: 'top-left' }, viewport)).toBe(base);
	expect(moveTo(base, null, viewport)).toBe(base);
});

test('spotOf reads the tab centre along its edge', () => {
	const box = { left: 900, top: 380, right: 1000, bottom: 420 };
	expect(spotOf(resolve({ form: 'edge', side: 'right' }), box)).toEqual({
		form: 'edge',
		side: 'right',
		offset: 400,
	});
});

test('arrow keys walk an edge tab along its edge, across, and round the corner', () => {
	const right = { form: 'edge', side: 'right', offset: 400 } as const;
	expect(nudge(right, 'ArrowUp', viewport, tab)).toMatchObject({ side: 'right', offset: 320 });
	expect(nudge(right, 'ArrowRight', viewport, tab)).toEqual(right);
	expect(nudge(right, 'ArrowLeft', viewport, tab)).toMatchObject({ side: 'left', offset: 400 });
	const top = { form: 'edge', side: 'right', offset: 36 } as const;
	expect(nudge(top, 'ArrowUp', viewport, tab)).toMatchObject({ side: 'top', offset: 934 });
	expect(nudge({ form: 'corner', corner: 'bottom-right' }, 'ArrowLeft', viewport, tab)).toEqual({
		form: 'corner',
		corner: 'bottom-left',
	});
	expect(nudge({ form: 'floating', anchor: 'left' }, 'ArrowRight', viewport, tab)).toEqual({
		form: 'floating',
		anchor: 'right',
	});
	expect(nudge({ form: 'floating', anchor: 'top' }, 'ArrowUp', viewport, tab)).toMatchObject({
		anchor: 'top',
	});
});

test('the preview box sits where the launcher will land', () => {
	expect(spotBox({ form: 'edge', side: 'left', offset: 300 }, tab, viewport)).toEqual({
		left: 0,
		top: 280,
		right: 100,
		bottom: 320,
	});
	expect(spotBox({ form: 'floating', anchor: 'bottom-right' }, tab, viewport)).toEqual({
		left: 884,
		top: 744,
		right: 984,
		bottom: 784,
	});
});

test('a stored spot survives a round trip', () => {
	const storage = memory();
	const key = spotKey(undefined, 'https://shop.example', 'shop');
	expect(key).toBe('hmm:launcher:https://shop.example:shop');
	expect(spotKey('mine', 'https://shop.example', 'shop')).toBe('mine');
	saveSpot(storage, key, { form: 'edge', side: 'left', offset: 250 });
	expect(loadSpot(storage, key)).toEqual({ form: 'edge', side: 'left', offset: 250 });
	saveSpot(storage, key, null);
	expect(storage.getItem(key)).toBeNull();
	expect(loadSpot(storage, key)).toBeNull();
	expect(loadSpot(null, key)).toBeNull();
});

test('an invalid stored value falls back to the app default', () => {
	const storage = memory();
	for (const bad of ['{', 'null', '"edge"', '{"form":"edge","side":"middle","offset":3}']) {
		storage.setItem('k', bad);
		expect(loadSpot(storage, 'k'), bad).toBeNull();
	}
	expect(parseSpot({ form: 'edge', side: 'left', offset: -4 })).toBeNull();
	expect(parseSpot({ form: 'edge', side: 'left', offset: Number.NaN })).toBeNull();
	expect(parseSpot({ form: 'floating', anchor: 'middle' })).toBeNull();
	expect(parseSpot({ form: 'sticker' })).toBeNull();
	const corner = resolve({ form: 'corner', corner: 'top-left' });
	expect(fitSpot({ form: 'edge', side: 'left', offset: 3 }, corner, viewport, tab)).toBeNull();
	const base = resolve({ form: 'corner', corner: 'top-left' });
	expect(moveTo(base, null, viewport)).toEqual(base);
});

test('a stored edge spot is clamped back onto a smaller viewport', () => {
	const edge = resolve({ form: 'edge', side: 'right' });
	const phone = { width: 390, height: 600 };
	expect(fitSpot({ form: 'edge', side: 'right', offset: 760 }, edge, phone, tab)).toEqual({
		form: 'edge',
		side: 'right',
		offset: 564,
	});
	expect(fitSpot({ form: 'edge', side: 'right', offset: 760 }, edge, viewport, tab)).toMatchObject({
		offset: 760,
	});
});
