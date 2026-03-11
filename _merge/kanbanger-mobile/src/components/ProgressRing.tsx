import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

interface ProgressRingProps {
  progress: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  color?: string;
  trackColor?: string;
}

const sizeConfig = {
  sm: { outer: 40, inner: 32, stroke: 4, fontSize: 12 },
  md: { outer: 64, inner: 52, stroke: 6, fontSize: 14 },
  lg: { outer: 96, inner: 80, stroke: 8, fontSize: 20 },
} as const;

export function ProgressRing({
  progress,
  size = "md",
  showLabel = true,
  color = "#4F46E5",
  trackColor,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const config = sizeConfig[size];
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const percentage = Math.round(clampedProgress);

  const radius = (config.outer - config.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

  const effectiveTrackColor = trackColor ?? colors.border;

  return (
    <View
      style={[{ width: config.outer, height: config.outer }, tw("items-center justify-center")]}
    >
      <Svg width={config.outer} height={config.outer} style={{ position: "absolute" }}>
        <Circle
          cx={config.outer / 2}
          cy={config.outer / 2}
          r={radius}
          stroke={effectiveTrackColor}
          strokeWidth={config.stroke}
          fill="transparent"
        />
        <Circle
          cx={config.outer / 2}
          cy={config.outer / 2}
          r={radius}
          stroke={color}
          strokeWidth={config.stroke}
          fill="transparent"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${config.outer / 2}, ${config.outer / 2}`}
        />
      </Svg>

      <View
        style={[
          { width: config.inner, height: config.inner },
          tw("items-center justify-center")
        ]}
      >
        {showLabel && (
          <Text
            style={[tw("font-bold"), { fontSize: config.fontSize, color: colors.text }]}
          >
            {percentage}%
          </Text>
        )}
      </View>
    </View>
  );
}
