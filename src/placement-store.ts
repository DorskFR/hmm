import {
	ANCHORS,
	type Anchor,
	CORNERS,
	type Corner,
	SIDES,
	type Side,
	type Spot,
} from './launcher.ts';

export const spotKey = (storageKey: string | undefined, origin: string, projectKey: string) =>
	storageKey || `hmm:launcher:${origin}:${projectKey}`;

export function parseSpot(raw: unknown): Spot | null {
	if (!raw || typeof raw !== 'object') return null;
	const spot = raw as Record<string, unknown>;
	if (spot.form === 'floating' && ANCHORS.includes(spot.anchor as never))
		return { form: 'floating', anchor: spot.anchor as Anchor };
	if (spot.form === 'corner' && CORNERS.includes(spot.corner as never))
		return { form: 'corner', corner: spot.corner as Corner };
	if (
		spot.form === 'edge' &&
		SIDES.includes(spot.side as never) &&
		typeof spot.offset === 'number' &&
		Number.isFinite(spot.offset) &&
		spot.offset >= 0
	)
		return { form: 'edge', side: spot.side as Side, offset: spot.offset };
	return null;
}

export function loadSpot(storage: Storage | null, key: string): Spot | null {
	try {
		const raw = storage?.getItem(key);
		return raw ? parseSpot(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

export function saveSpot(storage: Storage | null, key: string, spot: Spot | null) {
	try {
		if (spot) storage?.setItem(key, JSON.stringify(spot));
		else storage?.removeItem(key);
	} catch {}
}
