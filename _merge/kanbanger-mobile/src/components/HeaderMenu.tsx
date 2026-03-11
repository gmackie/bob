import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Share,
  Alert,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { lightHaptic } from "../lib/haptics";
import { tw, colors } from "../lib/styles";

interface HeaderMenuProps {
  taskIdentifier: string;
  taskTitle: string;
  taskId: string;
}

export function HeaderMenu({ taskIdentifier, taskTitle, taskId }: HeaderMenuProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getTaskUrl = () => {
    return `linear-clone://task/${taskId}`;
  };

  const handleShare = async () => {
    setShowMenu(false);
    try {
      await Share.share({
        title: taskIdentifier,
        message: `${taskIdentifier}: ${taskTitle}\n${getTaskUrl()}`,
      });
    } catch (error) {
      console.error("Error sharing:", error);
    }
  };

  const handleCopyLink = async () => {
    setShowMenu(false);
    await Clipboard.setStringAsync(getTaskUrl());
    lightHaptic();
    Alert.alert("Copied", "Task link copied to clipboard");
  };

  const handleCopyIdentifier = async () => {
    setShowMenu(false);
    await Clipboard.setStringAsync(taskIdentifier);
    lightHaptic();
    Alert.alert("Copied", "Task identifier copied to clipboard");
  };

  return (
    <>
      <Pressable onPress={() => setShowMenu(true)} style={[tw("p-2"), { marginRight: -8 }]}>
        <Text style={[tw("text-lg"), { color: colors["gray-500"] }]}>•••</Text>
      </Pressable>

      <Modal
        visible={showMenu}
        animationType="fade"
        transparent
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable
          style={[tw("flex-1 justify-end"), { backgroundColor: "rgba(0,0,0,0.3)" }]}
          onPress={() => setShowMenu(false)}
        >
          <View style={tw("bg-white rounded-t-2xl pb-8")}>
            <View style={tw("items-center py-3 border-b border-gray-200")}>
              <View style={[tw("w-10 h-1 bg-gray-300 rounded-full")]} />
            </View>

            <Pressable
              onPress={handleShare}
              style={tw("flex-row items-center px-6 py-4 border-b border-gray-100")}
            >
              <Text style={[tw("mr-4 text-lg"), { color: colors["gray-400"] }]}>↗</Text>
              <Text style={tw("text-gray-900 text-base")}>Share</Text>
            </Pressable>

            <Pressable
              onPress={handleCopyLink}
              style={tw("flex-row items-center px-6 py-4 border-b border-gray-100")}
            >
              <Text style={[tw("mr-4 text-lg"), { color: colors["gray-400"] }]}>🔗</Text>
              <Text style={tw("text-gray-900 text-base")}>Copy Link</Text>
            </Pressable>

            <Pressable
              onPress={handleCopyIdentifier}
              style={tw("flex-row items-center px-6 py-4 border-b border-gray-100")}
            >
              <Text style={[tw("mr-4 text-lg"), { color: colors["gray-400"] }]}>#</Text>
              <Text style={tw("text-gray-900 text-base")}>Copy Identifier</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowMenu(false)}
              style={[tw("mx-4 mt-4 py-3 bg-gray-100 rounded-lg")]}
            >
              <Text style={tw("text-center text-gray-900 font-medium")}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
