import type { ErrorInfo, ReactNode } from "react";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import { Component, useCallback, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";

import type { MarkdownBlock } from "./markdown-model";
import type { MarkdownTheme } from "./markdown-theme";
import { CodeViewer } from "~/components/tablet/CodeViewer";
import { colors } from "~/lib/colors";
import { normalizeLinkUrl, splitMarkdownBlocks } from "./markdown-model";
import { createMarkdownTheme } from "./markdown-theme";

export interface MarkdownViewerProps {
  source: string;
  /** Called when the user long-presses a top-level block (for quote-reply). */
  onSelectBlock?: (block: MarkdownBlock) => void;
  /** Optional override; default opens an in-app browser sheet. */
  onLinkPress?: (url: string) => boolean | void;
  /** Slightly smaller type for cards. */
  compact?: boolean;
  testID?: string;
}

const CODE_MAX_HEIGHT = 320;
const IMAGE_FALLBACK_HEIGHT = 200;

function stripTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

/**
 * The library's ASTNode typing omits `sourceInfo` (the fence info string,
 * e.g. "ts"), but tokensToAST always sets it from `token.info`.
 */
function fenceLanguage(node: ASTNode): string {
  const info = (node as ASTNode & { sourceInfo?: unknown }).sourceInfo;
  const lang =
    typeof info === "string" ? info.trim().split(/\s+/)[0] : undefined;
  return lang !== undefined && lang.length > 0 ? lang : "txt";
}

function FenceBlock({ node, theme }: { node: ASTNode; theme: MarkdownTheme }) {
  const [copied, setCopied] = useState(false);
  const content = stripTrailingNewline(node.content);
  const lang = fenceLanguage(node);

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard failures are non-fatal.
      });
  }, [content]);

  return (
    <View
      style={{
        maxHeight: CODE_MAX_HEIGHT,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: theme.fence.marginBottom,
      }}
    >
      <CodeViewer content={content} filePath={`snippet.${lang}`} />
      <Pressable
        onPress={handleCopy}
        accessibilityRole="button"
        accessibilityLabel="Copy code"
        hitSlop={8}
        style={({ pressed }) => ({
          position: "absolute",
          top: 4,
          right: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 4,
          backgroundColor: pressed ? colors.secondary : colors.cardElevated,
          borderWidth: 1,
          borderColor: colors.border,
        })}
      >
        <Text
          style={{
            color: copied ? colors.success : colors.secondaryForeground,
            fontSize: 11,
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Text>
      </Pressable>
    </View>
  );
}

function MarkdownImage({
  node,
  theme,
}: {
  node: ASTNode;
  theme: MarkdownTheme;
}) {
  const attrs = node.attributes as { src?: unknown; alt?: unknown };
  const src =
    typeof attrs.src === "string" ? normalizeLinkUrl(attrs.src) : null;
  const alt = typeof attrs.alt === "string" ? attrs.alt : undefined;
  if (src === null) return null;
  return (
    <Image
      source={{ uri: src }}
      resizeMode="contain"
      accessible={alt !== undefined}
      accessibilityLabel={alt}
      style={[theme.image, { width: "100%", height: IMAGE_FALLBACK_HEIGHT }]}
    />
  );
}

function buildRules(theme: MarkdownTheme): RenderRules {
  return {
    fence: (node) => <FenceBlock key={node.key} node={node} theme={theme} />,
    table: (node, children) => (
      <ScrollView
        key={node.key}
        horizontal
        showsHorizontalScrollIndicator
        style={{ marginBottom: theme.table.marginBottom }}
      >
        <View style={[theme.table, { marginBottom: 0 }]}>{children}</View>
      </ScrollView>
    ),
    image: (node) => <MarkdownImage key={node.key} node={node} theme={theme} />,
  };
}

function openInAppBrowser(url: string) {
  WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  }).catch(() => {
    // Browser failures are non-fatal.
  });
}

function PlainFallback({
  source,
  testID,
}: {
  source: string;
  testID?: string;
}) {
  return (
    <Text
      selectable
      testID={testID}
      style={{ color: colors.foreground, fontSize: 16, lineHeight: 24 }}
    >
      {source}
    </Text>
  );
}

interface MarkdownErrorBoundaryProps {
  source: string;
  testID?: string;
  children: ReactNode;
}

interface MarkdownErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches parser/render errors from the markdown library so weird agent
 * output degrades to selectable plain text instead of crashing the thread.
 */
class MarkdownErrorBoundary extends Component<
  MarkdownErrorBoundaryProps,
  MarkdownErrorBoundaryState
> {
  state: MarkdownErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(prevProps: MarkdownErrorBoundaryProps) {
    if (this.state.failed && prevProps.source !== this.props.source) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.warn(
        "MarkdownViewer: falling back to plain text",
        error,
        info.componentStack,
      );
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <PlainFallback source={this.props.source} testID={this.props.testID} />
      );
    }
    return this.props.children;
  }
}

/** Renders one markdown string, falling back to plain text if the parser throws. */
function SafeMarkdown({
  source,
  theme,
  rules,
  onLinkPress,
  testID,
}: {
  source: string;
  theme: MarkdownTheme;
  rules: RenderRules;
  onLinkPress: (url: string) => boolean;
  testID?: string;
}) {
  return (
    <MarkdownErrorBoundary source={source} testID={testID}>
      <View testID={testID}>
        <Markdown style={theme} rules={rules} onLinkPress={onLinkPress}>
          {source}
        </Markdown>
      </View>
    </MarkdownErrorBoundary>
  );
}

export function MarkdownViewer({
  source,
  onSelectBlock,
  onLinkPress,
  compact = false,
  testID,
}: MarkdownViewerProps) {
  const theme = useMemo(() => createMarkdownTheme({ compact }), [compact]);
  const rules = useMemo(() => buildRules(theme), [theme]);

  const handleLinkPress = useCallback(
    (href: string): boolean => {
      const url = normalizeLinkUrl(href);
      if (url === null) return false;
      if (onLinkPress) {
        const handled = onLinkPress(url);
        // An explicit `true` asks the library to perform its default Linking.openURL.
        return handled === true;
      }
      openInAppBrowser(url);
      return false;
    },
    [onLinkPress],
  );

  const blocks = useMemo(
    () => (onSelectBlock ? splitMarkdownBlocks(source) : null),
    [onSelectBlock, source],
  );

  if (blocks === null) {
    return (
      <View accessibilityRole="text" testID={testID}>
        <SafeMarkdown
          source={source}
          theme={theme}
          rules={rules}
          onLinkPress={handleLinkPress}
        />
      </View>
    );
  }

  return (
    <View accessibilityRole="text" testID={testID}>
      {blocks.map((block) => (
        <Pressable
          key={block.id}
          onLongPress={() => onSelectBlock?.(block)}
          delayLongPress={350}
          accessibilityHint="Long press to quote this block"
          testID={testID ? `${testID}-${block.id}` : undefined}
          style={({ pressed }) => ({
            borderRadius: 6,
            marginHorizontal: -6,
            paddingHorizontal: 6,
            backgroundColor: pressed ? colors.secondary : "transparent",
          })}
        >
          <SafeMarkdown
            source={block.text}
            theme={theme}
            rules={rules}
            onLinkPress={handleLinkPress}
          />
        </Pressable>
      ))}
    </View>
  );
}

export type { MarkdownBlock };
