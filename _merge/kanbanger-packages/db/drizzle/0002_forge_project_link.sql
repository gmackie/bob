ALTER TABLE projects
  ADD COLUMN forge_repository_id uuid;

ALTER TABLE projects
  ADD CONSTRAINT projects_forge_repository_id_forge_repositories_id_fk
  FOREIGN KEY (forge_repository_id) REFERENCES forge_repositories(id) ON DELETE SET NULL;

CREATE INDEX projects_forge_repository_id_idx ON projects USING btree (forge_repository_id);
