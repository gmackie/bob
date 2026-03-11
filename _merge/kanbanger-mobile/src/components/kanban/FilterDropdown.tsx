import { useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { tw } from "../../lib/styles";
import { useTheme } from "../../lib/theme";

export type FilterOption = {
  id: string;
  label: string;
  type: "my_tasks" | "project" | "team" | "all";
  color?: string | null;
};

interface FilterDropdownProps {
  options: FilterOption[];
  selected: FilterOption;
  onSelect: (option: FilterOption) => void;
}

export function FilterDropdown({ options, selected, onSelect }: FilterDropdownProps) {
  const { colors, isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (option: FilterOption) => {
    onSelect(option);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        testID="filter-dropdown-trigger"
        onPress={() => setIsOpen(true)}
        style={[
          tw("flex-row items-center gap-2 rounded-lg px-3 py-2"),
          { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"] },
        ]}
      >
        {selected.color && (
          <View
            style={[tw("h-3 w-3 rounded-full"), { backgroundColor: selected.color }]}
          />
        )}
        <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
          {selected.label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={[tw("flex-1"), { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={() => setIsOpen(false)}
        >
          <View style={tw("flex-1 justify-end")}>
            <View
              style={[
                tw("rounded-t-2xl"),
                { backgroundColor: colors.surface, maxHeight: "60%" },
              ]}
            >
              <View style={tw("items-center py-3")}>
                <View
                  style={[
                    tw("h-1 w-10 rounded-full"),
                    { backgroundColor: colors.border },
                  ]}
                />
              </View>
              <Text style={[tw("text-lg font-semibold px-4 pb-2"), { color: colors.text }]}>
                Filter by
              </Text>
              <ScrollView>
                {options.map((option) => (
                  <Pressable
                    key={option.id}
                    testID={`filter-option-${option.id}`}
                    onPress={() => handleSelect(option)}
                    style={[
                      tw("flex-row items-center gap-3 px-4 py-3"),
                      selected.id === option.id && {
                        backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"],
                      },
                    ]}
                  >
                    {option.color ? (
                      <View
                        style={[tw("h-4 w-4 rounded-full"), { backgroundColor: option.color }]}
                      />
                    ) : option.type === "my_tasks" ? (
                      <Ionicons name="person" size={16} color={colors.primary} />
                    ) : option.type === "all" ? (
                      <Ionicons name="apps" size={16} color={colors.textSecondary} />
                    ) : (
                      <Ionicons name="folder" size={16} color={colors.textSecondary} />
                    )}
                    <Text style={[tw("text-base flex-1"), { color: colors.text }]}>
                      {option.label}
                    </Text>
                    {selected.id === option.id && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              <View style={{ height: 34 }} />
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
