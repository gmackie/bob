import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";


import { assertDefined } from "~/lib/assert";
import { colors } from "~/lib/colors";
import type { VaultBrowserHook, VaultKind } from "../hooks/use-vault-browser";

interface VaultBrowserProps {
  vault: VaultBrowserHook;
  visible: boolean;
  onClose: () => void;
}

function groupByThread(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split("/");
    const thread = parts.length >= 3 ? assertDefined(parts[1]) : "(root)";
    const existing = groups.get(thread) ?? [];
    existing.push(file);
    groups.set(thread, existing);
  }
  return groups;
}

function noteName(path: string): string {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? path;
  return filename.replace(/\.md$/, "");
}

function VaultKindToggle({
  kind,
  onChange,
}: {
  kind: VaultKind;
  onChange: (kind: VaultKind) => void;
}) {
  return (
    <View className="border-border flex-row rounded-lg border p-0.5">
      {(["personal", "research"] as const).map((k) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          className={`rounded-md px-3 py-1.5 ${k === kind ? "bg-primary" : ""}`}
        >
          <Text
            className="text-xs font-semibold capitalize"
            style={{ color: k === kind ? colors.primaryForeground : colors.muted }}
          >
            {k}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function NoteDetail({
  file,
  onBack,
}: {
  file: NonNullable<VaultBrowserHook["selectedFile"]>;
  onBack: () => void;
}) {
  return (
    <View className="flex-1">
      <View className="mb-4 flex-row items-center gap-3">
        <Pressable onPress={onBack} className="active:opacity-70">
          <Text className="text-base font-semibold text-accent">
            Back
          </Text>
        </Pressable>
        <Text
          className="flex-1 text-base font-semibold text-foreground"
          numberOfLines={1}
        >
          {file.name}
        </Text>
      </View>

      {file.frontmatter ? (
        <View className="border-border mb-3 rounded-xl border bg-card px-3 py-2">
          {Object.entries(file.frontmatter).map(([key, value]) => (
            <View key={key} className="flex-row gap-2 py-0.5">
              <Text className="text-xs font-semibold text-muted">
                {key}:
              </Text>
              <Text className="flex-1 text-xs text-secondary-foreground">
                {String(value)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Text className="text-sm leading-6 text-secondary-foreground">
          {file.content}
        </Text>
      </ScrollView>
    </View>
  );
}

export function VaultBrowser({ vault, visible, onClose }: VaultBrowserProps) {
  const grouped = groupByThread(vault.files);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background pt-6 px-5">
        <View className="mb-5 flex-row items-center justify-between">
          <Text className="text-xl font-semibold text-foreground">
            Vault
          </Text>
          <View className="flex-row items-center gap-3">
            <VaultKindToggle kind={vault.vaultKind} onChange={vault.setVaultKind} />
            <Pressable onPress={onClose} className="active:opacity-70">
              <Text className="text-base font-semibold text-muted">
                Done
              </Text>
            </Pressable>
          </View>
        </View>

        {vault.error ? (
          <View className="border-border mb-3 rounded-xl border bg-card px-4 py-3">
            <Text className="text-xs text-danger">
              {vault.error}
            </Text>
          </View>
        ) : null}

        {vault.selectedFile ? (
          <NoteDetail file={vault.selectedFile} onBack={vault.clearSelection} />
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {vault.isLoadingFiles ? (
              <Text className="text-center text-sm text-muted">
                Loading vault...
              </Text>
            ) : vault.files.length === 0 ? (
              <Text className="text-center text-sm text-muted">
                No notes in {vault.vaultKind} vault.
              </Text>
            ) : (
              Array.from(grouped.entries()).map(([thread, files]) => (
                <View key={thread} className="mb-5">
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    {thread}
                  </Text>
                  {files.map((file) => (
                    <Pressable
                      key={file}
                      onPress={() => vault.selectFile(file)}
                      className="border-border mb-1.5 rounded-xl border bg-card px-4 py-3 active:opacity-80"
                    >
                      <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={1}
                      >
                        {noteName(file)}
                      </Text>
                      <Text
                        className="mt-0.5 text-xs text-muted2"
                        numberOfLines={1}
                      >
                        {file}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
