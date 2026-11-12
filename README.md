# @dorsk/hmm

A drop-in feedback widget for any web app. The user opens "Send feedback", selects elements on the
page, comments on them, adds screenshots, reviews exactly what will be sent, and sends it to an
endpoint you own.

It is plain TypeScript with no framework, renders inside a Shadow DOM so host styles and widget
styles cannot affect each other, and ships as an ES module and as a single script file.

![The widget open on a demo page, with a selected element and a screenshot](docs/widget.png)

## Install

```sh
npm install @dorsk/hmm
```

```ts
import { init } from '@dorsk/hmm';

const feedback = init({
	projectKey: 'my-app',
	endpoint: 'https://feedback.example.com',
	context: () => ({ appVersion: '1.4.2', route: currentRouteName() }),
});
```

Or with a script tag and no build step:

```html
<script
	src="https://unpkg.com/@dorsk/hmm/dist/hmm.iife.js"
	data-project-key="my-app"
	data-endpoint="https://feedback.example.com"
></script>
```

The script also exposes `window.hmm`, so `hmm.init({ ... })` works when you need more options than
the data attributes offer.

## Options

| Option | Type | Purpose |
|---|---|---|
| `projectKey` | `string` | Required. Public identifier of the project, sent with every report. Letters, digits, `.`, `_` and `-`. |
| `endpoint` | `string` | Base URL of the ingest server. Required unless `transport` is set. |
| `transport` | `(envelope) => Promise<void>` | Replaces the HTTP POST, for hosts that relay reports through their own backend. Throw an error with `retryable: false` to mark a permanent failure. |
| `context` | `() => object` | Extra data added to every report. May be async. |
| `beforeSend` | `(envelope) => envelope \| null` | Change a report, or drop it by returning `null`. Runs before the review, so the user sees the result. |
| `launcher` | `boolean` | `false` hides the floating button; call `open()` from your own UI. |
| `position` | `'bottom-right' \| 'bottom-left'` | Corner for the button and the panel. |
| `labels` | `Partial<Labels>` | Override any text. The defaults are exported as `LABELS`. |
| `onSent` | `(envelope) => void` | Called after a report is delivered. |

`init` returns `{ open(), close(), destroy(), isOpen }`. Calling `init` again replaces the previous
instance.

## Theming

The widget has no palette or font of its own. It takes them from the page it is on:

- font, text colour and `color-scheme` are inherited from `<body>`
- the panel background is the page background (the first opaque `background-color` from `<body>` up)
- the accent is the page's `accent-color` if one is set, otherwise the text colour
- borders and muted text are mixed from the text colour

It re-reads these when the panel opens and when `class`, `style` or `data-theme` change on `<html>`
or `<body>`, so a theme switch is followed.

Page CSS rules do not reach inside (the widget lives in a Shadow DOM). Four optional custom
properties on `[data-hmm]` or any ancestor override what was measured: `--hmm-bg`, `--hmm-accent`,
`--hmm-radius`, `--hmm-z-index`.

## What is sent

One JSON document, the envelope, described by
[`schema/envelope.v1.json`](schema/envelope.v1.json) and by the `Envelope` type.

```jsonc
{
	"v": 1,
	"id": "b6f0c9a2-…",
	"kind": "feedback",            // "error" and "alert" are reserved for non-widget clients
	"category": "idea",            // idea | problem | question | other
	"project": "my-app",
	"createdAt": "2026-11-12T08:00:00.000Z",
	"client": { "name": "@dorsk/hmm", "version": "0.1.0" },
	"page": { "url": "…", "title": "…", "viewport": { "width": 1280, "height": 800 }, "userAgent": "…", "language": "en" },
	"context": { "appVersion": "1.4.2" },
	"comment": "What about a dark mode?",
	"items": [
		{ "id": "…", "type": "element", "url": "…", "comment": "…", "target": { "selector": "#buy", "tag": "button", "text": "…", "html": "…", "attrs": {}, "rect": {} }, "attachment": "…" },
		{ "id": "…", "type": "screenshot", "url": "…", "comment": "", "attachment": "…" }
	],
	"attachments": [{ "id": "…", "mime": "image/png", "width": 1280, "height": 800, "data": "<base64>" }]
}
```

Limits: 20 items, 10 attachments, about 2 MB per image, 5,000 characters per comment, 16,000
characters of serialised context. They are exported as `LIMITS`.

## HTTP contract

```
POST <endpoint>/v1/reports
content-type: application/json
x-hmm-key: <projectKey>

<envelope>
```

- Any `2xx` answer counts as delivered.
- `408`, `429`, `5xx` and network errors are retried: the report is stored in `localStorage` and
  sent on the next page load or when the browser comes back online. At most five reports wait.
- Any other `4xx` is a permanent failure. The user sees an error and keeps the draft.
- The server must answer the CORS preflight and allow the `content-type` and `x-hmm-key` headers.
- No cookies or credentials are sent.

Servers can reuse the validator without pulling in any DOM code:

```ts
import { validateEnvelope } from '@dorsk/hmm/envelope';

const result = validateEnvelope(JSON.parse(body));
if (!result.ok) return reject(result.errors);
```

Treat every field as untrusted input. The validator checks structure and size only; it does not
make the text safe to render or to hand to an agent, and it does not decode the images.

## Privacy

- Nothing leaves the page until the user presses Send on the review screen, which lists every
  field and image, with the raw JSON one click away.
- Before the review, all text is scrubbed of JWTs, bearer tokens, common API key formats, private
  keys and `password=`-style pairs. URLs lose their credentials and secret-looking query
  parameters. `redactText`, `redactUrl` and `redactEnvelope` are exported.
- The HTML of an element is not recorded when it is, or contains, a password field.
- Screenshots cannot be scrubbed. They are shown in the review and each one can be removed.

## Limitations

- Screenshots are rendered from the DOM, not captured from the screen. Cross-origin images without
  CORS, `<video>`, and canvases tainted by cross-origin content come out blank.
- A strict Content Security Policy must allow `data:` in `img-src` for the thumbnails.
- Elements inside iframes or closed shadow roots cannot be selected.

## Development

```sh
npm install
npm run demo     # demo shop on http://localhost:4188 with an in-memory receiver
npm test         # unit tests and Chromium browser tests
npm run lint
npm run check
```

MIT licensed.
