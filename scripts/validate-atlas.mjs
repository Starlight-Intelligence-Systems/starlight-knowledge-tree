import { readFileSync } from "node:fs";
import { normalizeAtlas, hashAtlasContent, stableJSON } from "../packages/atlas-contract/atlas-core.mjs";
const corpus=JSON.parse(readFileSync(new URL("../data/atlas/corpus.json",import.meta.url),"utf8"));
const canonical=normalizeAtlas(corpus);
if(corpus.projection || stableJSON(corpus)!==stableJSON(canonical)) throw Error("Canonical Atlas includes unknown or reader-only fields.");
console.log(JSON.stringify({schema:canonical.schema_version,status:canonical.status,articles:canonical.articles.length,claims:canonical.claims.length,sources:canonical.sources.length,domains:canonical.domains.length,content_sha256:hashAtlasContent(canonical)}));

