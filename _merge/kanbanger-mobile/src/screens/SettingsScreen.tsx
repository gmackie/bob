import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useAuth } from "../lib/auth";
import { useEnvironment, ENVIRONMENTS, type Environment } from "../lib/environment";
import { trpc } from "../lib/trpc";
import {
  Avatar,
  AvatarFallback,
  AvatarFallbackText,
  AvatarImage,
  Button,
  ButtonText,
  Input,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@linear-clone/ui-native";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const { colors, isDark, toggleTheme, scheme, setScheme } = useTheme();
  const { environment, config, setEnvironment } = useEnvironment();

  const { data: user, isLoading: userLoading } = trpc.user.me.useQuery();
  const updateProfileMutation = trpc.user.updateProfile.useMutation();
  const utils = trpc.useUtils();

  const [displayName, setDisplayName] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const [pushEnabled, setPushEnabled] = useState(true);
  const [notifyAssigned, setNotifyAssigned] = useState(true);
  const [notifyComments, setNotifyComments] = useState(true);
  const [notifyMentions, setNotifyMentions] = useState(true);

  useEffect(() => {
    if (user?.name) {
      setDisplayName(user.name);
    }
  }, [user?.name]);

  useEffect(() => {
    setHasChanges(displayName !== (user?.name ?? ""));
  }, [displayName, user?.name]);

  const handleSave = async () => {
    if (!hasChanges) return;
    try {
      await updateProfileMutation.mutateAsync({ name: displayName });
      utils.user.me.invalidate();
      Alert.alert("Success", "Profile updated successfully");
    } catch {
      Alert.alert("Error", "Failed to update profile");
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  };

  if (userLoading) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[tw("mt-4"), { color: colors.textSecondary }]}>Loading settings...</Text>
      </View>
    );
  }

  const userEmail = user?.email ?? "";
  const userAvatar = user?.avatarUrl ?? "";
  const initials =
    displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <ScrollView style={[tw("flex-1"), { backgroundColor: colors.background }]} testID="settings-screen">
      <View style={tw("p-4 gap-6")}>
        <View>
          <CardTitle testID="settings-header" style={{ fontSize: 30, color: colors.text }}>Settings</CardTitle>
          <CardDescription style={{ color: colors.textSecondary }}>
            Manage your profile and preferences
          </CardDescription>
        </View>

        <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <CardHeader style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Avatar style={{ height: 64, width: 64 }}>
              {userAvatar ? <AvatarImage src={userAvatar} /> : null}
              <AvatarFallback style={{ backgroundColor: isDark ? colors["indigo-900"] : colors["indigo-100"] }}>
                <AvatarFallbackText style={{ color: isDark ? colors["indigo-300"] : colors["indigo-600"] }}>{initials}</AvatarFallbackText>
              </AvatarFallback>
            </Avatar>
            <View style={tw("flex-1")}>
              <CardTitle style={{ color: colors.text }}>{displayName || "User"}</CardTitle>
              <CardDescription style={{ color: colors.textSecondary }}>{userEmail}</CardDescription>
            </View>
          </CardHeader>
          <Separator style={{ backgroundColor: colors.border }} />
          <CardContent style={{ gap: 16, paddingTop: 24 }}>
            <View style={tw("gap-2")}>
              <Text style={[tw("text-sm font-medium"), { color: colors.textSecondary }]}>
                Display Name
              </Text>
              <Input
                placeholder="Enter your name"
                placeholderTextColor={colors.textTertiary}
                value={displayName}
                onChangeText={setDisplayName}
                style={{ color: colors.text, borderColor: colors.border, backgroundColor: isDark ? colors.surfaceHighlight : colors.surface }}
              />
            </View>
            <View style={tw("gap-2")}>
              <Text style={[tw("text-sm font-medium"), { color: colors.textSecondary }]}>
                Email Address
              </Text>
              <Input
                placeholder="Email address"
                value={userEmail}
                editable={false}
                style={{ backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"], color: colors.textSecondary, borderColor: colors.border }}
                keyboardType="email-address"
              />
            </View>

            {hasChanges && (
              <Button
                style={{ marginTop: 8, backgroundColor: colors.primary }}
                onPress={handleSave}
                disabled={updateProfileMutation.isPending}
              >
                <ButtonText style={{ color: colors.primaryForeground }}>
                  {updateProfileMutation.isPending
                    ? "Saving..."
                    : "Save Changes"}
                </ButtonText>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <CardHeader>
            <CardTitle style={{ color: colors.text }}>Appearance</CardTitle>
            <CardDescription style={{ color: colors.textSecondary }}>
              Customize the app theme
            </CardDescription>
          </CardHeader>
          <CardContent style={{ gap: 16 }}>
            <View style={tw("flex-row items-center justify-between")}>
              <View style={tw("flex-1")}>
                <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                  Theme
                </Text>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                  {scheme === "system" ? "Using system preference" : scheme === "dark" ? "Dark mode" : "Light mode"}
                </Text>
              </View>
              <View style={tw("flex-row gap-2")}>
                 <Pressable onPress={() => setScheme("light")} style={[tw("px-3 py-2 rounded border"), { backgroundColor: scheme === "light" ? colors.primary : colors.surface, borderColor: colors.border }]}>
                    <Text style={{ color: scheme === "light" ? colors.primaryForeground : colors.text }}>Light</Text>
                 </Pressable>
                 <Pressable onPress={() => setScheme("dark")} style={[tw("px-3 py-2 rounded border"), { backgroundColor: scheme === "dark" ? colors.primary : colors.surface, borderColor: colors.border }]}>
                    <Text style={{ color: scheme === "dark" ? colors.primaryForeground : colors.text }}>Dark</Text>
                 </Pressable>
                 <Pressable onPress={() => setScheme("system")} style={[tw("px-3 py-2 rounded border"), { backgroundColor: scheme === "system" ? colors.primary : colors.surface, borderColor: colors.border }]}>
                    <Text style={{ color: scheme === "system" ? colors.primaryForeground : colors.text }}>System</Text>
                 </Pressable>
              </View>
            </View>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <CardHeader>
            <CardTitle style={{ color: colors.text }}>Notifications</CardTitle>
            <CardDescription style={{ color: colors.textSecondary }}>
              Configure how you receive notifications
            </CardDescription>
          </CardHeader>
          <CardContent style={{ gap: 16 }}>
            <View style={tw("flex-row items-center justify-between")}>
              <View style={tw("flex-1")}>
                <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                  Push Notifications
                </Text>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                  Enable all push notifications
                </Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={setPushEnabled}
                trackColor={{ false: colors["gray-300"], true: colors.primary }}
                thumbColor={colors.white}
              />
            </View>

            {pushEnabled && (
              <>
                <Separator style={{ backgroundColor: colors.border }} />

                <View style={tw("flex-row items-center justify-between")}>
                  <View style={tw("flex-1")}>
                    <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                      Assigned to me
                    </Text>
                    <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                      When an issue is assigned to you
                    </Text>
                  </View>
                  <Switch
                    value={notifyAssigned}
                    onValueChange={setNotifyAssigned}
                    trackColor={{ false: colors["gray-300"], true: colors.primary }}
                    thumbColor={colors.white}
                  />
                </View>

                <View style={tw("flex-row items-center justify-between")}>
                  <View style={tw("flex-1")}>
                    <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                      Comments
                    </Text>
                    <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                      When someone comments on your issues
                    </Text>
                  </View>
                  <Switch
                    value={notifyComments}
                    onValueChange={setNotifyComments}
                    trackColor={{ false: colors["gray-300"], true: colors.primary }}
                    thumbColor={colors.white}
                  />
                </View>

                <View style={tw("flex-row items-center justify-between")}>
                  <View style={tw("flex-1")}>
                    <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                      Mentions
                    </Text>
                    <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                      When someone mentions you
                    </Text>
                  </View>
                  <Switch
                    value={notifyMentions}
                    onValueChange={setNotifyMentions}
                    trackColor={{ false: colors["gray-300"], true: colors.primary }}
                    thumbColor={colors.white}
                  />
                </View>
              </>
            )}
          </CardContent>
        </Card>

        {__DEV__ && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <CardTitle style={{ color: colors.text }}>Developer Options</CardTitle>
              <CardDescription style={{ color: colors.textSecondary }}>
                Switch between environments
              </CardDescription>
            </CardHeader>
            <CardContent style={{ gap: 16 }}>
              <View style={tw("flex-row items-center justify-between")}>
                <View style={tw("flex-1")}>
                  <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                    Environment
                  </Text>
                  <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                    {config.apiUrl}
                  </Text>
                </View>
                <View style={tw("flex-row gap-2")}>
                  {(Object.keys(ENVIRONMENTS) as Environment[]).map((env) => (
                    <Pressable
                      key={env}
                      onPress={() => {
                        Alert.alert(
                          "Switch Environment",
                          `Switch to ${ENVIRONMENTS[env].label}? You will be signed out.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Switch",
                              onPress: async () => {
                                await signOut();
                                await setEnvironment(env);
                              },
                            },
                          ]
                        );
                      }}
                      style={[
                        tw("px-3 py-2 rounded border"),
                        {
                          backgroundColor: environment === env ? colors.primary : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: environment === env ? colors.primaryForeground : colors.text,
                          fontSize: 12,
                          fontWeight: "500",
                        }}
                      >
                        {env === "beta" ? "Beta" : "Prod"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </CardContent>
          </Card>
        )}

        <Button variant="destructive" style={{ marginTop: 16 }} onPress={handleSignOut}>
          <ButtonText>Sign Out</ButtonText>
        </Button>
      </View>
    </ScrollView>
  );
}
