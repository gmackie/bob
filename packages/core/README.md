# @gmacko/core

Shared platform code consumed by every gmacko app. Populated incrementally
across the Phase 7B-0 consolidation batches; the seven existing
infrastructure packages (validators, config, db, auth, contracts, ui, etc.)
move under this package as subpath exports.

The root barrel intentionally exposes nothing. Consumers import from
specific subpaths (`@gmacko/core/auth`, `@gmacko/core/db`, ...) so
tree-shaking and dependency tracking stay accurate.
