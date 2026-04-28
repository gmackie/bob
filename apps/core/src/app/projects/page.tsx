"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AuthedOnly, useRpcClient } from "@gmacko/core/app-shell";

function ProjectsInner() {
  const client = useRpcClient();
  const qc = useQueryClient();

  const projects = useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => client.projects.list(),
  });

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => client.projects.create({ slug, name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects", "list"] });
      setSlug("");
      setName("");
    },
  });

  return (
    <main style={{ maxWidth: "800px", margin: "2rem auto", padding: "1rem" }}>
      <h1>Projects</h1>

      <section>
        <h2>Create</h2>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label>
            Slug{" "}
            <input value={slug} onChange={(e) => setSlug(e.target.value)} required />
          </label>
          <label>
            Name{" "}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" disabled={create.isPending}>Create</button>
          {create.error && <p role="alert">{(create.error as Error).message}</p>}
        </form>
      </section>

      <section>
        <h2>List</h2>
        {projects.isLoading && <p>Loading…</p>}
        {projects.error && <p role="alert">{(projects.error as Error).message}</p>}
        <ul>
          {projects.data?.map((p) => (
            <li key={p.id}>
              <code>{p.slug}</code> — {p.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <AuthedOnly>
      <ProjectsInner />
    </AuthedOnly>
  );
}
