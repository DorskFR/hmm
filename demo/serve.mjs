import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvelope } from '../dist/envelope.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2]) || 4188;
const MAX_BODY = 32 * 1024 * 1024;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.woff2': 'font/woff2',
};
const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': 'content-type, x-hmm-key',
	'access-control-allow-methods': 'POST, OPTIONS',
};

let reports = [];
let failures = 0;

function json(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((done, fail) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				fail(new Error('too large'));
				req.destroy();
			} else chunks.push(chunk);
		});
		req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
		req.on('error', fail);
	});
}

async function receive(req, res) {
	if (failures > 0) {
		failures--;
		return json(res, 503, { error: 'unavailable' });
	}
	const key = req.headers['x-hmm-key'];
	if (!key) return json(res, 401, { error: 'missing x-hmm-key' });
	let data;
	try {
		data = JSON.parse(await readBody(req));
	} catch {
		return json(res, 400, { error: 'invalid body' });
	}
	const result = validateEnvelope(data);
	if (!result.ok) return json(res, 400, { error: 'invalid envelope', details: result.errors });
	if (result.envelope.project !== key) return json(res, 400, { error: 'project key mismatch' });
	reports.push(result.envelope);
	console.log(`report ${result.envelope.id}: ${result.envelope.items.length} item(s)`);
	return json(res, 202, { id: result.envelope.id });
}

function fileFor(pathname) {
	const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
	const file = join(root, clean === '/' || clean === '\\' ? 'index.html' : clean);
	return file.startsWith(root) ? file : null;
}

createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	if (url.pathname === '/v1/reports') {
		if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
		if (req.method === 'POST') return receive(req, res);
		return json(res, 405, { error: 'method not allowed' });
	}
	if (url.pathname === '/__reports') {
		if (req.method === 'DELETE') {
			reports = [];
			failures = 0;
		}
		return json(res, 200, reports);
	}
	if (url.pathname === '/__fail') {
		failures = Number(url.searchParams.get('n')) || 1;
		return json(res, 200, { failures });
	}
	const file = fileFor(url.pathname);
	const type = file ? MIME[extname(file)] : undefined;
	let ok = false;
	try {
		ok = Boolean(file && type && statSync(file).isFile());
	} catch {}
	if (!ok) {
		res.writeHead(404, { 'content-type': 'text/plain' });
		return res.end('not found');
	}
	res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
	createReadStream(file).pipe(res);
}).listen(port, () => console.log(`hmm demo on http://localhost:${port}/`));
