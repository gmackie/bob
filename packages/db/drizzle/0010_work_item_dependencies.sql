CREATE TABLE IF NOT EXISTS work_item_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  depends_on_work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  CONSTRAINT work_item_deps_unique_idx UNIQUE (work_item_id, depends_on_work_item_id),
  CONSTRAINT work_item_deps_no_self_ref CHECK (work_item_id != depends_on_work_item_id)
);

CREATE INDEX IF NOT EXISTS work_item_deps_item_idx ON work_item_dependencies(work_item_id);
CREATE INDEX IF NOT EXISTS work_item_deps_depends_on_idx ON work_item_dependencies(depends_on_work_item_id);
