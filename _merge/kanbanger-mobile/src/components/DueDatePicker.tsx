import { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  Platform,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Button, ButtonText } from "@linear-clone/ui-native";
import { tw, colors } from "../lib/styles";

interface DueDatePickerProps {
  visible: boolean;
  currentDate: Date | null;
  onSelect: (date: Date | null) => void;
  onClose: () => void;
}

const quickOptions = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next Week", days: 7 },
  { label: "In 2 Weeks", days: 14 },
];

export function DueDatePicker({
  visible,
  currentDate,
  onSelect,
  onClose,
}: DueDatePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(currentDate);
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");

  const handleDateChange = (
    event: DateTimePickerEvent,
    date?: Date
  ) => {
    if (Platform.OS === "android") {
      setShowPicker(false);
      if (event.type === "set" && date) {
        setSelectedDate(date);
      }
    } else if (date) {
      setSelectedDate(date);
    }
  };

  const handleQuickSelect = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(23, 59, 59, 999);
    setSelectedDate(date);
  };

  const handleClear = () => {
    onSelect(null);
    onClose();
  };

  const handleDone = () => {
    onSelect(selectedDate);
    onClose();
  };

  const handleClose = () => {
    setSelectedDate(currentDate);
    onClose();
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "No due date";
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={tw("flex-1 bg-white")}>
        <View style={tw("flex-row items-center justify-between border-b border-gray-200 px-4 py-3")}>
          <Pressable onPress={handleClose}>
            <Text style={tw("text-gray-500")}>Cancel</Text>
          </Pressable>
          <Text style={tw("font-semibold text-gray-900")}>Due Date</Text>
          <Pressable onPress={handleDone}>
            <Text style={tw("text-indigo-600 font-medium")}>Done</Text>
          </Pressable>
        </View>

        <View style={tw("p-4")}>
          <View style={tw("bg-gray-100 rounded-lg p-4 mb-6")}>
            <Text style={tw("text-center text-lg text-gray-900")}>
              {formatDate(selectedDate)}
            </Text>
          </View>

          <Text style={tw("text-sm font-medium text-gray-500 mb-3")}>
            Quick Select
          </Text>
          <View style={tw("flex-row flex-wrap gap-2 mb-6")}>
            {quickOptions.map((option) => (
              <Pressable
                key={option.label}
                onPress={() => handleQuickSelect(option.days)}
                style={tw("bg-gray-100 px-4 py-2 rounded-full")}
              >
                <Text style={tw("text-gray-700")}>{option.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={tw("text-sm font-medium text-gray-500 mb-3")}>
            Or select a date
          </Text>

          {Platform.OS === "android" && !showPicker && (
            <Button
              variant="outline"
              onPress={() => setShowPicker(true)}
              style={{ marginBottom: 16 }}
            >
              <ButtonText>Choose Date</ButtonText>
            </Button>
          )}

          {showPicker && (
            <View style={tw("items-center")}>
              <DateTimePicker
                value={selectedDate ?? new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={handleDateChange}
                minimumDate={new Date()}
                style={{ height: 200 }}
              />
            </View>
          )}
        </View>

        {currentDate && (
          <View style={[tw("absolute left-4 right-4"), { bottom: 32 }]}>
            <Button variant="destructive" onPress={handleClear}>
              <ButtonText>Clear Due Date</ButtonText>
            </Button>
          </View>
        )}
      </View>
    </Modal>
  );
}
