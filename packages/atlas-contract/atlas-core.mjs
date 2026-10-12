import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const ATLAS_SCHEMA = "starlight.atlas.v1";
export const ATLAS_NOTICE = "Public editorial drafts. Source inspection and claim standing describe the recorded evidence; they do not establish independent replication or scientific consensus.";
const ID = /^[a-z]+(?:-[a-z0-9]+)+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSPECTIONS = new Set(["metadata_only", "abstract_only", "relevant_sections", "complete_text", "data_and_code"]);
const STANDINGS = new Set(["supported_within_scope", "tentative", "unresolved", "disputed", "contradicted_within_scope"]);
const KINDS = new Set(["observation", "inference", "boundary_condition", "historical_evidence", "model_result", "interpretation", "theology", "fiction"]);
const LENSES = new Set(["foundation", "frontier", "historical", "hypothesis"]);
const RELATIONS = new Set(["supports", "qualifies", "contradicts"]);

export class AtlasValidationError extends Error {
  constructor(message) { super(message); this.name = "AtlasValidationError"; }
}
function require(condition, message) { if (!condition) throw new AtlasValidationError(message); }
function object(value, label) { require(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); return value; }
function string(value, label, max = 20000) { require(typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `${label} must be a bounded, nonempty string`); return value; }
function date(value, label, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null;
  require(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  require(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, `${label} is not a calendar date`);
  return value;
}
function strings(value, label, max = 2000) { require(Array.isArray(value) && value.length <= max, `${label} must be a bounded list`); return value.map((v, i) => string(v, `${label}[${i}]`)); }
function unique(values, label) { require(new Set(values).size === values.length, `${label} contains duplicate references`); return values; }
function pickOptionalText(source, result, keys, label) { for (const key of keys) if (source[key] !== undefined && source[key] !== null) result[key] = string(source[key], `${label}.${key}`); }
function indexed(value, label) {
  require(Array.isArray(value) && value.length <= 10000, `${label} must be a bounded list`);
  const index = new Map();
  for (const item of value) { object(item, label); require(typeof item.id === "string" && item.id.length <= 200 && ID.test(item.id), `${label} has invalid stable id`); require(!index.has(item.id), `${label} contains duplicate id ${item.id}`); index.set(item.id, item); }
  return index;
}
function receiptRef(value, label) {
  string(value, label, 4096);
  if (/^https?:\/\//.test(value)) return safeSourceURL(value);
  require(/^[a-zA-Z0-9_./:@-]+$/.test(value) && !value.startsWith("/") && !value.split("/").some(part => ["", ".", ".."].includes(part)) && !/^[a-z][a-z0-9+.-]*:/i.test(value), `${label} must be a safe repository receipt reference`);
  return value;
}
export function safeSourceURL(value) {
  string(value, "source.url", 4096);
  require(!/[\s<>\\]/.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value), "source.url has unsafe URL characters");
  let url; try { url = new URL(value); } catch { throw new AtlasValidationError("source.url is an unsafe URL"); }
  const host = url.hostname.toLowerCase();
  require(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && (!url.port || url.port === "80" || url.port === "443"), "source.url is an unsafe URL");
  require(!isIP(host.replace(/^\[|\]$/g, "")) && host.includes(".") && !host.endsWith(".") && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host), "source.url must identify a public source domain");
  return value;
}
function sourceRecord(value) {
  const s = object(value, "source");
  const out = { id: s.id, title: string(s.title, `${s.id}.title`), url: safeSourceURL(s.url), kind: string(s.kind, `${s.id}.kind`), published_on: date(s.published_on, `${s.id}.published_on`), updated_on: date(s.updated_on, `${s.id}.updated_on`, true), issue_on: date(s.issue_on, `${s.id}.issue_on`, true), event_on: date(s.event_on, `${s.id}.event_on`, true), accessed_on: date(s.accessed_on, `${s.id}.accessed_on`), language: string(s.language, `${s.id}.language`, 50), lineage_id: string(s.lineage_id, `${s.id}.lineage_id`, 200), inspection: s.inspection, inspected_locators: strings(s.inspected_locators, `${s.id}.inspected_locators`, 100), update_status: string(s.update_status, `${s.id}.update_status`, 100) };
  require(INSPECTIONS.has(s.inspection), `${s.id} has unknown inspection level`);
  require(out.inspected_locators.length > 0, `${s.id} needs inspection locators`);
  require(out.published_on <= out.accessed_on, `${s.id} is published after retrieval`);
  require(out.updated_on === null || (out.updated_on >= out.published_on && out.updated_on <= out.accessed_on), `${s.id} has inconsistent update dates`);
  const rights = object(s.rights, `${s.id}.rights`);
  require(rights.stored_content === "bibliographic_metadata_and_original_paraphrase", `${s.id} has unsupported stored content`);
  require(typeof rights.media_included === "boolean" && rights.media_included === false, `${s.id} must not include unreviewed media`);
  out.rights = { full_text_redistribution: string(rights.full_text_redistribution, `${s.id}.rights.full_text_redistribution`), stored_content: rights.stored_content, media_included: false };
  pickOptionalText(s, out, ["doi", "publication_stage", "issue_date_precision", "published_date_precision", "retrieval_limit", "retrieval_mode", "retrieval_note", "report_author", "publisher", "container_title", "volume", "issue", "pages", "isbn", "archive", "archive_location", "update_check_method", "update_check_limit", "update_check_scope", "inspection_note", "issue_date_note", "source_license_reported", "arxiv_id", "inspected_version", "date_note"], s.id);
  for (const key of ["update_check_url", "preprint_url", "published_version_metadata_url"]) if (s[key] !== undefined && s[key] !== null) out[key] = safeSourceURL(s[key]);
  for (const key of ["first_preprint_on", "journal_published_on"]) if (s[key] !== undefined && s[key] !== null) { out[key] = date(s[key], `${s.id}.${key}`); require(out[key] <= out.accessed_on, `${s.id}.${key} is after retrieval`); }
  if (s.update_checked_on !== undefined && s.update_checked_on !== null) { out.update_checked_on = date(s.update_checked_on, `${s.id}.update_checked_on`); require(out.update_checked_on <= out.accessed_on, `${s.id} has update check after retrieval`); }
  if (s.authors !== undefined) out.authors = strings(s.authors, `${s.id}.authors`, 100);
  return out;
}
function claimRecord(value) {
  const c = object(value, "claim");
  require(Number.isInteger(c.revision) && c.revision > 0, `${c.id} has invalid revision`);
  require(KINDS.has(c.claim_kind), `${c.id} has unknown claim kind`);
  require(STANDINGS.has(c.standing), `${c.id} has unknown standing`);
  require(Array.isArray(c.evidence) && c.evidence.length > 0 && c.evidence.length <= 100, `${c.id} needs bounded evidence`);
  const evidence = c.evidence.map((edge, i) => { object(edge, `${c.id}.evidence[${i}]`); require(RELATIONS.has(edge.relation), `${c.id} has invalid evidence relation`); return { source_id: string(edge.source_id, `${c.id}.evidence.source_id`, 200), relation: edge.relation, locator: string(edge.locator, `${c.id}.evidence.locator`), inspection_note: string(edge.inspection_note, `${c.id}.evidence.inspection_note`) }; });
  unique(evidence.map(e => `${e.source_id}\u0000${e.relation}\u0000${e.locator}`), `${c.id}.evidence`);
  const review = object(c.review, `${c.id}.review`);
  require(["draft", "reviewed"].includes(review.status) && typeof review.independent_review === "boolean", `${c.id} has invalid review status`);
  const publicReview = { status: review.status, method: string(review.method, `${c.id}.review.method`), independent_review: review.independent_review };
  pickOptionalText(review, publicReview, ["reviewer", "scope", "limits", "rationale"], `${c.id}.review`);
  if (review.receipt_ref !== undefined && review.receipt_ref !== null) publicReview.receipt_ref = receiptRef(review.receipt_ref, `${c.id}.review.receipt_ref`);
  if (review.reviewed_on !== undefined && review.reviewed_on !== null) publicReview.reviewed_on = date(review.reviewed_on, `${c.id}.review.reviewed_on`);
  if (review.independent_review) require(review.status === "reviewed" && typeof review.receipt_ref === "string" && review.receipt_ref.trim().length > 0, `${c.id} independent review needs a reviewed receipt`);
  const out = { id: c.id, article_id: string(c.article_id, `${c.id}.article_id`, 200), revision: c.revision, text: string(c.text, `${c.id}.text`), claim_kind: c.claim_kind, standing: c.standing, scope: string(c.scope, `${c.id}.scope`), limits: string(c.limits, `${c.id}.limits`), evidence, canonical_claim_ref: c.canonical_claim_ref === undefined || c.canonical_claim_ref === null ? null : string(c.canonical_claim_ref, `${c.id}.canonical_claim_ref`), review: publicReview, first_recorded_on: date(c.first_recorded_on, `${c.id}.first_recorded_on`), last_source_checked_on: date(c.last_source_checked_on, `${c.id}.last_source_checked_on`), next_review_on: date(c.next_review_on, `${c.id}.next_review_on`) };
  require(out.first_recorded_on <= out.last_source_checked_on && out.last_source_checked_on <= out.next_review_on, `${c.id} has inconsistent review dates`);
  return out;
}
function articleRecord(value) {
  const a = object(value, "article");
  require(typeof a.slug === "string" && SLUG.test(a.slug) && a.slug.length <= 160, `${a.id} has invalid slug`);
  require(LENSES.has(a.lens), `${a.id} has unknown lens`);
  require(["draft", "editorial_draft"].includes(a.publication_status), `${a.id} cannot automatically become reviewed publication`);
  const out = { id: a.id, slug: a.slug, title: string(a.title, `${a.id}.title`), domain_id: string(a.domain_id, `${a.id}.domain_id`, 200), lens: a.lens, editorial_hook: string(a.editorial_hook, `${a.id}.editorial_hook`), claim_ids: unique(strings(a.claim_ids, `${a.id}.claim_ids`), `${a.id}.claim_ids`), related_source_ids: unique(strings(a.related_source_ids ?? [], `${a.id}.related_source_ids`), `${a.id}.related_source_ids`), question: string(a.question, `${a.id}.question`), graph_mapping_proposal: strings(a.graph_mapping_proposal ?? [], `${a.id}.graph_mapping_proposal`), publication_status: "editorial_draft", created_on: date(a.created_on, `${a.id}.created_on`) };
  require(out.claim_ids.length > 0, `${a.id} has no claims`); return out;
}
function projectionRecord(value) {
  const p = object(value, "projection");
  require(typeof p.source_repository === "string" && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(p.source_repository), "projection has invalid source repository");
  require(typeof p.source_path === "string" && !p.source_path.startsWith("/") && !p.source_path.split("/").some(part => ["", ".", ".."].includes(part)) && /^[a-zA-Z0-9_./-]+$/.test(p.source_path), "projection has invalid source path");
  require(typeof p.source_commit === "string" && /^[a-f0-9]{40}$/.test(p.source_commit), "projection needs an exact upstream commit SHA");
  require(typeof p.content_sha256 === "string" && /^[a-f0-9]{64}$/.test(p.content_sha256), "projection has invalid content digest");
  return { source_repository: p.source_repository, source_path: p.source_path, source_commit: p.source_commit, content_sha256: p.content_sha256, compiled_on: date(p.compiled_on, "projection.compiled_on") };
}

/** Reject malformed evidence before serving it; strip fields outside the public contract. */
export function normalizeAtlas(input) {
  const data = object(input, "atlas");
  require(["0.1.0-proposal", ATLAS_SCHEMA].includes(data.schema_version), "Unknown Atlas schema");
  require(["proposal_not_canonical", "editorial_draft"].includes(data.status), "Atlas cannot automatically become confirmed or approved");
  const domains = [...indexed(data.domains, "domains").values()].map(d => ({ id: d.id, label: string(d.label, `${d.id}.label`), coverage: string(d.coverage, `${d.id}.coverage`), proposed: d.proposed === true }));
  const sources = [...indexed(data.sources, "sources").values()].map(sourceRecord);
  const claims = [...indexed(data.claims, "claims").values()].map(claimRecord);
  const articles = [...indexed(data.articles, "articles").values()].map(articleRecord);
  unique([...domains, ...sources, ...claims, ...articles].map(item => item.id), "global stable ids");
  const domainMap = new Map(domains.map(d => [d.id, d])); const sourceMap = new Map(sources.map(s => [s.id, s])); const claimMap = new Map(claims.map(c => [c.id, c])); const articleMap = new Map(articles.map(a => [a.id, a]));
  unique(articles.map(a => a.slug), "article slugs");
  for (const a of articles) {
    require(domainMap.has(a.domain_id), `${a.id} references missing domain`);
    for (const id of a.claim_ids) { require(claimMap.has(id), `${a.id} references missing claim ${id}`); require(claimMap.get(id).article_id === a.id, `${a.id} has claim ownership mismatch`); }
    for (const id of a.related_source_ids) require(sourceMap.has(id), `${a.id} references missing related source ${id}`);
  }
  for (const c of claims) {
    require(articleMap.has(c.article_id) && articleMap.get(c.article_id).claim_ids.includes(c.id), `${c.id} is an orphaned claim`);
    let supportCount = 0;
    for (const edge of c.evidence) {
      require(sourceMap.has(edge.source_id), `${c.id} cites missing source ${edge.source_id}`);
      const s = sourceMap.get(edge.source_id);
      if (edge.relation === "supports") {
        supportCount++;
        require(s.inspection !== "metadata_only", `${c.id} cannot use metadata-only support`);
        require(s.update_status !== "retracted" || ["unresolved", "contradicted_within_scope"].includes(c.standing), `${c.id} relies on retracted support without reassessment`);
      }
    }
    require(!["supported_within_scope", "tentative"].includes(c.standing) || supportCount > 0, `${c.id} has no support edge`);
  }
  const coverage = object(data.coverage, "coverage");
  require(typeof coverage.systematic_review === "boolean" && typeof coverage.geographic_exhaustiveness === "boolean", "coverage needs explicit review boundaries");
  const out = { schema_version: ATLAS_SCHEMA, title: string(data.title, "title"), status: "editorial_draft", editorial_notice: ATLAS_NOTICE, created_on: date(data.created_on, "created_on"), license: string(data.license, "license"), coverage: { search_completed_on: date(coverage.search_completed_on, "coverage.search_completed_on"), systematic_review: coverage.systematic_review, geographic_exhaustiveness: coverage.geographic_exhaustiveness, languages: strings(coverage.languages, "coverage.languages", 100), areas_inspected: strings(coverage.areas_inspected, "coverage.areas_inspected", 1000), limits: strings(coverage.limits, "coverage.limits", 1000) }, domains, sources, claims, articles };
  // Authority metadata must remain explicit public records, never private tool payloads.
  if (data.admission_receipt !== undefined) out.admission_receipt = receiptRef(data.admission_receipt, "admission_receipt");
  if (data.projection !== undefined) out.projection = projectionRecord(data.projection);
  return out;
}

export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hashAtlasContent(atlas) { const { projection: _projection, ...payload } = atlas; return createHash("sha256").update(stableJSON(payload)).digest("hex"); }
export function compileAtlas(input, projection) {
  const atlas = normalizeAtlas(input);
  delete atlas.projection;
  atlas.projection = projectionRecord({ ...projection, content_sha256: hashAtlasContent(atlas) });
  return atlas;
}
export function validateAtlas(input) {
  const atlas = normalizeAtlas(input);
  require(atlas.projection !== undefined, "Atlas projection provenance is required");
  require(atlas.projection.content_sha256 === hashAtlasContent(atlas), "Atlas content digest mismatch");
  // Fail closed rather than let a stale projection silently hide unprojected canonical fields.
  require(stableJSON(input) === stableJSON(atlas), "Atlas projection includes unknown or noncanonical public fields");
  return atlas;
}
export function claimsForArticle(atlas, article) { const byId = new Map(atlas.claims.map(c => [c.id, c])); return article.claim_ids.map(id => byId.get(id)).filter(Boolean); }
export function articleForSlug(atlas, slug) {
  if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 160) return undefined;
  return atlas.articles.find(article => article.slug === slug);
}
export function sourcesForArticle(atlas, article, citationsOnly = false) {
  const ids = new Set(claimsForArticle(atlas, article).flatMap(c => c.evidence.map(e => e.source_id)));
  if (!citationsOnly) for (const id of article.related_source_ids) ids.add(id);
  return atlas.sources.filter(s => ids.has(s.id));
}
export function searchAtlas(atlas, { query = "", domain = "", lens = "", limit = 20 } = {}) {
  require(typeof query === "string" && query.length <= 200 && !/[\u0000-\u001f\u007f]/.test(query), "query must be at most 200 characters without controls");
  require(typeof domain === "string" && domain.length <= 200 && (!domain || ID.test(domain)), "domain must be a bounded stable domain id");
  require(typeof lens === "string" && (!lens || LENSES.has(lens)), "lens must be a known lens");
  require(Number.isInteger(limit) && limit >= 1 && limit <= 50, "limit must be an integer from 1 to 50");
  const tokens = query.toLocaleLowerCase("en").trim().split(/\s+/).filter(Boolean);
  const matches = atlas.articles.filter(a => (!domain || a.domain_id === domain) && (!lens || a.lens === lens)).filter(a => {
    const text = [a.id, a.slug, a.title, a.editorial_hook, a.question, ...claimsForArticle(atlas, a).flatMap(c => [c.id, c.text, c.scope, c.limits]), ...sourcesForArticle(atlas, a).flatMap(s => [s.id, s.title, s.doi ?? ""])].join(" ").toLocaleLowerCase("en");
    return tokens.every(token => text.includes(token));
  });
  return { query, domain: domain || null, lens: lens || null, limit, total: matches.length, truncated: matches.length > limit, articles: matches.slice(0, limit) };
}
export function parseAtlasQuery(params) {
  const allowed = new Set(["q", "domain", "lens", "limit"]);
  require(![...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1), "Use one value for q, domain, lens and limit");
  const rawLimit = params.get("limit");
  require(rawLimit === null || /^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit), "limit must be an integer from 1 to 50");
  return { query: params.get("q") ?? "", domain: params.get("domain") ?? "", lens: params.get("lens") ?? "", limit: rawLimit === null ? 20 : Number(rawLimit) };
}
function markdownText(value) { return value.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&").replace(/\r?\n/g, " "); }
function human(value) { return value.replaceAll("_", " "); }
function sourceDetails(s) {
  const details = [`Published ${s.published_on}${s.published_date_precision ? ` (${s.published_date_precision} precision)` : ""}${s.updated_on ? `; updated ${s.updated_on}` : ""}${s.issue_on ? `; issue ${s.issue_on} (${s.issue_date_precision ?? "day"} precision)` : ""}; accessed ${s.accessed_on}.`, `Inspection: ${human(s.inspection)}; scope: ${markdownText(s.inspected_locators.join("; "))}.`, `Update status: ${human(s.update_status)}.`];
  if (s.publication_stage) details.push(`Publication stage: ${human(s.publication_stage)}.`);
  if (s.retrieval_mode) details.push(`Retrieval mode: ${human(s.retrieval_mode)}.`);
  if (s.inspected_version) details.push(`Inspected version: ${markdownText(s.inspected_version)}${s.arxiv_id ? `; arXiv ${markdownText(s.arxiv_id)}` : ""}.`);
  if (s.first_preprint_on) details.push(`First preprint: ${s.first_preprint_on}.`);
  if (s.preprint_url) details.push(`Preprint record: <${s.preprint_url}>.`);
  if (s.journal_published_on) details.push(`Journal published: ${s.journal_published_on}.`);
  if (s.published_version_metadata_url) details.push(`Published-version metadata: <${s.published_version_metadata_url}>.`);
  if (s.update_checked_on) details.push(`Update checked: ${s.update_checked_on}.`);
  if (s.update_check_url) details.push(`Update-check record: <${s.update_check_url}>.`);
  for (const [field, label] of [["retrieval_note", "Retrieval note"], ["retrieval_limit", "Retrieval limit"], ["date_note", "Date note"], ["issue_date_note", "Issue-date note"], ["update_check_scope", "Update-check scope"], ["update_check_limit", "Update-check limit"], ["source_license_reported", "Reported source license"]]) if (s[field]) details.push(`${label}: ${markdownText(s[field])}`);
  return details.join(" ");
}
export function articleMarkdown(atlas, article) {
  const used = sourcesForArticle(atlas, article, true); const footnote = new Map(used.map((s, i) => [s.id, i + 1]));
  const lines = [`# ${markdownText(article.title)}`, "", `> EDITORIAL DRAFT — ${ATLAS_NOTICE}`, "", markdownText(article.editorial_hook), "", "## Claims", ""];
  for (const c of claimsForArticle(atlas, article)) {
    const refs = [...new Set(c.evidence.map(e => e.source_id))].map(id => `[^${footnote.get(id)}]`).join("");
    lines.push(`${markdownText(c.text)} ${refs}`, "", `**Standing:** ${human(c.standing)}. **Kind:** ${human(c.claim_kind)}.`, `**Scope:** ${markdownText(c.scope)}`, `**Limits:** ${markdownText(c.limits)}`, `**Claim revision:** ${c.id}@${c.revision}`, `**Review:** ${human(c.review.status)}; independent review: ${c.review.independent_review ? "recorded" : "not recorded"}.${c.review.scope ? ` Scope: ${markdownText(c.review.scope)}` : ""}${c.review.receipt_ref ? ` Receipt: ${markdownText(c.review.receipt_ref)}` : ""}`, "");
    for (const e of c.evidence) lines.push(`- Evidence [^${footnote.get(e.source_id)}] — ${e.relation}; locator: ${markdownText(e.locator)}. Inspection note: ${markdownText(e.inspection_note)}`);
    lines.push("");
  }
  lines.push("## Open question", "", markdownText(article.question), "", "This is a research question, not an executed experiment.", "", "## Footnotes", "");
  for (const s of used) lines.push(`[^${footnote.get(s.id)}]: ${markdownText(s.title)}. <${s.url}>. Source record: ${s.id}; lineage: ${markdownText(s.lineage_id)}. ${sourceDetails(s)}`);
  const extras = sourcesForArticle(atlas, article).filter(s => !footnote.has(s.id));
  if (extras.length) { lines.push("", "## Related records; not used as claim evidence", ""); for (const s of extras) lines.push(`- ${markdownText(s.title)} — <${s.url}>; source record: ${s.id}. ${sourceDetails(s)}`); }
  lines.push("", "## Provenance", "", `Schema: ${ATLAS_SCHEMA}. Publication status: editorial draft.`);
  if (atlas.projection) lines.push(`Source: ${atlas.projection.source_repository}@${atlas.projection.source_commit}:${atlas.projection.source_path}`, `Content SHA256: ${atlas.projection.content_sha256}`, `Compiled: ${atlas.projection.compiled_on}`);
  return `${lines.join("\n")}\n`;
}
export function citations(atlas, article) {
  // CSL is an interoperability format, not an evidence approval or publication gate.
  const used = article ? sourcesForArticle(atlas, article, true) : atlas.sources.filter(s => atlas.claims.some(c => c.evidence.some(e => e.source_id === s.id)));
  const kinds = { research_paper: "article-journal", preprint: "article", book: "book", manuscript: "manuscript", archival_document: "manuscript", dataset: "dataset", patent: "patent", thesis: "thesis", conference_paper: "paper-conference" };
  return used.map(s => {
    const out = { id: s.id, type: kinds[s.kind] ?? "webpage", title: s.title, URL: s.url, issued: { "date-parts": [s.published_on.split("-").map(Number)] }, accessed: { "date-parts": [s.accessed_on.split("-").map(Number)] }, language: s.language, note: `Atlas inspection: ${s.inspection}; update status: ${s.update_status}. ${s.retrieval_limit ?? ""}`.trim() };
    if (s.doi) out.DOI = s.doi;
    if (s.publisher) out.publisher = s.publisher;
    if (s.container_title) out["container-title"] = s.container_title;
    if (s.authors?.length) out.author = s.authors.map(literal => ({ literal })); else if (s.report_author) out.author = [{ literal: s.report_author }];
    for (const key of ["volume", "issue", "pages"]) if (s[key]) out[key === "pages" ? "page" : key] = s[key];
    if (s.isbn) out.ISBN = s.isbn;
    return out;
  });
}
