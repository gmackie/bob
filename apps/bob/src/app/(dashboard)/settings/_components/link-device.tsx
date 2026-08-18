"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@gmacko/core/ui/button";

type PairingStatus = "idle" | "pending" | "claimed" | "expired" | "error";

interface CreateResponse {
  code: string;
  expiresIn: number;
}

const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * "Link a device" — renders a one-time QR pairing code the Bob mobile app
 * scans to sign in as the current user. Backed by the qr-pairing better-auth
 * plugin: /api/auth/qr-pairing/{create,status}. The code is single-use and
 * expires after ~2 minutes; polling flips the UI to "linked" once the phone
 * claims it.
 */
export function LinkDeviceSection() {
  const [status, setStatus] = useState<PairingStatus>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const generateCode = useCallback(async () => {
    stopPolling();
    setStatus("pending");
    setCode(null);
    try {
      const res = await fetch("/api/auth/qr-pairing/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const data = (await res.json()) as CreateResponse;
      setCode(data.code);
      setExpiresIn(data.expiresIn);
    } catch {
      setStatus("error");
    }
  }, [stopPolling]);

  // Poll status while a code is pending.
  useEffect(() => {
    if (!code || status !== "pending") return;

    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/auth/qr-pairing/status", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            status: "pending" | "claimed" | "expired";
          };
          if (data.status === "claimed") {
            setStatus("claimed");
            stopPolling();
          } else if (data.status === "expired") {
            setStatus("expired");
            stopPolling();
          }
        } catch {
          // transient network error — keep polling
        }
      })();
    }, STATUS_POLL_INTERVAL_MS);

    return stopPolling;
  }, [code, status, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const qrPayload =
    code === null
      ? null
      : JSON.stringify({ v: 1, url: window.location.origin, code });

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        Sign in on the Bob mobile app by scanning a QR code. Open the app,
        choose <span className="text-foreground">Scan QR code</span> on the
        sign-in screen, and point the camera here. Codes are single-use and
        expire after {expiresIn > 0 ? Math.round(expiresIn / 60) : 2} minutes.
      </p>

      {status === "idle" && (
        <Button onClick={() => void generateCode()}>Generate QR code</Button>
      )}

      {status === "pending" && qrPayload && (
        <div className="flex flex-col items-start gap-4">
          <div className="rounded-xl border border-border bg-white p-4">
            <QRCode value={qrPayload} size={220} />
          </div>
          <div className="text-xs text-muted-foreground">
            Waiting for a device to scan…
          </div>
        </div>
      )}

      {status === "pending" && !qrPayload && (
        <div className="text-sm text-muted-foreground">Generating…</div>
      )}

      {status === "claimed" && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">
            Device linked ✓
          </div>
          <Button variant="outline" onClick={() => void generateCode()}>
            Link another device
          </Button>
        </div>
      )}

      {status === "expired" && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            That code expired before it was scanned.
          </div>
          <Button onClick={() => void generateCode()}>
            Generate a new code
          </Button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Could not create a pairing code. Are you signed in?
          </div>
          <Button onClick={() => void generateCode()}>Try again</Button>
        </div>
      )}
    </div>
  );
}
