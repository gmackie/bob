import { useCallback, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Button } from "~/components/ui";
import { getAuthBaseUrl } from "~/config/env";
import { authClient } from "~/utils/auth";
import { parseQrPairingPayload } from "./qr-payload";

interface QrScanModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called after the pairing code is claimed and the session cookie stored. */
  onClaimed: () => void;
}

type ScanState =
  | { phase: "scanning" }
  | { phase: "claiming" }
  | { phase: "error"; message: string };

/**
 * Full-screen camera modal that scans the QR pairing code rendered by Bob
 * web's "Link a Device" section and claims it via the qr-pairing better-auth
 * endpoint. The claim response's set-cookie is persisted by the
 * @better-auth/expo client, so a successful claim IS a real signed-in
 * session — callers just refetch useSession().
 */
export function QrScanModal({ visible, onClose, onClaimed }: QrScanModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ phase: "scanning" });
  // Camera fires onBarcodeScanned repeatedly; only handle the first hit.
  const handledRef = useRef(false);

  const reset = useCallback(() => {
    handledRef.current = false;
    setState({ phase: "scanning" });
  }, []);

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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="bg-background flex-1 pt-6">
        <View className="flex-row items-center justify-between px-5 pb-4">
          <Text className="text-foreground text-xl font-semibold">
            Scan QR code
          </Text>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close QR scanner"
            className="active:opacity-70"
          >
            <Text className="text-muted text-base">Close</Text>
          </Pressable>
        </View>

        <Text className="text-muted px-5 pb-4 text-sm leading-5">
          On Bob web, open Settings → Link a Device and point the camera at the
          QR code.
        </Text>

        {!permission?.granted ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-foreground mb-4 text-center text-base">
              Bob needs camera access to scan the sign-in code.
            </Text>
            <Button onPress={() => void requestPermission()} variant="primary">
              {permission?.canAskAgain === false
                ? "Enable camera in Settings"
                : "Allow camera access"}
            </Button>
          </View>
        ) : (
          <View className="flex-1">
            {state.phase !== "error" ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  state.phase === "scanning" ? handleBarcode : undefined
                }
              />
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
                <Button onPress={reset} variant="secondary">
                  Scan again
                </Button>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
