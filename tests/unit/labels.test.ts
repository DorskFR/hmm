import { expect, test } from '@playwright/test';
import { LABELS, LABELS_FR } from '../../src/labels.ts';

test('the French labels cover exactly the English keys, each with text', () => {
	expect(Object.keys(LABELS_FR).sort()).toEqual(Object.keys(LABELS).sort());
	for (const [key, value] of Object.entries(LABELS_FR)) expect(value.trim(), key).not.toBe('');
});
