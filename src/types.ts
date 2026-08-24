/**
 * Wire types, named after the API's own vocabulary. Field names match the JSON
 * exactly — snake_case — so what you read in the docs is what you read in code.
 */

/** A disk uuid, a `Disk`, or a disk slug (resolved once, then cached). */
export type DiskRef = string | Disk | { uuid: string };

/** Processing state of one imported source. */
export type ContentStatus = "queued" | "processing" | "processed" | "failed";

/** What a source is: a conversation, or a document. */
export type ContentType = "chat" | "doc";

/** Where a fact came from: `chat` facts are enduring, `doc` facts are local to their document. */
export type FactOrigin = "chat" | "doc";

/** What a citation points at. */
export type CitationType = "message_chunk" | "fact" | "summary";

// --- disks ------------------------------------------------------------- //

export interface Disk {
  uuid: string;
  name: string;
  slug: string;
  /** Present on the listing. */
  document_count?: number;
  /** Present on the listing. */
  tokens_stored?: number;
}

export interface CreateDiskParams {
  /** Human label. */
  name: string;
  /** URL-safe id. Derived from `name` when omitted; creation is idempotent on it. */
  slug?: string;
  description?: string;
}

export interface DiskListResponse {
  disks: Disk[];
}

export interface DeletedResponse {
  deleted: boolean;
  /** Present when deleting one content. */
  chunks_removed?: number;
}

// --- import ------------------------------------------------------------ //

export interface ChatMessage {
  role: string;
  content: string;
  /** The message's original time, RFC 3339. Preserved as its time anchor. */
  timestamp?: string;
  /** The message's id in *your* system — the per-message dedup key. */
  uuid?: string;
}

export interface ImportChatParams {
  messages: ChatMessage[];
  /** Label for the thread. The same name always means the same thread. Default `conversation`. */
  name?: string;
  /** Virtual path within the disk. Default `/imports`. */
  folder_path?: string;
  /** Optional speaker label. */
  persona?: string;
  /** Free-text origin tag. */
  source?: string;
  /** `{ variant: canonical }` — resolves role words to real names. */
  aliases?: Record<string, string>;
  /** Used only when importing by slug and the disk has to be created. */
  disk_name?: string;
}

export interface ImportChatResponse {
  /** Only returned by the by-slug route, which resolves or creates the disk. */
  disk_uuid?: string;
  content_uuid: string;
  messages_added: number;
  /** `true` when every message in the batch was already stored. */
  skipped: boolean;
  status: ContentStatus;
}

/**
 * Source formats. Omit (or `markdown`) for markdown and plain text; text/markup
 * formats go in `body`; binary and image formats go in `body_b64`.
 */
export type DocumentFormat =
  | "markdown"
  | "latex"
  | "html"
  | "docx"
  | "rtf"
  | "odt"
  | "epub"
  | "rst"
  | "org"
  | "csv"
  | "pdf"
  | "pptx"
  | "xlsx"
  | "xls"
  | "png"
  | "jpg"
  | "jpeg"
  | "webp"
  | "tiff"
  | "gif"
  | "bmp"
  | (string & {});

export interface ImportDocumentParams {
  /** Document text, for text and markup formats. Either this or `body_b64`. */
  body?: string;
  /** Base64 of the raw file bytes, for binary and image formats. */
  body_b64?: string;
  title?: string;
  /** Label. Falls back to `title`, then `pasted-text`. */
  name?: string;
  /** `(folder_path, name)` is the document's identity — re-importing upserts by path. */
  folder_path?: string;
  source?: string;
  format?: DocumentFormat;
}

export interface ImportDocumentResponse {
  content_uuid: string;
  /** `true` when this exact `(folder_path, name)` and body were already stored. */
  skipped: boolean;
  status: ContentStatus;
}

/** What comes back instead when an AI chat-history export is recognised. */
export interface ChatExportResponse {
  mode: "chat-export";
  format: string;
  conversations: number;
  messages: number;
  status: ContentStatus;
}

export type ImportDocumentResult = ImportDocumentResponse | ChatExportResponse;

export interface ImportUrlParams {
  /** Full `http(s)` URL. A YouTube link imports its transcript. */
  url: string;
  /** Label. Defaults to the page or video title. */
  name?: string;
  /** Destination folder. */
  folder_path?: string;
}

export interface ImportUrlResponse {
  content_uuid: string;
  skipped: boolean;
  status: ContentStatus;
  source_type: "web" | "youtube" | (string & {});
  title: string;
}

/** The disk-side import cursor — where an incremental sync left off. */
export interface ImportCursor {
  content_uuid?: string;
  /** The last message's id *in your system*. */
  original_uuid?: string;
  original_timestamp?: string;
  name?: string;
  /** `true` when nothing has been imported yet — start from the beginning. */
  empty: boolean;
}

export interface RetryResponse {
  status: ContentStatus;
}

export interface OcrParams {
  /** Base64 of the raw image bytes. */
  image_b64: string;
  /** Image format. Defaults to `png`. */
  format?: DocumentFormat;
}

export interface OcrResponse {
  text: string;
  chars: number;
}

// --- retrieval --------------------------------------------------------- //

/** The scoring trace behind one citation. Present only with `explain: true`. */
export interface CitationExplain {
  /** The lanes this passage was found in: `dense`, `sparse`, `graph`, `subject`, `summary`. */
  lanes: string[];
  /** Its 0-based position within each of those lanes. */
  lane_ranks: Record<string, number>;
  /** The fused rank-fusion score, before the reranker. */
  rrf: number;
  /** The raw reranker relevance score, before any prior. */
  rerank: number;
  /** Only the post-rerank adjustments that actually fired. */
  priors?: Record<string, number | boolean>;
  /** Its 0-based rank *before* packing — the gap to `n` is itself the diagnostic. */
  final_rank: number;
}

export interface Citation {
  n: number;
  type: CitationType;
  content_uuid: string;
  content_name: string;
  heading_path: string;
  snippet: string;
  score: number;
  /** The underlying memory object — the key to feed back in `exclude`. */
  object_uuid: string;
  explain?: CitationExplain;
}

/** The disk's standing profile + memory index, shipped on every retrieve. */
export interface StableBlock {
  block: string;
  /** Changes only when the body changes — cache the block against it. */
  hash: string;
  tokens: number;
}

/** Present only when the cross-turn recall ledger engaged. */
export interface RecallLedger {
  session_id: string;
  dedup_turns: number;
  excluded: number;
  recorded: number;
}

/** Filters shared by retrieve and ask. */
export interface MemoryFilters {
  /** Folder subtree — `/` (default) is the whole disk. */
  path?: string;
  /** Restrict the *fact* layer to these categories. Passages and summaries are unaffected. */
  categories?: string[];
  /** Restrict every layer to memory carrying any of these tags. Free text. */
  tags?: string[];
  /** Only memory created at or after this RFC 3339 instant. */
  since?: string;
  /** Only memory created at or before this RFC 3339 instant. */
  until?: string;
  /** Multi-hop: also inject connected entities' fact profiles via the knowledge graph. */
  graph_expand?: boolean;
  /** How far the graph walk goes. Default 1. */
  graph_hops?: number;
  /** Rewrite the query into a few diverse queries (HyDE + decomposition) and merge. */
  expand?: boolean;
  /** Cap on expanded queries including the original. Default 4. */
  expand_max?: number;
}

export interface RetrieveOptions extends MemoryFilters {
  /** Cap on the returned block. `0`/omitted uses the retrieval default. */
  context_tokens?: number;
  /**
   * Relevance floor. Omitted or `0` uses the calibrated default of `0.35`;
   * a negative value removes the floor and returns the raw top-N.
   */
  min_score?: number;
  /** `object_uuid`s already in your context — skipped this turn. */
  exclude?: string[];
  /** Names an ongoing conversation. Only does something with `dedup_turns`. */
  session_id?: string;
  /** How many recent turns to cool a served memory for. `0` = off, capped at 32. */
  dedup_turns?: number;
  /** Prefer fresh conversation via a bounded time-decay multiplier. Never a cutoff. */
  recency?: boolean;
  /** Attach a per-citation scoring trace. Diagnostic only — ranking is unchanged. */
  explain?: boolean;
  /** Escape hatch for server fields this SDK version does not type yet. */
  extra?: Record<string, unknown>;
}

export interface RetrieveResponse {
  /** Ready-to-prompt numbered `[n]` passages. */
  block: string;
  citations: Citation[];
  tokens_used: number;
  /** Whether coarse-to-fine retrieval expanded a summary into its detail. */
  drilled: boolean;
  /** Whether query expansion ran for this call. */
  expanded: boolean;
  /** `null` until the disk has a profile or index to ship. */
  stable: StableBlock | null;
  retrieve_ms: number;
  ledger?: RecallLedger;
}

export interface AskOptions extends MemoryFilters {
  /** Answer model tier. Omitted = `main`. */
  model?: "fast" | "main";
  /** ISO code for the answer language. `""`/`en` = English. */
  language?: string;
  /** Prior turns, for follow-up questions. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Escape hatch for server fields this SDK version does not type yet. */
  extra?: Record<string, unknown>;
}

export interface AskResponse {
  answer: string;
  /** The memory passages offered to the answer — cited or not. */
  citations: Citation[];
  drilled: boolean;
  tokens_used: number;
  retrieve_ms: number;
  answer_ms: number;
}

// --- memory ------------------------------------------------------------ //

/** What the latest summary of one source actually covered. */
export interface SummaryFreshness {
  source_count: number;
  window_count: number;
  generated_at: string;
  /** More complete material a further summary pass will consume. */
  pending: boolean;
}

export interface Content {
  uuid: string;
  name: string;
  folder_path: string;
  content_type: ContentType;
  status: ContentStatus;
  chunking_done: boolean;
  facts_done: boolean;
  summary_done: boolean;
  tags_done: boolean;
  created_at: string;
  message_count?: number;
  preview?: string;
  tags?: string[];
  source?: string;
  /** xxhash64 of a document's body, as a string. Absent for chats. */
  content_hash?: string;
  /** `null` until a first summary lands. */
  freshness?: SummaryFreshness | null;
  /** Whether the source has grown past what its latest summary covered. */
  stale: boolean;
  [key: string]: unknown;
}

export interface ContentsResponse {
  contents: Content[];
  consolidating?: boolean;
}

export interface Fact {
  uuid?: string;
  text: string;
  category: string;
  /** How many times the fact was re-observed. */
  reinforced_count: number;
  origin: FactOrigin;
  tags?: string[];
  created_at?: string;
}

export interface Tag {
  slug: string;
  text: string;
  /** How many contents carry this tag. */
  uses: number;
  uuid?: string;
}

export interface MemoryResponse {
  /** Deduplicated across the disk, central-first. */
  facts: Fact[];
  summary: string;
  tags: Tag[];
}

export interface TagsResponse {
  tags: Tag[];
}

/** Why a fact was closed. */
export type CloseKind = "superseded" | "replaced" | "retired" | "expired";

export interface GroupFact {
  uuid: string;
  text: string;
  category: string;
  reinforced_count: number;
  origin: FactOrigin;
  /** World time the fact became true. */
  valid_from: string | null;
  /** World time it stopped being true. */
  valid_to: string | null;
  /** System time: superseded by a contradicting fact. */
  invalidated: boolean;
  /** History entries only — its presence is the signal you are looking at history. */
  close_kind?: CloseKind;
  /** The uuid of the fact that took its place, where there is one. */
  superseded_by?: string;
}

export interface FactGroup {
  subject: string;
  predicate: string;
  /** `functional` (one current value) or `multi` (set-valued). */
  kind: "functional" | "multi";
  current: GroupFact[];
  /** Newest-closed first, capped at 8 on the wire. */
  history: GroupFact[];
  /** The unclipped history length. */
  history_count: number;
}

export interface GroupsResponse {
  groups: FactGroup[];
  total_groups: number;
  /** Current facts carrying no subject/predicate key. */
  ungrouped: number;
}

export interface Subject {
  /** The canonical, lower-cased subject name. */
  name: string;
  /** The dominant category across the subject's facts. */
  category: string;
  fictional: boolean;
  /** Current facts about this entity. */
  facts: number;
}

export interface GraphEdge {
  subject: string;
  predicate: string;
  object: string;
  /** How many current facts assert the same relation. */
  weight?: number;
  object_text?: string;
  fact_uuid?: string;
}

export interface SubjectsResponse {
  subjects: Subject[];
  edges: GraphEdge[];
  subjects_total: number;
  subjects_returned: number;
  edges_total: number;
  edges_returned: number;
  edges_cap: number;
  truncated: boolean;
}

export interface Profile {
  body: string;
  /** One line naming the subject(s) and their current chapter. */
  headline: string;
  generated_at: string;
  facts_at_gen: number;
  gen_count: number;
  hash: string;
}

/** A compact machine-generated map of what the memory contains. */
export interface MemoryIndex {
  body: string;
  generated_at: string;
  hash: string;
}

export interface ProfileResponse {
  /** `null` until the disk has enough processed memory for a first generation. */
  profile: Profile | null;
  /** `null` only on an empty disk. */
  index: MemoryIndex | null;
}

export interface Folder {
  path: string;
  name: string;
  parent_path: string;
  content_count: number;
}

export interface FoldersResponse {
  folders: Folder[];
}

export interface MovedResponse {
  moved: boolean;
}

export interface AliasesResponse {
  aliases: Record<string, string>;
}

export interface AliasesWriteResponse {
  status: string;
  aliases: Record<string, string>;
}

export interface EcosystemSource {
  uuid: string;
  name: string;
  content_type: ContentType;
}

export interface EcosystemResponse {
  sources: EcosystemSource[];
  tags: Tag[];
  facts: Fact[];
  links: {
    /** `[source, tag]` — a source carries a tag. */
    source_tag: [string, string][];
    /** `[source, fact]` — a source contributed a fact. */
    source_fact: [string, string][];
    /** `[fact, tag]` — first entry per fact is its primary tag. */
    fact_tag: [string, string][];
  };
  facts_total: number;
  facts_returned: number;
  facts_cap: number;
  truncated: boolean;
}

export interface GraphQueryResponse {
  /** Auto-detected from the query shape. */
  mode: "path" | "neighbors" | "edges" | (string & {});
  query: string;
  edges: GraphEdge[];
}

// --- memory writes ----------------------------------------------------- //

export interface RememberParams {
  /** The fact, written as a complete sentence. */
  text: string;
  /** The entity the fact is about. Optional, but it is what groups the fact. */
  subject?: string;
  /** The relation. */
  predicate?: string;
  /** The other end of the relation. */
  object?: string;
  /** Fact category. Default `personal`. */
  category?: string;
  /** Importance, 1 to 100. Default 50. */
  priority?: number;
}

export interface RememberResponse {
  fact_uuid: string;
}

export interface ForgetResponse {
  /** How many facts were closed. `0` means it was already retired. */
  closed: number;
}

export interface UpdatedResponse {
  updated: number;
}

// --- agent tools ------------------------------------------------------- //

export interface ContentHeader {
  uuid: string;
  name: string;
  content_type: ContentType;
  folder_path: string;
  status: ContentStatus;
  created_at: string;
  title?: string;
  is_container?: boolean;
  parent_uuid?: string;
  original_timestamp?: string | null;
}

export interface SourceSection {
  uuid: string;
  name: string;
  status: ContentStatus;
}

export interface SourceMessage {
  uuid: string;
  role: string;
  text: string;
  sort_order: number;
  original_timestamp?: string | null;
  original_uuid?: string;
}

export interface ReadSourceResponse {
  content: ContentHeader;
  /** Documents: the body. `offset`/`total` are **byte** positions. */
  body?: string;
  /** Documents split at their headings list their sections. */
  sections?: SourceSection[];
  /** Conversations: one page of the thread. */
  messages?: SourceMessage[];
  /** Byte length for a document, message count for a conversation. */
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
}

export interface GrepOptions {
  /** Folder subtree to search. */
  path?: string;
  case_insensitive?: boolean;
  /** Default 50, max 500. */
  limit?: number;
}

export interface GrepHit {
  content_uuid: string;
  content_name: string;
  content_type: ContentType;
  folder_path: string;
  snippet: string;
  /** Conversation hits only. */
  message_uuid?: string;
  /** Conversation hits only. */
  sort_order?: number;
  /** Present when the source carried a timestamp. */
  ts?: string;
}

export interface GrepResponse {
  hits: GrepHit[];
  pattern: string;
  path: string;
  limit: number;
  truncated: boolean;
}

export type ExportFormat = "json" | "jsonld" | "turtle" | "csv";

export interface ExportOptions {
  /** Default `json`. */
  format?: ExportFormat;
  /** Default `facts,edges`. Add `summaries` to include canonical summaries. */
  include?: string;
  /** Folder subtree to export. */
  path?: string;
}

export interface ExportedFact {
  uuid: string;
  text: string;
  subject: string;
  predicate: string;
  /** Resolved from the fact's first current relationship; `""` when it has none. */
  object: string;
  category: string;
  origin: FactOrigin;
  valid_from: string | null;
  /** Always `null` — only current facts are exported. */
  valid_to: string | null;
  recorded_at: string;
  priority: number;
  reinforced_count: number;
  folder_path: string;
  source_content_uuids: string[];
}

export interface ExportResponse {
  disk: string;
  disk_name: string;
  path: string;
  exported_at: string;
  facts: ExportedFact[];
  edges: GraphEdge[];
  summaries?: unknown[];
}

export interface Hub {
  name: string;
  category: string;
  facts: number;
  degree_in: number;
  degree_out: number;
  /** Weighted: a relationship asserted by three facts counts three. */
  weighted_degree: number;
  pagerank: number;
}

export interface HubsResponse {
  hubs: Hub[];
  nodes: number;
  edges: number;
  top: number;
  hubs_total: number;
  truncated: boolean;
  path: string;
}

/**
 * One lint section. Each is fenced independently: a section that failed carries
 * its own `error` and a `null` total while the report still answers 200 — so
 * check each section before trusting it.
 */
export interface LintSection {
  total: number | null;
  returned?: number;
  items?: unknown[];
  error?: string;
  [key: string]: unknown;
}

export interface LintResponse {
  disk: string;
  generated_at: string;
  path: string;
  limit: number;
  sections: Record<string, LintSection>;
  totals: Record<string, number | null>;
}

export interface ExtractPreviewParams {
  /** The text to run extraction over. Cut above 24,000 characters. */
  text: string;
  /** `{ variant: canonical }`, exactly as on a conversation import. */
  aliases?: Record<string, string>;
}

export interface PreviewFact {
  text: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  /** Filled only when the time gate accepted an in-text date. */
  valid_from?: string | null;
  /** Set when the text stated this value has already ended. */
  valid_to?: string | null;
  /** How precisely the text stated the time: 1.00 a full date … 0.00 no signal. */
  temporal_confidence?: number;
  /** The exact words that carried the time, copied from the text. */
  temporal_source_text?: string;
}

export interface ExtractPreviewResponse {
  facts: PreviewFact[];
  /** How many candidates the filters threw away. */
  dropped: number;
  /** The length actually sent. */
  chars: number;
  truncated: boolean;
}

export interface ConsolidationRun {
  uuid: string;
  seed_fact_uuid: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  tier_counts: Record<string, number>;
  facts_closed: number;
  facts_rewritten: number;
  contested: number;
  clusters: number;
  superseded: number;
}

export interface ConsolidationRunsResponse {
  runs: ConsolidationRun[];
  returned: number;
  limit: number;
}

export interface ConsolidationRunResponse extends ConsolidationRun {
  /** The full memory diff for this fold. */
  diff?: Record<string, unknown>;
  /** What undoing the fold would do. Computed, never executed. Only with `plan: true`. */
  plan?: Record<string, unknown>;
}
