import "react-native-gesture-handler";
import * as Sentry from "@sentry/react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, View, Text, ActivityIndicator, StyleSheet, Pressable } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { EnvironmentProvider, useEnvironment } from "./src/lib/environment";
import { AuthProvider, useAuth } from "./src/lib/auth";
import { TRPCProvider, trpc } from "./src/lib/trpc";
import { PostHogProvider } from "./src/lib/posthog";
import { I18nProvider } from "../../packages/i18n/src/native";
import { StoreProvider } from "../../packages/store/src/native";
import { WorkspaceProvider } from "./src/lib/workspace-context";
import { AppNavigator } from "./src/navigation";
import { ThemeProvider, useTheme } from "./src/lib/theme";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableAutoSessionTracking: true,
  attachScreenshot: true,
  attachViewHierarchy: true,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
});

function LoginScreen() {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const { environment, config, setEnvironment } = useEnvironment();

  const handleEnvSwitch = () => {
    setEnvironment(environment === "prod" ? "beta" : "prod");
  };

  return (
    <View style={[styles.centered, styles.paddedContainer, { backgroundColor: colors.background }]}>
      <Text style={[styles.welcomeTitle, { color: colors.text }]}>Welcome to KanBanger</Text>
      <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
        Sign in to manage your tasks
      </Text>
      
      <Pressable
        style={({ pressed }) => [
          styles.signInButton,
          { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }
        ]}
        onPress={() => signIn("entra")}
      >
        <Text style={[styles.signInButtonText, { color: colors.primaryForeground }]}>
          {config.authRequired ? "Sign in with Microsoft" : "Continue as Beta User"}
        </Text>
      </Pressable>

      {__DEV__ && (
        <Pressable
          style={({ pressed }) => [
            styles.envButton,
            { opacity: pressed ? 0.7 : 1 }
          ]}
          onPress={handleEnvSwitch}
        >
          <Text style={[styles.envButtonText, { color: colors.textSecondary }]}>
            Environment: {config.label}
          </Text>
          <Text style={[styles.envButtonHint, { color: colors.textTertiary }]}>
            Tap to switch
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function MainApp() {
  const { userId, isLoading: authLoading, isSignedIn } = useAuth();
  const { colors } = useTheme();

  const { data: workspaces, isLoading: workspacesLoading } = trpc.workspace.list.useQuery(
    undefined,
    { enabled: isSignedIn }
  );

  const workspaceId = workspaces?.[0]?.workspace?.id ?? "";

  const { data: teams, isLoading: teamsLoading } = trpc.team.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId && isSignedIn }
  );

  const firstTeam = teams?.[0];

  console.log("[MainApp] userId:", userId, "isSignedIn:", isSignedIn, "workspaces:", workspaces?.length, "teams:", teams?.length);

  if (authLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
      </View>
    );
  }

  if (!isSignedIn) {
    return <LoginScreen />;
  }

  if (workspacesLoading || teamsLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading workspace...</Text>
      </View>
    );
  }

  if (!workspaceId || !userId) {
    return (
      <View style={[styles.centered, styles.paddedContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.welcomeTitle, { color: colors.text }]}>No Workspace Found</Text>
        <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
          Create a workspace on the web app to get started
        </Text>
      </View>
    );
  }

  return (
    <WorkspaceProvider
      value={{
        workspaceId,
        teamId: firstTeam?.id ?? "",
        teamName: firstTeam?.name ?? "",
        userId,
      }}
    >
      <AppNavigator />
    </WorkspaceProvider>
  );
}

function AppContent() {
  const { colors, isDark } = useTheme();
  
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <MainApp />
        <StatusBar style={isDark ? "light" : "dark"} />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function App() {
  return (
    <EnvironmentProvider>
      <AuthProvider>
        <TRPCProvider>
          <PostHogProvider>
            <I18nProvider>
              <StoreProvider>
                <ThemeProvider>
                  <AppContent />
                </ThemeProvider>
              </StoreProvider>
            </I18nProvider>
          </PostHogProvider>
        </TRPCProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  paddedContainer: {
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 16,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  welcomeSubtitle: {
    textAlign: "center",
    marginTop: 8,
    fontSize: 16,
  },
  signInButton: {
    marginTop: 32,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 200,
    alignItems: "center",
  },
  signInButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  envButton: {
    marginTop: 48,
    paddingVertical: 12,
    alignItems: "center",
  },
  envButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  envButtonHint: {
    fontSize: 12,
    marginTop: 4,
  },
});

import { registerRootComponent } from "expo";

const WrappedApp = Sentry.wrap(App);
registerRootComponent(WrappedApp);

export default WrappedApp;
