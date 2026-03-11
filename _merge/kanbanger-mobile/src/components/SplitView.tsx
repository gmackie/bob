import { View, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";
import { tw, colors } from "../lib/styles";

interface SplitViewProps {
  master: ReactNode;
  detail: ReactNode;
  masterWidth?: number;
}

export const TABLET_BREAKPOINT = 768;

export function SplitView({ master, detail, masterWidth = 0.4 }: SplitViewProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  if (!isTablet) {
    return <>{master}</>;
  }

  return (
    <View style={tw("flex-1 flex-row")}>
      <View style={[{ width: width * masterWidth, borderRightWidth: 1, borderRightColor: colors["gray-200"] }]}>
        {master}
      </View>
      <View style={{ width: width * (1 - masterWidth) }}>{detail}</View>
    </View>
  );
}

export function useIsTablet() {
  const { width } = useWindowDimensions();
  return width >= TABLET_BREAKPOINT;
}
