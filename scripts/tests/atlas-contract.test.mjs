import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ATLAS_SOURCE_UPDATE_STATUSES, AtlasValidationError, articleMarkdown, citations, compileAtlas, hashAtlasContent, normalizeAtlas, parseAtlasQuery, safeSourceURL, searchAtlas, stableJSON, validateAtlas, validateClaimHistory } from "../../packages/atlas-contract/atlas-core.mjs";

const original = JSON.parse(readFileSync(new URL("../../data/atlas/corpus.json", import.meta.url), "utf8"));
const originalHistory = JSON.parse(readFileSync(new URL("../../data/atlas/revisions/seed-review-2026-10-13.json", import.meta.url), "utf8"));
const seed = () => structuredClone(original);
const history = () => structuredClone(originalHistory);
const projection = { source_repository: "frankxai/starlight-knowledge-tree", source_path: "data/atlas/corpus.json", source_commit: "a".repeat(40), compiled_on: "2026-10-13" };
function rejects(change, pattern) { const value = seed(); change(value); assert.throws(() => normalizeAtlas(value), pattern); }
function rejectsHistory(change, pattern) { const value = history(); change(value); assert.throws(() => validateClaimHistory(original, [value]), pattern); }

test("canonical seed retains five drafts, ten claims and ten validated prior revisions", () => {
  const canonical = normalizeAtlas(original); assert.equal(stableJSON(canonical), stableJSON(original));
  assert.equal(canonical.articles.length, 5); assert.equal(canonical.claims.length, 10); assert.equal(canonical.sources.length, 11);
  assert(canonical.articles.every(a => a.publication_status === "editorial_draft")); assert(canonical.claims.every(c => !c.review.independent_review && c.revision === 2));
  assert.deepEqual(validateClaimHistory(original, [originalHistory]), { documents: 1, previous_claim_revisions: 10 });
});
test("unknown update states, case variants, aliases and injected status text are rejected", () => {
  for (const status of ["Retracted", "RETRACTED", " retracted", "retracted_with_notice", "withdrawn_with_notice", "not_checked\n\n# VERIFIED", "not-a-canonical-state"]) rejects(v => v.sources[0].update_status = status, /unknown source update status/);
  assert(ATLAS_SOURCE_UPDATE_STATUSES.includes("retracted")); assert(ATLAS_SOURCE_UPDATE_STATUSES.includes("withdrawn"));
});
test("exact retracted and withdrawn support fails until every dependent claim is reassessed", () => {
  for (const status of ["retracted", "withdrawn"]) {
    rejects(v => v.sources[0].update_status = status, /without reassessment/);
    const value = seed(); value.sources[0].update_status = status;
    value.claims.filter(c => c.evidence.some(e => e.source_id === value.sources[0].id && e.relation === "supports")).forEach(c => c.standing = "unresolved");
    assert.doesNotThrow(() => normalizeAtlas(value));
  }
});
test("even plausible filenames, reviewers and dates cannot fabricate independent scientific review", () => {
  for (const receipt of ["does-not-exist", "docs/atlas/source-review-2026-10-13.md", "https://research.example.org/review"]) rejects(v => v.claims[0].review = { status: "reviewed", method: "independent_review", independent_review: true, receipt_ref: receipt, reviewer: "reviewer-independent", reviewed_on: "2026-10-13" }, /promotion is unsupported/);
  const value = seed(); value.claims[0].review.status = "reviewed"; assert.equal(normalizeAtlas(value).status, "editorial_draft");
});
test("unsafe source and reviewer-context URLs cannot reach public records", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@example.org/", "http://127.0.0.1/", "https://[::1]/", "https://service.internal/", "https://example.org/%0aevil", "https://example.org/<script>"]) assert.throws(() => safeSourceURL(url), AtlasValidationError);
  for (const key of ["update_check_url", "preprint_url", "published_version_metadata_url"]) rejects(v => v.sources[0][key] = "javascript:evil", /unsafe URL/);
});
test("duplicate records, dangling references and metadata-only support are rejected", () => {
  rejects(v => v.sources.push(structuredClone(v.sources[0])), /duplicate id/);
  rejects(v => v.claims[0].evidence[0].source_id = "source-missing", /missing source/);
  rejects(v => v.sources[0].inspection = "metadata_only", /metadata-only support/);
  rejects(v => v.articles[0].claim_ids.pop(), /orphaned claim/);
});
test("public compiler strips private payloads and runtime reader refuses unknown published fields", () => {
  const value = seed(); value.private_registry = { secret: "never-publish" }; value.sources[0].full_text = "copyrighted full text"; value.claims[0].review.private_notes = "private";
  const compiled = compileAtlas(value, projection); assert(!JSON.stringify(compiled).includes("never-publish")); assert(!JSON.stringify(compiled).includes("copyrighted full text")); assert(!JSON.stringify(compiled).includes("private_notes")); assert.doesNotThrow(() => validateAtlas(compiled));
  compiled.hidden = true; assert.throws(() => validateAtlas(compiled), /unknown or noncanonical/);
});
test("content digest binds published facts; upstream revision must be exact", () => {
  const value = compileAtlas(original, projection); assert.equal(hashAtlasContent(value), value.projection.content_sha256);
  value.claims[0].text = "A substituted claim."; assert.throws(() => validateAtlas(value), /digest mismatch/);
  assert.throws(() => compileAtlas(original, { ...projection, source_commit: "main" }), /exact upstream commit/);
});
test("all exported dynamic Markdown metadata is escaped and line-normalized", () => {
  const value = seed(); const injected = "item\n\n# VERIFIED\n[approval](javascript:evil) <script>bad</script> **trusted**";
  for (const field of ["kind", "publication_stage", "retrieval_mode", "published_date_precision", "issue_date_precision", "retrieval_note", "date_note", "source_license_reported"]) value.sources[0][field] = injected;
  value.sources[0].issue_on = "2026-01-01"; value.sources[0].rights.full_text_redistribution = injected; value.claims[0].review.method = injected; value.claims[0].review.scope = injected;
  const canonical = normalizeAtlas(value); const markdown = articleMarkdown(canonical, canonical.articles[0]);
  assert(!/^# VERIFIED$/m.test(markdown)); assert(!markdown.includes("[approval](javascript:evil)")); assert(!markdown.includes("<script>")); assert(!markdown.includes("**trusted**")); assert(markdown.includes("\\# VERIFIED"));
  assert(markdown.includes("method: item")); assert(markdown.includes("Kind: item")); assert(markdown.includes("Source rights: full-text redistribution item"));
});
test("Markdown carries rights for every cited and related source and the collection license", () => {
  for (const article of original.articles) {
    const text = articleMarkdown(original, article); const ids = new Set([...article.related_source_ids, ...original.claims.filter(c => article.claim_ids.includes(c.id)).flatMap(c => c.evidence.map(e => e.source_id))]);
    assert.equal(text.match(/Source rights: full-text redistribution/g)?.length, ids.size);
    assert(text.includes("not\\_granted")); assert(text.includes("bibliographic\\_metadata\\_and\\_original\\_paraphrase")); assert(text.includes("media included no")); assert(text.includes("Collection license:"));
  }
});
test("CSL retains source-specific rights without granting publisher-text redistribution", () => {
  const refs = citations(original); assert(refs.length > 0); assert(refs.every(ref => ref.note.includes("full-text redistribution not_granted") && ref.note.includes("media included no")));
});
test("unknown and prototype-property source kinds cannot change CSL output shape", () => {
  for (const kind of ["__proto__", "constructor", "toString", "unknown_kind"]) { const value = seed(); value.sources[0].kind = kind; const ref = citations(value).find(ref => ref.id === value.sources[0].id); assert.equal(ref.type, "webpage"); assert.equal(typeof ref.type, "string"); }
});
test("CSL identifies inspected DESI and Saguaro preprints without attaching later journal DOI/date", () => {
  const refs = new Map(citations(original).map(ref => [ref.id, ref]));
  for (const [id, expected] of [["source-desi-analysis-paper", [2025, 3, 18]], ["source-lrd-paper", [2025, 7, 23]]]) {
    const ref = refs.get(id); assert.equal(ref.type, "article"); assert(!("DOI" in ref)); assert(!("container-title" in ref)); assert.deepEqual(ref.issued["date-parts"], [expected]); assert(ref.URL.startsWith("https://arxiv.org/")); assert(ref.note.includes("separate version"));
  }
  assert.equal(refs.get("source-bennu-sugars").type, "article-journal"); assert.equal(refs.get("source-bennu-sugars").DOI, "10.1038/s41561-025-01838-6"); assert.deepEqual(refs.get("source-bennu-sugars").issued["date-parts"], [[2025, 12, 2]]);
});
test("journal citations use explicit journal date while inspected-preprint dates retain their precision", () => {
  const value = seed(); const source = value.sources.find(s => s.id === "source-lrd-paper"); source.published_date_precision = "month";
  assert.deepEqual(citations(value).find(ref => ref.id === source.id).issued["date-parts"], [[2025, 7]]);
  source.url = "https://doi.org/10.3847/1538-4357/ae80cd"; source.publication_stage = "peer_reviewed_version_of_record";
  const journal = citations(value).find(ref => ref.id === source.id); assert.equal(journal.type, "article-journal"); assert.equal(journal.DOI, source.doi); assert.deepEqual(journal.issued["date-parts"], [[2026, 7, 29]]);
});
test("publication, revision and issue dates cannot masquerade as retrieval dates", () => {
  const source = original.sources.find(s => s.id === "source-bennu-sugars"); assert.equal(source.published_on, "2025-12-02"); assert.equal(source.issue_on, "2026-01-01"); assert.equal(source.issue_date_precision, "month"); assert.equal(source.accessed_on, "2026-10-13");
  rejects(v => v.sources[0].published_on = "2027-01-01", /after retrieval/); rejects(v => v.sources[0].published_on = "2026-02-30", /calendar date/);
});
test("history rejects missing prior revisions, unknown claims and article ownership changes", () => {
  rejectsHistory(v => v.history.previous_claim_revisions.pop(), /missing prior claim revision/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].id = "claim-unrelated", /unknown claim/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].article_id = "article-another", /ownership mismatch/);
  assert.throws(() => validateClaimHistory(original, []), /missing prior claim revision/);
});
test("history rejects duplicate, current and future claim revisions and missing retained evidence", () => {
  rejectsHistory(v => v.history.previous_claim_revisions.push(structuredClone(v.history.previous_claim_revisions[0])), /duplicate claim revision/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].revision = 2, /not a prior revision/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].revision = 3, /not a prior revision/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].evidence[0].source_id = "source-missing", /missing retained source/);
});
test("history validates schema, predecessor digest, dates, canonical fields and scientific review boundary", () => {
  rejectsHistory(v => v.schema_version = "history-v0", /Unknown claim history schema/);
  rejectsHistory(v => v.history.predecessor_sha256 = "unknown", /64 lowercase hexadecimal/);
  rejectsHistory(v => v.history.reviewed_on = "2027-01-01", /after its record date/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].private_notes = "hidden", /unknown or noncanonical/);
  rejectsHistory(v => v.history.previous_claim_revisions[0].review.independent_review = true, /promotion is unsupported/);
  rejectsHistory(v => v.private_credentials = { secret: "TEST-SENTINEL" }, /History document includes unknown public fields/);
  rejectsHistory(v => v.history.private_notes = "TEST-SENTINEL", /History metadata includes unknown public fields/);
  rejectsHistory(v => v.history.public_release_condition = "", /bounded, nonempty string/);
});
test("history cannot skip an intermediate revision or reintroduce the same version from another file", () => {
  const value = seed(); value.claims[0].revision = 3; assert.throws(() => validateClaimHistory(value, [originalHistory]), /claim-debris-sample@2/);
  assert.throws(() => validateClaimHistory(original, [originalHistory, originalHistory]), /duplicate claim revision/);
});
test("keyword search and request parameters retain bounded read-only behavior", () => {
  assert.equal(searchAtlas(original, { query: "claim-bennu-detection" }).total, 1);
  for (const input of [{ query: "x".repeat(201) }, { query: "x\ny" }, { limit: 0 }, { limit: 51 }, { domain: `domain-${"x".repeat(201)}` }]) assert.throws(() => searchAtlas(original, input), AtlasValidationError);
  for (const query of ["q=x&q=y", "private=true", "limit=1e1", "limit=01"]) assert.throws(() => parseAtlasQuery(new URLSearchParams(query)), AtlasValidationError);
});
test("source workflow invokes both Atlas gates and triggers on validator, tests, npm command and workflow changes", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/validate-graph.yml", import.meta.url), "utf8");
  const sections = workflow.split(/\n  (?:push|pull_request|workflow_dispatch):/);
  for (const section of [sections[1], sections[2]]) for (const path of ["scripts/validate-atlas.mjs", "scripts/tests/atlas-contract.test.mjs", "package.json", ".github/workflows/validate-graph.yml"]) assert(section.includes(`"${path}"`));
  assert(workflow.includes("run: npm run validate:atlas")); assert(workflow.includes("run: npm run test:atlas"));
});
