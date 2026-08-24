# smartdisk-js

The official TypeScript SDK for [SmartDisk](https://smartdisk.pixilab.ai) — a memory
engine. You give it conversations and documents; it organises them into a searchable
**disk** and hands back grounded context with citations to the source.

Pure TypeScript, no runtime dependencies. Node 18+ (native `fetch`), ESM and CJS,
types included.

## Install

```bash
npm install @fy-/smartdisk
```

Or from source:

```bash
git clone https://github.com/PixiLab-ai/smartdisk-js.git
cd smartdisk-js && npm install && npm run build
```

You need an API key from the [API keys](https://smartdisk.pixilab.ai/keys) page. It
is shown once — store it like a password.

## Three calls

Import something, retrieve context, ask a question.

```ts
import { SmartDisk } from "@fy-/smartdisk";

const client = new SmartDisk({ apiKey: process.env.SMARTDISK_API_KEY });
const disk = await client.disks.create({ name: "support-bot", slug: "support-bot" });

// 1. import — a conversation thread, or a document
await client.imports.chat(disk, {
  name: "ticket-4417",
  messages: [
    { role: "user", content: "I'm on the annual plan and I only use the EU region." },
    { role: "assistant", content: "Noted — I've switched your default region to eu-west." },
  ],
});

// 2. retrieve — packed, numbered passages, no model in the loop
const context = await client.retrieve(disk, "what does this customer prefer?");
console.log(context.block);          // "[1] ticket-4417 › …"
console.log(context.citations[0]);   // where [1] came from

// 3. ask — one grounded answer, written server-side, same citations
const { answer, citations } = await client.memory.ask(disk, "what does this customer prefer?");
console.log(answer);
```

Processing is asynchronous: imported content moves `queued → processing → processed`.
Poll it with `client.memory.contents(disk)` before expecting a fresh import to be
retrievable.

## Configuration

```ts
const client = new SmartDisk({
  apiKey: "sd_…",                  // or SMARTDISK_API_KEY
  baseUrl: "https://…/api",        // or SMARTDISK_BASE — for a self-hosted server
  timeoutMs: 60_000,               // per request; imports and answers raise it themselves
  retry: { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 8_000 },
  headers: { "X-Trace": "…" },
  fetch: myFetch,                  // injectable, for tests or a custom agent
});
```

Retries cover `429`, `500`, `502` and network failures, with exponential backoff and
jitter, honouring `Retry-After`. `503 not_migrated` is **not** retried — it means the
feature is not deployed on that server, which retrying cannot fix.

### Referring to a disk

Every method takes a **disk reference**: the `Disk` object you got back, its uuid, or
its slug. A slug is resolved once through the disk listing and cached for the life of
the client.

```ts
await client.retrieve(disk, "…");          // the object
await client.retrieve("9c1e…-…", "…");     // its uuid
await client.retrieve("support-bot", "…"); // its slug
```

Conversation import is the exception that needs no lookup at all: passing a **slug**
uses the by-slug route, which resolves or creates the disk in the same call — so a
sync script needs only a key and a slug.

## Retrieval, briefly

`retrieve` returns a ready-to-prompt `block` of numbered `[n]` passages plus the
`citations` behind each number, and it refuses to pad: if nothing clears the relevance
floor you get an empty block rather than the best few pieces of noise.

```ts
const ctx = await client.retrieve(disk, "when did we move the launch, and why?", {
  path: "/research",          // scope to a folder subtree
  tags: ["launch"],           // narrow every layer by tag
  categories: ["schedule"],   // narrow the fact layer by category
  since: "2026-01-01T00:00:00Z",
  expand: true,               // HyDE + decomposition for vague, multi-part questions
  explain: true,              // per-citation scoring trace; ranking is unchanged
});
```

Two things worth wiring up early:

- **`stable`** rides on every response — the disk's standing profile and memory index
  as one block, with a `hash` that only changes when the body does. Pin it at the end
  of your system prompt and re-inject only on a new hash.
- **Not repeating yourself.** Collect each citation's `object_uuid` and pass them back
  as `exclude` next turn, or let the server carry it with `session_id` + `dedup_turns`.

## Errors

Every failure is a `SmartDiskError` subclass carrying the server's machine-readable
`code`, so you branch on the code rather than on prose.

```ts
import { SmartDiskNotFoundError, SmartDiskTooLargeError } from "@fy-/smartdisk";

try {
  await client.tools.export(disk);
} catch (error) {
  if (error instanceof SmartDiskTooLargeError) {
    console.log(`${error.factsTotal} facts, ceiling ${error.maxFacts} — narrow with path`);
  } else if (error instanceof SmartDiskNotFoundError) {
    console.log(error.code); // "disk_not_found"
  }
}
```

| Class | HTTP | Typical codes |
|---|---|---|
| `SmartDiskUsageError` | — | the SDK was called wrong |
| `SmartDiskConnectionError` | — | the request never reached the server |
| `SmartDiskTimeoutError` | — | the timeout expired |
| `SmartDiskBadRequestError` | 400 | `invalid_json`, `empty_text`, `bad_pattern`, `unsupported_format` |
| `SmartDiskAuthenticationError` | 401 | `invalid_api_key`, `unauthorized` |
| `SmartDiskPermissionError` | 403 | `smartdisk_access_required`, `session_required`, `forbidden` |
| `SmartDiskNotFoundError` | 404 | `disk_not_found`, `content_not_found`, `run_not_found` |
| `SmartDiskTooLargeError` | 413 | `too_large` (carries `factsTotal`/`maxFacts`, `edgesTotal`/`maxEdges`) |
| `SmartDiskUnprocessableError` | 422 | `blocked`, `no_content`, `no_transcript`, `unavailable` |
| `SmartDiskRateLimitError` | 429 | retried automatically |
| `SmartDiskServerError` | 500 | `ingest_failed`, `chat_failed` |
| `SmartDiskUpstreamError` | 502 | `ocr_failed`, `extract_failed`, `remember_failed` |
| `SmartDiskUnavailableError` | 503 | `not_migrated` — not an outage |

## The full surface

Every method maps 1:1 to one documented route.

### `client.disks`

| Method | Route | What it does |
|---|---|---|
| `create({ name, slug?, description? })` | `POST /sd/disks` | Create a disk. Idempotent on `slug`. |
| `list()` | `GET /sd/disks` | Your disks, with counts and stored tokens. |
| `find(slug)` | `GET /sd/disks` | The disk a slug names, or `null`. |
| `resolve(diskRef)` | `GET /sd/disks` | Any reference → a uuid. Cached. |
| `delete(diskRef)` | `DELETE /sd/disks/:uuid` | The disk and everything under it. |

### `client.imports`

| Method | Route | What it does |
|---|---|---|
| `chat(slug, params)` | `POST /sd/import/chatml` | Import a conversation, resolving or creating the disk by slug. |
| `chat(diskRef, params)` | `POST /sd/disks/:uuid/import/chatml` | The same, into a known disk. |
| `document(diskRef, params)` | `POST /sd/disks/:uuid/import/doc` | Markdown, text, markup, PDF/slides/spreadsheets, or a scanned image. |
| `url(diskRef, params)` | `POST /sd/disks/:uuid/import/url` | Fetch a page, or a video's transcript. |
| `cursor(diskRef)` | `GET /sd/disks/:uuid/import/last` | Where an incremental sync left off. |
| `retry(diskRef, contentUuid)` | `POST /sd/disks/:uuid/contents/:cuuid/retry` | Re-queue a failed source. |

### `client` (top level)

| Method | Route | What it does |
|---|---|---|
| `retrieve(diskRef, query, opts?)` | `POST /sd/disks/:uuid/retrieve` | Packed passages + citations. No model in the loop. |
| `ocr({ image_b64, format? })` | `POST /sd/ocr` | Read an image's text without importing it. |

### `client.memory`

| Method | Route | What it does |
|---|---|---|
| `ask(diskRef, query, opts?)` | `POST /sd/disks/:uuid/chat` | One grounded, cited answer. |
| `facts(diskRef)` | `GET /sd/disks/:uuid/memory` | Enduring facts, the latest summary, the tag catalogue. |
| `groups(diskRef)` | `GET /sd/disks/:uuid/groups` | `(subject, predicate)` groups: what is true now, and what it replaced. |
| `groupList(diskRef)` | `GET /sd/disks/:uuid/groups` | Just the groups array. |
| `subjects(diskRef, opts?)` | `GET /sd/disks/:uuid/subjects` | The knowledge graph as nodes and edges. |
| `profile(diskRef)` | `GET /sd/disks/:uuid/profile` | The standing profile and the memory index. |
| `regenerateProfile(diskRef)` | `POST /sd/disks/:uuid/profile/regen` | Force a fresh synthesis now. |
| `tags(diskRef, opts?)` | `GET /sd/disks/:uuid/tags` | The tag vocabulary with usage counts. |
| `ecosystem(diskRef, opts?)` | `GET /sd/disks/:uuid/ecosystem` | Sources → tags → facts, the mind map. |
| `graphQuery(diskRef, q, opts?)` | `GET /sd/disks/:uuid/graph-query` | Shortest path, neighbours, or an edge filter. |
| `contents(diskRef)` | `GET /sd/disks/:uuid/contents` | Every source with its processing state. |
| `contentsEnvelope(diskRef)` | `GET /sd/disks/:uuid/contents` | The same, keeping the `consolidating` flag. |
| `deleteContent(diskRef, cuuid)` | `DELETE /sd/disks/:uuid/contents/:cuuid` | Remove one source. |
| `moveContent(diskRef, cuuid, path)` | `POST /sd/disks/:uuid/contents/:cuuid/move` | Move it to another folder. |
| `folders(diskRef)` | `GET /sd/disks/:uuid/folders` | Folders with per-folder counts. |
| `createFolder(diskRef, path)` | `POST /sd/disks/:uuid/folders` | Create a folder; ancestors follow. |
| `deleteFolder(diskRef, path)` | `DELETE /sd/disks/:uuid/folders` | Delete an empty folder. |
| `aliases(diskRef)` / `setAliases(...)` | `GET`/`PUT /sd/disks/:uuid/aliases` | The disk-level `{ variant: canonical }` map. |
| `contentAliases(...)` / `setContentAliases(...)` | `GET`/`PUT /sd/disks/:uuid/contents/:cuuid/aliases` | The same, for one conversation. |
| `remember(diskRef, params)` | `POST /sd/disks/:uuid/remember` | Assert one fact directly, bypassing extraction. |
| `forget(diskRef, factUuid)` | `POST /sd/disks/:uuid/forget` | Retire a fact. A bitemporal close, not a delete. |
| `feedback(diskRef, factUuids, score)` | `POST /sd/disks/:uuid/feedback` | Rate whether facts helped; nothing is deleted. |
| `reprioritize(diskRef, factUuid, priority)` | `POST /sd/disks/:uuid/reprioritize` | Re-rank one fact, 1 to 100. |

### `client.tools` — the read-only agent tools

For when you already know what you want, and phrasing it as a search would only hope
the ranker agrees.

| Method | Route | What it does |
|---|---|---|
| `read(diskRef, cuuid, opts?)` | `GET /sd/disks/:uuid/contents/:cuuid` | One source's actual body, paged. |
| `grep(diskRef, pattern, opts?)` | `GET /sd/disks/:uuid/grep` | RE2 regex over the stored text. |
| `export(diskRef, opts?)` | `GET /sd/disks/:uuid/export` | The current fact graph as parsed JSON. |
| `exportRaw(diskRef, opts?)` | `GET /sd/disks/:uuid/export` | The same as `json`, `jsonld`, `turtle` or `csv` bytes. |
| `hubs(diskRef, opts?)` | `GET /sd/disks/:uuid/hubs` | Entity centrality: weighted degree and PageRank. |
| `lint(diskRef, opts?)` | `GET /sd/disks/:uuid/lint` | A read-only audit of the derived memory. |
| `extractPreview(diskRef, params)` | `POST /sd/disks/:uuid/extract-preview` | What *would* be remembered. Stores nothing. |
| `consolidationRuns(diskRef, opts?)` | `GET /sd/disks/:uuid/consolidation/runs` | The fold audit trail, newest first. |
| `consolidationRun(diskRef, run, opts?)` | `GET /sd/disks/:uuid/consolidation/runs/:run` | One run's full memory diff, and its undo plan. |

## Development

```bash
npm install
npm run typecheck
npm test          # 125 offline tests; a mocked fetch, no network
npm run build     # ESM + CJS + .d.ts, via tsup
```

The test suite never opens a socket. Every test asserts the request the SDK *would*
have sent — method, path, query, body — and the error class a given response maps to.

## Docs

The API reference lives at [smartdisk.pixilab.ai/docs](https://smartdisk.pixilab.ai/docs):
[Overview](https://smartdisk.pixilab.ai/docs/overview) ·
[Import](https://smartdisk.pixilab.ai/docs/import) ·
[Retrieval](https://smartdisk.pixilab.ai/docs/retrieval) ·
[Memory](https://smartdisk.pixilab.ai/docs/memory) ·
[Agent tools](https://smartdisk.pixilab.ai/docs/tools) ·
[Errors](https://smartdisk.pixilab.ai/docs/errors) ·
[MCP](https://smartdisk.pixilab.ai/docs/mcp).

To wire a disk into an LLM agent instead of writing code, there is an official MCP
server: [smartdisk-mcp](https://github.com/PixiLab-ai/smartdisk-mcp).

## License

MIT
