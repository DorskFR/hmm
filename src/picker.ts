/** The page element under a point, ignoring the widget itself. */
export const elementAt = (doc: Document, host: Element, x: number, y: number) =>
	doc
		.elementsFromPoint(x, y)
		.find(
			(el) => el !== host && !host.contains(el) && el !== doc.documentElement && el !== doc.body,
		) ?? null;
