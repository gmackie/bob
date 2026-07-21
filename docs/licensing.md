# Licensing posture

**Status:** Resolved (2026-05-30 BizPulse audit follow-up)  
**SPDX:** `MIT`  
**Copyright:** Gmacko LLC and contributors

## Decision

This monorepo is licensed under the **MIT License** (see root [`LICENSE`](../LICENSE)).

All workspace packages (`apps/*`, `packages/*`, `tooling/*`) and the research-backend Python project declare the same SPDX identifier: `MIT`.

## Why MIT

| Option | Why not / why yes |
|--------|-------------------|
| **GPL-3.0** (historical root on standalone Bob) | Copyleft conflicts with **intended commercial distribution** of products built on or redistributed from this tree. Also conflicted with workspace `package.json` files that already declared MIT. |
| **MIT** (chosen) | Matches existing `@bob/*` package declarations, portfolio peers (create-t3-turbo lineage), and commercial redistribution without forcing derivatives to be GPL. |
| **UNLICENSED / proprietary-only** | Rejected for the open monorepo surface; product-specific closed terms can still wrap hosted services without relicensing the codebase. |

## History of the inconsistency

1. Standalone **Bob** (`bob` package root) declared `"license": "GPL-3.0"` and shipped a full GPL-3.0 `LICENSE` file.
2. Nested Bob packages (`@bob/*`) continued to declare `"license": "MIT"` from the create-t3-turbo / scaffold lineage.
3. When Bob was absorbed into this **gmacko** monorepo, the root GPL file was not carried forward; the root `package.json` had **no** `license` field while many packages still said MIT.

That three-way split (GPL root / MIT packages / missing monorepo license) is what the audit flagged. This change **relicenses and unifies** the tree under MIT.

## Scope

- **In scope:** First-party source under this repository (apps, packages, tooling, scripts, docs).
- **Out of scope:** Third-party dependencies retain their own licenses (see each package’s upstream license). Vendored SPDX headers that are not first-party (e.g. Android `gradlew` Apache-2.0) are unchanged.
- **Contributors:** Code authored under Gmacko LLC control is released under MIT. External third-party code is only present via dependency packages, not as first-party GPL sources.

## Package metadata

- Root: `"license": "MIT"` in [`package.json`](../package.json)
- Every workspace `package.json` must set `"license": "MIT"`
- Python sidecar: `license = "MIT"` in [`packages/research-backend/pyproject.toml`](../packages/research-backend/pyproject.toml)

## Commercial use

MIT permits use, modification, private forks, and commercial distribution (including closed products and hosted SaaS), provided the copyright and permission notice are retained in substantial portions of the Software. No additional commercial license is required for first-party code in this repository.
