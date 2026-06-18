"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AuthedOnly, useRpcClient } from "@gmacko/core/app-shell";

function SecretsInner() {
  const client = useRpcClient();
  const qc = useQueryClient();

  const secrets = useQuery({
    queryKey: ["secrets", "list"],
    queryFn: () => client.secrets.list(),
  });

  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const create = useMutation({
    mutationFn: () => client.secrets.create({ name, plaintext }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["secrets", "list"] });
      setName("");
      setPlaintext("");
    },
  });

  return (
    <main style={{ maxWidth: "800px", margin: "2rem auto", padding: "1rem" }}>
      <h1>Secrets</h1>

      <section>
        <h2>Create</h2>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label>
            Name{" "}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Plaintext{" "}
            <input
              type="password"
              value={plaintext}
              onChange={(e) => setPlaintext(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={create.isPending}>Create</button>
          {create.error && <p role="alert">{(create.error as Error).message}</p>}
        </form>
      </section>

      <section>
        <h2>List (envelopes only — no plaintext)</h2>
        {secrets.isLoading && <p>Loading…</p>}
        {secrets.error && <p role="alert">{(secrets.error as Error).message}</p>}
        <ul>
          {secrets.data?.map((s) => (
            <li key={s.id}>
              <code>{s.name}</code> · uses {s.usesRemaining ?? "∞"} · created {new Date(s.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function SecretsPage() {
  return (
    <AuthedOnly>
      <SecretsInner />
    </AuthedOnly>
  );
}
