import { LIMITS } from './envelope.ts';

export type Shot = { data: string; width: number; height: number };

const MAX_SIDE = 1600;
const PREFIX = 'data:image/png;base64,';

const CLEAR = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)']);

function paintOf(win: Window, el: Element): string | null {
	const color = win.getComputedStyle(el).backgroundColor;
	return CLEAR.has(color) ? null : color;
}

/** The renderer paints `backgroundColor` on the captured node itself, so an element that has its own background must not get one. */
function backdropOf(win: Window, target: Element): { backgroundColor?: string } {
	if (paintOf(win, target)) return {};
	for (let node = target.parentElement; node; node = node.parentElement) {
		const color = paintOf(win, node);
		if (color) return { backgroundColor: color };
	}
	return { backgroundColor: '#ffffff' };
}

/**
 * Rasterises the DOM, so cross-origin images without CORS, video and tainted canvases come out
 * blank. `target` null captures the visible viewport.
 */
export async function capture(
	win: Window,
	target: Element | null,
	exclude: Element,
): Promise<Shot> {
	const { domToPng } = await import('modern-screenshot');
	const doc = win.document;
	const size = target
		? target.getBoundingClientRect()
		: { width: win.innerWidth, height: win.innerHeight };
	if (size.width < 1 || size.height < 1) throw new Error('nothing to capture');

	const base = {
		filter: (node: Node) => node !== exclude,
		...(target
			? backdropOf(win, target)
			: {
					backgroundColor: paintOf(win, doc.body) ?? '#ffffff',
					width: size.width,
					height: size.height,
					style: {
						overflow: 'hidden',
						transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`,
					},
				}),
	};

	return fit(size.width, size.height, (scale) =>
		domToPng(target ?? doc.documentElement, { ...base, scale }),
	);
}

/** Re-encodes an image the user picked as a PNG that fits the attachment limits. */
export async function fromFile(file: Blob): Promise<Shot> {
	const bitmap = await createImageBitmap(file);
	try {
		return await fit(bitmap.width, bitmap.height, async (scale) => {
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL('image/png');
		});
	} finally {
		bitmap.close();
	}
}

async function fit(
	width: number,
	height: number,
	render: (scale: number) => Promise<string>,
): Promise<Shot> {
	let scale = Math.min(1, MAX_SIDE / Math.max(width, height));
	for (let attempt = 0; attempt < 3; attempt++, scale /= 2) {
		const url = await render(scale);
		if (!url.startsWith(PREFIX)) break;
		const data = url.slice(PREFIX.length);
		if (data.length <= LIMITS.attachmentChars) {
			return {
				data,
				width: Math.max(1, Math.round(width * scale)),
				height: Math.max(1, Math.round(height * scale)),
			};
		}
	}
	throw new Error('the image is too large');
}
