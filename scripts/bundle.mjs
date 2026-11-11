import { build } from 'esbuild';

await build({
	bundle: true,
	format: 'iife',
	target: 'es2022',
	platform: 'browser',
	legalComments: 'none',
	minify: true,
	logLevel: 'info',
	entryPoints: ['src/auto.ts'],
	outfile: 'dist/hmm.iife.js',
	globalName: 'hmm',
	footer: { js: 'window.hmm = hmm;' },
});
