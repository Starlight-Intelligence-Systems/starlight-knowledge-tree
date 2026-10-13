# Starlight Atlas source records

This is the authored encyclopedia collection for a checked Atlas feature in the existing Starlight website. Formal portfolio Registry admission remains pending in `frankxai/agentic-ops` PR #231; the protected check has not executed successfully. Five initial entries are editorial research drafts. Evidence standing, inspection scope, versions and uncertainty remain separate from software release state and product registration.

`corpus.json` holds original short paraphrases, atomic claims, source metadata and coverage. `packages/atlas-contract` owns its provider-neutral validation/export contract. The implementation candidate in `frankxai/starlightintelligence.ai` PR #120 consumes a digest-checked projection pinned to a Git commit. Its production deployment must be verified separately before describing the reader as live. This repository's `apps/web` scaffold is not the consuming Starlight website and is not another source authority.

Run `npm run validate:atlas` to reject unsafe sources, dangling citations, duplicate IDs, missing scopes, uninspected metadata used as support, missing or corrupt prior revisions, and silent approval. Run `npm run test:atlas` for the adversarial contract/export/history checks. Both gates run in Validate Graph CI.

## Contribution

Use the Atlas correction issue form for a scoped source or claim improvement. For a PR:

1. Cite an accessible original source and the precise relevant section.
2. Separate the observation from its interpretation; retain limitations and counterevidence.
3. Preserve stable IDs. Increment a changed claim's revision and retain prior text in the revision history.
4. Record publication/version/access dates, source inspection mode and specific rights.
5. Keep authored records public-safe; add no publisher full text, private notes or third-party media.
6. Run graph and Atlas validation. A separate reviewer inspects the exact change before release.

A released reader is not scientific certification. This first editorial-draft contract rejects `independent_review: true`; it does not implement verification of scientific-review receipts. A later revision must model, verify and bind a real receipt to a precise claim/revision before enabling that promotion. Agent agreement or a receipt filename is insufficient. Physical/computational replication and field consensus need their own evidence.

Source update status uses the exact states exported as `ATLAS_SOURCE_UPDATE_STATUSES`; unknown, mixed-case and alias values are rejected. `retracted` and `withdrawn` support requires reassessment to `unresolved` or `contradicted_within_scope`. A detailed correction or version notice belongs in the recorded update-check scope/URL. Inspected arXiv/preprint citations remain separate from journal DOI/date metadata. Markdown and CSL exports retain source rights.

History validation covers its public metadata envelope, retained versions, ownership, references and dates. It checks the predecessor digest's format; it does not reconstruct or cryptographically verify a predecessor snapshot. Compare unchanged retained history and original source bytes through exact Git revisions during review. Do not present a well-formed digest as verified history by itself.

Existing historical source corpora, research methods and authored fictional canon retain their owners. Atlas references those sources rather than relocating them.

Original authored software/documentation records follow the repository MIT license. Source-specific rights remain separate; publication here grants no redistribution rights to third-party material.

