import { build } from 'esbuild';
import svelte from 'esbuild-svelte';

await build({
	bundle: true,
	format: 'iife',
	target: 'es2022',
	platform: 'browser',
	conditions: ['svelte', 'browser'],
	mainFields: ['svelte', 'browser', 'module', 'main'],
	legalComments: 'none',
	minify: true,
	logLevel: 'info',
	entryPoints: ['demo/main.ts'],
	outdir: 'demo/build',
	loader: { '.woff2': 'file' },
	define: { 'import.meta.env.DEV': 'false' },
	plugins: [svelte({ compilerOptions: { css: 'external' } })],
});
