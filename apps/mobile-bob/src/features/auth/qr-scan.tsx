import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
  | { phase: "code"; userCode: string | null }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

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
  // Camera fires onBarcodeScanned repeatedly; only handle the first hit.
  const handledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

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

  const startCodeFlow = useCallback(() => {
    stopPolling();
    setState({ phase: "code", userCode: null });

    void authClient
      .$fetch("/qr-pairing/request-code", { method: "POST", body: {} })
      .then((result) => {
        const data = result.data as {
          deviceCode?: string;
          userCode?: string;
        } | null;
        if (result.error || !data?.deviceCode || !data.userCode) {
          setState({
            phase: "error",
            message: "Could not get a pairing code. Check your connection.",
          });
          return;
        }
        const { deviceCode, userCode } = data;
        setState({ phase: "code", userCode });

        pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
        pollTimerRef.current = setInterval(() => {
          if (Date.now() > pollDeadlineRef.current) {
            stopPolling();
            setState({
              phase: "error",
              message: "The code expired. Get a new one and try again.",
            });
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
                stopPolling();
                setState({
                  phase: "error",
                  message: "The code expired. Get a new one and try again.",
                });
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
  }, [onClaimed, reset, stopPolling]);

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
                facing="back"
                autofocus="on"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  state.phase === "scanning" ? handleBarcode : undefined
                }
              />
              <View className="items-center py-4">
                <Pressable onPress={startCodeFlow} className="active:opacity-70">
                  <Text className="text-muted text-sm underline">
                    Can't scan? Enter a code on the web instead
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
