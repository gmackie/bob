"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import QRCode from "react-qr-code";

import { Button } from "@gmacko/core/ui/button";

import { useBobRpcClient } from "~/rpc/react";

/**
 * Pair a mobile device. Mints a read+write API key (the permission set the WS
 * gateway's validateBrowserToken requires) and renders it as a QR encoding
 * `{ url, token }` — the exact payload the Bob mobile app's "Scan QR Code"
 * pairing screen expects. The key is shown once; scanning it signs the device
 * in with no OAuth round-trip.
 */
export function DevicePairingSection() {
  const rpc = useBobRpcClient();
  const [pairing, setPairing] = useState<{ url: string; token: string } | null>(
    null,
  );

  const createKey = useMutation({
    mutationFn: () =>
      rpc.settings.createApiKey({
        name: `Bob Mobile (paired ${new Date().toISOString().slice(0, 10)})`,
        permissions: ["read", "write"],
      }) as Promise<{ key: string }>,
    onSuccess: (data) => {
      setPairing({ url: window.location.origin, token: data.key });
    },
  });

  return (
    <section className="rounded-lg border p-6">
      <p className="mb-1 text-sm text-muted-foreground">
        Open Bob on your phone, choose <strong>Scan QR Code</strong>, and point
        it at the code below. The device signs in instantly — no password or
        OAuth.
      </p>

      {!pairing && (
        <Button
          className="mt-3"
          onClick={() => createKey.mutate()}
          disabled={createKey.isPending}
        >
          {createKey.isPending ? "Generating…" : "Generate pairing QR"}
        </Button>
      )}

      {createKey.error && (
        <p className="mt-3 text-sm text-red-600">
          {(createKey.error as Error).message}
        </p>
      )}

      {pairing && (
        <div className="mt-4 rounded-lg border border-green-500 bg-green-50 p-4 dark:bg-green-950">
          <p className="mb-1 font-medium text-green-800 dark:text-green-200">
            Scan this on your phone
          </p>
          <p className="mb-4 text-sm text-green-700 dark:text-green-300">
            This code contains a live API key and is shown once. Scan it now or
            revoke it under API Keys if it leaks.
          </p>

          {/* White pad — QR scanners need high contrast regardless of theme. */}
          <div className="inline-block rounded-lg bg-white p-4">
            <QRCode value={JSON.stringify(pairing)} size={196} />
          </div>

          <div className="mt-4 flex gap-2">
            <code className="flex-1 truncate rounded bg-white p-2 font-mono text-xs dark:bg-gray-900">
              {pairing.token}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(pairing.token)}
            >
              Copy token
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setPairing(null)}
          >
            Done
          </Button>
        </div>
      )}
    </section>
  );
}
