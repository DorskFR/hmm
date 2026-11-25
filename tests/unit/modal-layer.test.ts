import { expect, test } from '@playwright/test';
import { stackModals } from '../../src/modal-layer.ts';

test('newly opened modals go on top, in the order they appear', () => {
	expect(stackModals([], ['a'])).toEqual(['a']);
	expect(stackModals(['b'], ['a', 'b'])).toEqual(['b', 'a']);
});

test('closed modals leave the stack and the rest keep their order', () => {
	expect(stackModals(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
	expect(stackModals(['a'], [])).toEqual([]);
});
