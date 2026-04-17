import { ScrollView, Text, Pressable, View } from "react-native";
import { Badge } from "../ui/Badge";
import { colors } from "~/lib/colors";

interface WikiPaneProps {
  title: string;
  content: string;
  tags: string[];
  relatedArticles: string[];
  onSelectArticle?: (slug: string) => void;
}

export function WikiPane({
  title,
  content,
  tags,
  relatedArticles,
  onSelectArticle,
}: WikiPaneProps) {
  return (
    <ScrollView className="flex-1 bg-background">
      <View className="p-5">
        <Text
          className="text-2xl font-bold mb-3"
          style={{ color: colors.foreground }}
        >
          {title}
        </Text>

        {tags.length > 0 && (
          <View className="flex-row gap-2 mb-4 flex-wrap">
            {tags.map((tag) => (
              <Badge key={tag} variant="accent">
                {tag}
              </Badge>
            ))}
          </View>
        )}

        <Text
          className="text-base leading-6"
          style={{ color: colors.foreground }}
        >
          {content}
        </Text>

        {relatedArticles.length > 0 && (
          <View className="mt-6 pt-4 border-t border-border">
            <Text
              className="text-sm font-semibold mb-2"
              style={{ color: colors.muted }}
            >
              Related
            </Text>
            {relatedArticles.map((slug) => (
              <Pressable
                key={slug}
                onPress={() => onSelectArticle?.(slug)}
                className="py-2"
              >
                <Text className="text-base" style={{ color: colors.accent }}>
                  [[{slug}]]
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
