import { type Attachment, type Item, validateEnvelope } from './envelope.ts';

export type Draft = {
	comment: string;
	items: Item[];
	attachments: Attachment[];
};

export const emptyDraft = (): Draft => ({
	comment: '',
	items: [],
	attachments: [],
});

export const isEmpty = (draft: Draft) => !draft.comment.trim() && draft.items.length === 0;

const wellFormed = (draft: Partial<Draft>) =>
	validateEnvelope({
		v: 1,
		id: 'draft',
		kind: 'feedback',
		project: 'draft',
		createdAt: '1970-01-01T00:00:00Z',
		client: { name: '', version: '' },
		context: {},
		comment: draft.comment,
		items: draft.items,
		attachments: draft.attachments,
	}).ok;

export function loadDraft(storage: Storage | null, key: string): Draft {
	try {
		const parsed = JSON.parse(storage?.getItem(key) ?? 'null') as Partial<Draft> | null;
		if (parsed && wellFormed(parsed)) {
			const { comment = '', items = [], attachments = [] } = parsed;
			return { comment, items, attachments };
		}
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
