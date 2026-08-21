import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Button } from "~/components/ui";
import { getAuthBaseUrl } from "~/config/env";
import { authClient } from "~/utils/auth";
import { parseQrPairingPayload } from "./qr-payload";

interface QrPairingScreenProps {
  onClose: () => void;
  /** Called after a session cookie is stored (QR claim or code approval). */
  onClaimed: () => void;
}

type PairingState =
  | { phase: "scanning" }
  | { phase: "claiming" }
  | { phase: "code"; userCode: string | null; expiresAt: number | null }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 3000;

function formatRenewsIn(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `Code renews automatically in ${m}:${sec}`;
}
/** Roll over to a fresh code this many times (~1h at the server's 10-min TTL). */
const MAX_CODE_RENEWALS = 6;

/**
 * Full-screen pairing flow, modeled on ForgeGraph's working pairing screen.
 *
 * Rendered as a plain view (NOT inside a react-native Modal — CameraView's
 * barcode events silently never fire inside a Modal on iOS). Two paths:
 * - Scan the QR from Bob web's "Link a Device" section, or
 * - Show a typeable ABCD-EFGH code the user approves on Bob web; the app
 *   polls until approval and the claim/poll response's set-cookie is stored
 *   by the @better-auth/expo client, so success IS a real signed-in session.
 */
export function QrPairingScreen({ onClose, onClaimed }: QrPairingScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<PairingState>({ phase: "scanning" });
  // A docked/propped iPad can't point its rear camera at a monitor — the
  // front camera is the natural QR scanner there. Phones default to back.
  const [facing, setFacing] = useState<"front" | "back">(
    Platform.OS === "ios" && Platform.isPad ? "front" : "back",
  );
  // Camera fires onBarcodeScanned repeatedly; only handle the first hit.
  const handledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);
  // Lets the poll loop request a fresh code without referencing the
  // callback before its own declaration.
  const requestAndPollRef = useRef<((renewalsLeft: number) => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // 1s tick so the "renews in m:ss" countdown under the code stays live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.phase !== "code") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  const reset = useCallback(() => {
    handledRef.current = false;
    stopPolling();
    setState({ phase: "scanning" });
  }, [stopPolling]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (handledRef.current) return;
      handledRef.current = true;

      const parsed = parseQrPairingPayload(data, getAuthBaseUrl());
      if (!parsed.ok) {
        setState({
          phase: "error",
          message:
            parsed.reason === "wrong-server"
              ? "That QR code is for a different server."
              : "That doesn't look like a Bob sign-in QR code.",
        });
        return;
      }

      setState({ phase: "claiming" });
      void authClient
        .$fetch("/qr-pairing/claim", {
          method: "POST",
          body: { code: parsed.code },
        })
        .then((result) => {
          if (result.error) {
            setState({
              phase: "error",
              message:
                "That code is invalid or expired. Generate a new one on Bob web and try again.",
            });
            return;
          }
          reset();
          onClaimed();
        })
        .catch(() => {
          setState({
            phase: "error",
            message: "Could not reach the server. Check your connection.",
          });
        });
    },
    [onClaimed, reset],
  );

  /**
   * Request a device code and poll until approval. When a code expires
   * (server says so, or the local deadline passes) we transparently request
   * a fresh one — the user should never be staring at a dead code. Gives up
   * after MAX_CODE_RENEWALS so a forgotten screen doesn't poll forever.
   */
  const requestAndPoll = useCallback(
    (renewalsLeft: number) => {
      stopPolling();
      setState((prev) =>
        prev.phase === "code" ? prev : { phase: "code", userCode: null, expiresAt: null },
      );

      void authClient
        .$fetch("/qr-pairing/request-code", { method: "POST", body: {} })
        .then((result) => {
          const data = result.data as {
            deviceCode?: string;
            userCode?: string;
            expiresIn?: number;
          } | null;
          if (result.error || !data?.deviceCode || !data.userCode) {
            setState({
              phase: "error",
              message: "Could not get a pairing code. Check your connection.",
            });
            return;
          }
          const { deviceCode, userCode } = data;
          const expiresAt = Date.now() + (data.expiresIn ?? 600) * 1000;
          setState({ phase: "code", userCode, expiresAt });

          const renew = () => {
            stopPolling();
            if (renewalsLeft <= 0) {
              setState({
                phase: "error",
                message: "This screen sat idle for a while. Tap below for a fresh code.",
              });
              return;
            }
            requestAndPollRef.current?.(renewalsLeft - 1);
          };

          pollDeadlineRef.current = expiresAt;
          pollTimerRef.current = setInterval(() => {
            if (Date.now() > pollDeadlineRef.current - 5000) {
              renew();
              return;
            }
            void authClient
              .$fetch("/qr-pairing/poll", {
                method: "POST",
                body: { deviceCode },
              })
              .then((poll) => {
                const pollData = poll.data as { status?: string } | null;
                if (pollData?.status === "approved") {
                  stopPolling();
                  reset();
                  onClaimed();
                } else if (pollData?.status === "expired") {
                  renew();
                }
                // pending -> keep polling
              })
              .catch(() => {
                // transient network error -> keep polling until the deadline
              });
          }, POLL_INTERVAL_MS);
        })
        .catch(() => {
          setState({
            phase: "error",
            message: "Could not reach the server. Check your connection.",
          });
        });
    },
    [onClaimed, reset, stopPolling],
  );

  useEffect(() => {
    requestAndPollRef.current = requestAndPoll;
  }, [requestAndPoll]);

  const startCodeFlow = useCallback(() => {
    requestAndPoll(MAX_CODE_RENEWALS);
  }, [requestAndPoll]);

  return (
    <View className="bg-background flex-1 pt-6" testID="qr-pairing-screen">
      <View className="flex-row items-center justify-between px-5 pb-4">
        <Text className="text-foreground text-xl font-semibold">
          {state.phase === "code" ? "Enter code on Bob web" : "Scan QR code"}
        </Text>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close QR scanner"
          className="active:opacity-70 px-2 py-1"
        >
          <Text className="text-muted text-base">Cancel</Text>
        </Pressable>
      </View>

      {state.phase === "code" ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted mb-6 text-center text-sm leading-5">
            On Bob web, open Settings → Link a Device and enter this code:
          </Text>
          <View className="bg-secondary rounded-2xl px-8 py-5">
            <Text
              testID="qr-pairing-user-code"
              className="text-foreground text-center text-4xl font-bold tracking-[8px]"
            >
              {state.userCode ?? "····-····"}
            </Text>
          </View>
          <Text className="text-muted2 mt-6 text-center text-xs">
            Waiting for approval — this signs you in automatically.
          </Text>
          {state.expiresAt ? (
            <Text className="text-muted2 mt-1 text-center text-xs" testID="qr-pairing-countdown">
              {formatRenewsIn(state.expiresAt - now)}
            </Text>
          ) : null}
          <Pressable onPress={reset} className="active:opacity-70 mt-8">
            <Text className="text-muted text-sm underline">
              Scan the QR code instead
            </Text>
          </Pressable>
        </View>
      ) : !permission?.granted ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-foreground mb-4 text-center text-base">
            Bob needs camera access to scan the sign-in code.
          </Text>
          <Button onPress={() => void requestPermission()} variant="primary">
            {permission?.canAskAgain === false
              ? "Enable camera in Settings"
              : "Allow camera access"}
          </Button>
          <Pressable onPress={startCodeFlow} className="active:opacity-70 mt-6">
            <Text className="text-muted text-sm underline">
              Can't scan? Enter a code on the web instead
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          {state.phase !== "error" ? (
            <View className="flex-1">
              <Text className="text-muted px-5 pb-4 text-sm leading-5">
                On Bob web, open Settings → Link a Device and point the camera
                at the QR code.
              </Text>
              <CameraView
                style={{ flex: 1 }}
                facing={facing}
                autofocus="on"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  state.phase === "scanning" ? handleBarcode : undefined
                }
              />
              <View className="flex-row items-center justify-center gap-8 py-4">
                <Pressable
                  onPress={() =>
                    setFacing((f) => (f === "back" ? "front" : "back"))
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Flip camera"
                  className="active:opacity-70"
                >
                  <Text className="text-muted text-sm underline">
                    Flip camera ({facing === "back" ? "rear" : "front"})
                  </Text>
                </Pressable>
                <Pressable onPress={startCodeFlow} className="active:opacity-70">
                  <Text className="text-muted text-sm underline">
                    Use a code instead
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {state.phase === "claiming" ? (
            <View className="absolute inset-0 items-center justify-center bg-black/50">
              <Text className="text-base font-medium text-white">
                Signing in…
              </Text>
            </View>
          ) : null}

          {state.phase === "error" ? (
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-foreground mb-4 text-center text-base">
                {state.message}
              </Text>
              <View className="flex-row gap-3">
                <Button onPress={reset} variant="secondary">
                  Scan again
                </Button>
                <Button onPress={startCodeFlow} variant="secondary">
                  Use a code
                </Button>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
