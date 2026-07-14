import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { createBobRpcClient } from "@gmacko/bob-client";

import { getTabletDashboardHref } from "~/features/tablet/navigation";
import { colors } from "~/lib/colors";
import { signInWithApiKey } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { getDeviceFlowToken, isApiKey, parseQR } from "~/utils/device-auth";

type PairingMode = "choose" | "qr" | "code" | "manual";

const DEVICE_NAME = `Bob Mobile (${Platform.OS})`;

/**
 * Pairing screen — the mobile sign-in surface. No OAuth. Three ways to obtain
 * a Bob API key, all of which end in `signInWithApiKey` + redirect:
 *   - Scan QR:   camera reads {url, token} from the web "Pair mobile device" panel
 *   - Enter Code: RFC 8628 device grant — request a code, approve in browser, poll
 *   - Paste:     paste a bob_/gmk_ API token from Settings → API Keys
 */
export default function PairingScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<PairingMode>("choose");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiToken, setApiToken] = useState("");

  // Device-code flow state
  const [requestingCode, setRequestingCode] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);

  const clearPollTimers = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollIntervalRef.current = null;
    pollTimeoutRef.current = null;
  }, []);

  useEffect(() => clearPollTimers, [clearPollTimers]);

  const finishSignIn = useCallback(
    (token: string) => {
      signInWithApiKey(token);
      router.replace(getTabletDashboardHref() as never);
    },
    [router],
  );

  // Validate a candidate key with a cheap authenticated call before committing
  // it, so a stale QR / mistyped token surfaces here instead of as a broken
  // session inside the app.
  const validateAndSignIn = useCallback(
    async (token: string) => {
      setValidating(true);
      setError(null);
      try {
        const client = createBobRpcClient({
          baseURL: `${getBaseUrl()}/api/rpc`,
          headers: { Authorization: `Bearer ${token}` },
        });
        await client.auth.whoAmI();
        finishSignIn(token);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("UNAUTHORIZED") || message.includes("401")) {
          setError("That key is invalid or expired. Generate a new one.");
        } else {
          setError("Couldn't reach Bob. Check your connection and try again.");
        }
        setValidating(false);
        scanningRef.current = false;
      }
    },
    [finishSignIn],
  );

  // --- Device-authorization grant ---
  const pollForApproval = useCallback(
    (deviceCode: string, intervalSeconds: number) => {
      clearPollTimers();
      const base = getBaseUrl();
      pollIntervalRef.current = setInterval(() => {
        void (async () => {
          try {
            const resp = await fetch(
              `${base}/api/v1/device/token?device_code=${encodeURIComponent(deviceCode)}`,
            );
            const data: unknown = await resp.json();
            const token = getDeviceFlowToken(data);
            if (token) {
              clearPollTimers();
              setPolling(false);
              await validateAndSignIn(token);
            }
          } catch {
            // transient — keep polling
          }
        })();
      }, Math.max(1, intervalSeconds) * 1000);

      // Give up after 15 minutes (server TTL).
      pollTimeoutRef.current = setTimeout(
        () => {
          clearPollTimers();
          setPolling(false);
          setError("That code expired. Request a new one.");
        },
        15 * 60 * 1000,
      );
    },
    [clearPollTimers, validateAndSignIn],
  );

  const startDeviceFlow = useCallback(async () => {
    setError(null);
    setRequestingCode(true);
    try {
      const resp = await fetch(`${getBaseUrl()}/api/v1/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: DEVICE_NAME }),
      });
      if (!resp.ok) throw new Error("Failed to start device flow");
      const data = (await resp.json()) as {
        deviceCode: string;
        userCode: string;
        verificationUrl: string;
        interval?: number;
      };
      setUserCode(data.userCode);
      setVerificationUrl(data.verificationUrl);
      setRequestingCode(false);
      setPolling(true);
      pollForApproval(data.deviceCode, data.interval ?? 5);
    } catch {
      setRequestingCode(false);
      setError("Couldn't reach Bob right now. Try again.");
    }
  }, [pollForApproval]);

  // --- QR scan ---
  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanningRef.current || validating) return;
      const payload = parseQR(data);
      if (!payload) {
        setError("That isn't a Bob pairing QR. Scan the one from Settings.");
        return;
      }
      scanningRef.current = true;
      void validateAndSignIn(payload.token);
    },
    [validateAndSignIn, validating],
  );

  const goChoose = useCallback(() => {
    clearPollTimers();
    setPolling(false);
    setUserCode(null);
    setVerificationUrl(null);
    setError(null);
    scanningRef.current = false;
    setMode("choose");
  }, [clearPollTimers]);

  // --- Choose ---
  if (mode === "choose") {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Connect to Bob</Text>
        <Text style={styles.subtitle}>
          Pair this device with your Bob workspace
        </Text>

        <View style={styles.buttonGroup}>
          <Pressable
            testID="pairing-scan-qr"
            style={styles.primaryButton}
            onPress={async () => {
              setError(null);
              if (!permission?.granted) {
                const result = await requestPermission();
                setMode(result.granted ? "qr" : "code");
                if (!result.granted) void startDeviceFlow();
              } else {
                setMode("qr");
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Scan QR Code</Text>
          </Pressable>

          <Pressable
            testID="pairing-device-code"
            style={styles.secondaryButton}
            onPress={() => {
              setMode("code");
              void startDeviceFlow();
            }}
          >
            <Text style={styles.secondaryButtonText}>Enter a Code</Text>
          </Pressable>

          <Pressable
            testID="pairing-manual"
            style={styles.linkButton}
            onPress={() => {
              setError(null);
              setMode("manual");
            }}
          >
            <Text style={styles.linkText}>Paste API token manually</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    );
  }

  // --- Device code ---
  if (mode === "code") {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Enter Code</Text>

          {userCode ? (
            <>
              <Text style={styles.subtitle}>
                Open Bob on another signed-in device and approve this code:
              </Text>
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{userCode}</Text>
              </View>
              {verificationUrl && (
                <Pressable
                  style={[styles.primaryButton, styles.spacedTop]}
                  onPress={() => void Linking.openURL(verificationUrl)}
                >
                  <Text style={styles.primaryButtonText}>Open in Browser</Text>
                </Pressable>
              )}
              {polling && (
                <View style={styles.pollingRow}>
                  <ActivityIndicator color={colors.muted} size="small" />
                  <Text style={styles.mutedText}>Waiting for approval…</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.spacedTop}>
              <Text style={styles.subtitle}>
                Request a one-time sign-in code from Bob.
              </Text>
              <Pressable
                testID="code-get-code"
                style={[styles.primaryButton, styles.spacedTop]}
                onPress={() => void startDeviceFlow()}
                disabled={requestingCode}
              >
                {requestingCode ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.primaryButtonText}>Get Code</Text>
                )}
              </Pressable>
            </View>
          )}

          {validating && (
            <View style={styles.pollingRow}>
              <ActivityIndicator color={colors.muted} size="small" />
              <Text style={styles.mutedText}>Signing in…</Text>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            testID="code-back"
            style={styles.linkButton}
            onPress={goChoose}
          >
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- Manual paste ---
  if (mode === "manual") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Paste API Token</Text>
          <Text style={styles.subtitle}>
            Paste a token from Settings → API Keys on the web app.
          </Text>

          <View style={styles.form}>
            <Text style={styles.fieldLabel}>API Token</Text>
            <TextInput
              testID="manual-api-token"
              style={styles.input}
              value={apiToken}
              onChangeText={setApiToken}
              placeholder="bob_…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              testID="manual-connect"
              style={[
                styles.primaryButton,
                styles.spacedTop,
                (!isApiKey(apiToken) || validating) && styles.disabled,
              ]}
              disabled={!isApiKey(apiToken) || validating}
              onPress={() => void validateAndSignIn(apiToken.trim())}
            >
              {validating ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>Connect</Text>
              )}
            </Pressable>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            testID="manual-back"
            style={styles.linkButton}
            onPress={goChoose}
          >
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // --- QR scan ---
  return (
    <View style={styles.container}>
      <CameraView
        testID="qr-camera"
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={styles.cameraOverlay}>
        {validating ? (
          <View style={styles.validatingBox}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.mutedText}>Signing in…</Text>
          </View>
        ) : (
          <View style={styles.crosshair}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        )}
      </View>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
      <Pressable
        testID="qr-cancel"
        style={styles.cancelButton}
        onPress={goChoose}
      >
        <Text style={styles.secondaryButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const CROSSHAIR_SIZE = 220;
const CORNER_SIZE = 32;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "700" },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
    marginTop: 8,
  },
  mutedText: { color: colors.muted, fontSize: 13 },
  buttonGroup: {
    marginTop: 32,
    width: "100%",
    gap: 12,
    alignItems: "center",
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
  },
  secondaryButtonText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "600",
  },
  linkButton: { marginTop: 16, padding: 8 },
  linkText: { color: colors.muted, fontSize: 14 },
  spacedTop: { marginTop: 16 },
  disabled: { opacity: 0.5 },
  form: { marginTop: 24, width: "100%" },
  fieldLabel: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    color: colors.foreground,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.card,
  },
  codeBox: {
    marginTop: 20,
    paddingVertical: 20,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  codeText: {
    color: colors.foreground,
    fontSize: 32,
    letterSpacing: 6,
    fontWeight: "700",
  },
  pollingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: 12, textAlign: "center" },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  crosshair: { width: CROSSHAIR_SIZE, height: CROSSHAIR_SIZE },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.white,
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  validatingBox: {
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.background,
  },
  errorBar: {
    position: "absolute",
    bottom: 88,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  cancelButton: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.cardElevated,
  },
});
