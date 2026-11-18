import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function sync(path, update) {
	const file = new URL(path, import.meta.url);
	let current = '';
	try {
		current = readFileSync(file, 'utf8');
	} catch {}
	const next = update(current);
	if (current !== next) writeFileSync(file, next);
}

sync('../src/version.ts', () => `export const VERSION = '${version}';\n`);
sync('../README.md', (readme) =>
	readme.replace(/(@dorsk\/hmm@)[^/\s]+(\/dist\/standalone\/)/g, `$1${version}$2`),
);
