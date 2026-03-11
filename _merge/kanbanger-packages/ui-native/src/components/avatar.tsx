import * as React from "react";
import { View, Image, Text, StyleSheet, type ViewProps, type ImageProps, type TextProps, type StyleProp, type ViewStyle, type ImageStyle, type TextStyle } from "react-native";

export interface AvatarProps extends ViewProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export interface AvatarImageProps extends Omit<ImageProps, "source"> {
  src?: string;
  style?: StyleProp<ImageStyle>;
}

export interface AvatarFallbackProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export interface AvatarFallbackTextProps extends TextProps {
  style?: StyleProp<TextStyle>;
}

const Avatar = React.forwardRef<React.ElementRef<typeof View>, AvatarProps>(
  ({ size = 40, style, ...props }, ref) => (
    <View
      ref={ref}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, style]}
      {...props}
    />
  )
);
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef<React.ElementRef<typeof Image>, AvatarImageProps>(
  ({ src, style, ...props }, ref) => {
    if (!src) return null;
    
    return (
      <Image
        ref={ref}
        source={{ uri: src }}
        style={[styles.avatarImage, style]}
        {...props}
      />
    );
  }
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef<React.ElementRef<typeof View>, AvatarFallbackProps>(
  ({ style, ...props }, ref) => (
    <View
      ref={ref}
      style={[styles.avatarFallback, style]}
      {...props}
    />
  )
);
AvatarFallback.displayName = "AvatarFallback";

const AvatarFallbackText = React.forwardRef<React.ElementRef<typeof Text>, AvatarFallbackTextProps>(
  ({ style, ...props }, ref) => (
    <Text
      ref={ref}
      style={[styles.avatarFallbackText, style]}
      {...props}
    />
  )
);
AvatarFallbackText.displayName = "AvatarFallbackText";

const styles = StyleSheet.create({
  avatar: {
    position: "relative",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 9999,
  },
  avatarFallbackText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#4B5563",
  },
});

export { Avatar, AvatarImage, AvatarFallback, AvatarFallbackText };
