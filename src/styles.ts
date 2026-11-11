export const STYLES = `
:host {
	all: initial;
	--bg: var(--hmm-bg, #ffffff);
	--fg: var(--hmm-fg, #1c1c1f);
	--muted: var(--hmm-muted, #6b6b76);
	--border: var(--hmm-border, #d9d9e0);
	--accent: var(--hmm-accent, #4f46e5);
	--accent-fg: var(--hmm-accent-fg, #ffffff);
	--danger: var(--hmm-danger, #c2261d);
	--radius: var(--hmm-radius, 10px);
	--font: var(--hmm-font, system-ui, -apple-system, "Segoe UI", sans-serif);
	--z: var(--hmm-z-index, 2147483000);
}
@media (prefers-color-scheme: dark) {
	:host {
		--bg: var(--hmm-bg, #1d1d22);
		--fg: var(--hmm-fg, #ececf1);
		--muted: var(--hmm-muted, #9a9aa6);
		--border: var(--hmm-border, #3a3a44);
		--accent: var(--hmm-accent, #8b85ff);
		--accent-fg: var(--hmm-accent-fg, #15151a);
		--danger: var(--hmm-danger, #ff7a70);
	}
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: 0.5; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.launcher, .panel, .hint, .pin {
	font: 14px/1.4 var(--font);
	color: var(--fg);
}
.launcher {
	position: fixed;
	bottom: 16px;
	z-index: var(--z);
	padding: 8px 14px;
	border: 1px solid var(--border);
	border-radius: 999px;
	background: var(--bg);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}
.launcher.right { right: 16px; }
.launcher.left { left: 16px; }

.panel {
	position: fixed;
	bottom: 16px;
	z-index: var(--z);
	display: flex;
	flex-direction: column;
	width: 360px;
	max-width: calc(100vw - 32px);
	max-height: min(640px, calc(100vh - 32px));
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--bg);
	box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}
.panel.right { right: 16px; }
.panel.left { left: 16px; }
.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px;
	border-bottom: 1px solid var(--border);
}
.head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.body { display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow-y: auto; }
.foot {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	padding: 10px 12px;
	border-top: 1px solid var(--border);
}

.btn {
	padding: 6px 12px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: transparent;
}
.btn.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }
.icon {
	width: 26px;
	height: 26px;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--muted);
	font-size: 18px;
	line-height: 1;
}
.icon:hover { color: var(--fg); }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
	padding: 3px 10px;
	border: 1px solid var(--border);
	border-radius: 999px;
	background: transparent;
	font-size: 13px;
}
.chip[aria-checked="true"] {
	border-color: var(--accent);
	background: var(--accent);
	color: var(--accent-fg);
}

textarea {
	width: 100%;
	min-height: 60px;
	padding: 8px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: transparent;
	resize: vertical;
}
textarea.main { min-height: 84px; }

.items { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.item { padding: 8px; border: 1px solid var(--border); border-radius: 8px; }
.item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.item-label {
	flex: 1;
	overflow: hidden;
	color: var(--muted);
	font-size: 13px;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.badge, .pin {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 20px;
	height: 20px;
	padding: 0 5px;
	border-radius: 999px;
	background: var(--accent);
	color: var(--accent-fg);
	font-size: 12px;
	font-weight: 600;
}
.thumb { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px; }
.thumb img, .review img {
	display: block;
	min-width: 0;
	max-width: 100%;
	max-height: 160px;
	border: 1px solid var(--border);
	border-radius: 6px;
}

.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.error { margin: 0; color: var(--danger); font-size: 13px; }
.note { margin: 0; color: var(--muted); font-size: 13px; }
.message { margin: 0; padding: 12px 0; }

.review dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; }
.review dt { color: var(--muted); font-size: 13px; }
.review dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.review pre {
	max-height: 200px;
	margin: 6px 0 0;
	padding: 8px;
	overflow: auto;
	border: 1px solid var(--border);
	border-radius: 6px;
	font: 12px/1.4 ui-monospace, monospace;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.review summary { cursor: pointer; color: var(--muted); font-size: 13px; }

.glass { position: fixed; inset: 0; z-index: var(--z); cursor: crosshair; }
.box {
	position: fixed;
	top: 0;
	left: 0;
	z-index: var(--z);
	border: 2px solid var(--accent);
	border-radius: 3px;
	background: color-mix(in srgb, var(--accent) 15%, transparent);
	pointer-events: none;
}
.hint {
	position: fixed;
	top: 16px;
	left: 50%;
	z-index: var(--z);
	padding: 8px 14px;
	transform: translateX(-50%);
	border: 1px solid var(--border);
	border-radius: 999px;
	background: var(--bg);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
	pointer-events: none;
}
.pin {
	position: fixed;
	top: 0;
	left: 0;
	z-index: calc(var(--z) - 1);
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	pointer-events: none;
}
`;
