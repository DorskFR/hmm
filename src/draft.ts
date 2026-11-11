import { type Attachment, CATEGORIES, type Category, type Item } from './envelope.ts';

export type Draft = {
	category: Category;
	comment: string;
	items: Item[];
	attachments: Attachment[];
};

export const emptyDraft = (): Draft => ({
	category: 'idea',
	comment: '',
	items: [],
	attachments: [],
});

export const isEmpty = (draft: Draft) => !draft.comment.trim() && draft.items.length === 0;

export function loadDraft(storage: Storage | null, key: string): Draft {
	try {
		const parsed = JSON.parse(storage?.getItem(key) ?? 'null') as Partial<Draft> | null;
		if (
			parsed &&
			CATEGORIES.includes(parsed.category as Category) &&
			typeof parsed.comment === 'string' &&
			Array.isArray(parsed.items) &&
			Array.isArray(parsed.attachments)
		)
			return parsed as Draft;
	} catch {}
	return emptyDraft();
}

/** Best effort: a draft too large for the storage quota stays in memory only. */
export function saveDraft(storage: Storage | null, key: string, draft: Draft) {
	try {
		if (isEmpty(draft)) storage?.removeItem(key);
		else storage?.setItem(key, JSON.stringify(draft));
	} catch {
		try {
			storage?.removeItem(key);
		} catch {}
	}
}
