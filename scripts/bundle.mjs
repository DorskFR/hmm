import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import svelte from 'esbuild-svelte';

const shared = {
	bundle: true,
	format: 'iife',
	target: 'es2022',
	platform: 'browser',
	conditions: ['svelte', 'browser'],
	mainFields: ['svelte', 'browser', 'module', 'main'],
	legalComments: 'none',
	minify: true,
	logLevel: 'info',
	define: { 'import.meta.env.DEV': 'false' },
};

await build({
	...shared,
	entryPoints: ['demo/main.ts'],
	outdir: 'demo/build',
	loader: { '.woff2': 'file' },
	plugins: [svelte({ compilerOptions: { css: 'external' } })],
});

const tokens = await build({
	entryPoints: [createRequire(import.meta.url).resolve('@dorsk/tsumikit/styles/variables.css')],
	bundle: true,
	minify: true,
	write: false,
	logLevel: 'warning',
});

const scoped = `${tokens.outputFiles[0].text
	.replaceAll(':root', ':where([data-hmm])')
	.replace(
		/\[data-theme=([^\]]+)\]/g,
		':where([data-theme=$1]) [data-hmm]',
	)}${await readFile('standalone/scope.css', 'utf8')}`;
await mkdir('dist/standalone', { recursive: true });
await writeFile('dist/standalone/hmm.css', scoped);

const tokensModule = {
	name: 'hmm-tokens',
	setup(b) {
		b.onResolve({ filter: /^hmm:tokens$/ }, () => ({ path: 'tokens', namespace: 'hmm-tokens' }));
		b.onLoad({ filter: /.*/, namespace: 'hmm-tokens' }, () => ({
			contents: scoped,
			loader: 'text',
		}));
	},
};

await build({
	...shared,
	entryPoints: ['standalone/entry.ts'],
	outfile: 'dist/standalone/hmm.js',
	globalName: 'Hmm',
	plugins: [tokensModule, svelte({ compilerOptions: { css: 'injected' } })],
});
