import { useState, useRef, useEffect } from "react";
import { View, Text, Pressable, Animated, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";
import { selectionHaptic } from "../lib/haptics";

interface FABMenuItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

interface FABMenuProps {
  items: FABMenuItem[];
}

export function FABMenu({ items }: FABMenuProps) {
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const rotation = useRef(new Animated.Value(0)).current;
  const menuScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(rotation, {
        toValue: isOpen ? 1 : 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }),
      Animated.spring(menuScale, {
        toValue: isOpen ? 1 : 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }),
    ]).start();
  }, [isOpen, rotation, menuScale]);

  const handleToggle = () => {
    selectionHaptic();
    setIsOpen(!isOpen);
  };

  const handleItemPress = (item: FABMenuItem) => {
    selectionHaptic();
    setIsOpen(false);
    // Small delay to let animation complete
    setTimeout(() => item.onPress(), 100);
  };

  const rotateInterpolate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "45deg"],
  });

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <Modal transparent visible={isOpen} animationType="fade">
          <Pressable
            style={[tw("absolute inset-0"), { backgroundColor: "rgba(0,0,0,0.3)" }]}
            onPress={() => setIsOpen(false)}
          />
        </Modal>
      )}

      <View style={tw("absolute bottom-6 right-6")}>
        {/* Menu Items */}
        <Animated.View
          style={{
            position: "absolute",
            bottom: 64,
            right: 0,
            opacity: menuScale,
            transform: [
              {
                translateY: menuScale.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
              { scale: menuScale },
            ],
          }}
          pointerEvents={isOpen ? "auto" : "none"}
        >
          {items.map((item, index) => (
            <Pressable
              key={item.id}
              testID={`fab-menu-${item.id}`}
              onPress={() => handleItemPress(item)}
              style={[
                tw("flex-row items-center gap-3 rounded-lg px-4 py-3 mb-2 shadow-lg"),
                { backgroundColor: colors.surface, minWidth: 160 },
              ]}
            >
              <Ionicons name={item.icon} size={20} color={colors.primary} />
              <Text style={[tw("text-base font-medium"), { color: colors.text }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Animated.View>

        {/* FAB Button */}
        <Pressable
          testID="fab-button"
          onPress={handleToggle}
          style={[
            tw("w-14 h-14 rounded-full items-center justify-center shadow-lg"),
            { backgroundColor: colors.primary, elevation: 4 },
          ]}
        >
          <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
            <Ionicons name="add" size={28} color={colors.primaryForeground} />
          </Animated.View>
        </Pressable>
      </View>
    </>
  );
}
