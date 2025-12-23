import React from "react";
import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

type BrandVariant = "icon" | "logo" | "combo";
type BrandSize = "sm" | "md";

type Props = {
  variant?: BrandVariant;
  size?: BrandSize;
  text?: string;
  containerStyle?: StyleProp<ViewStyle>;
  showText?: boolean;
};

const ICON = require("../../assets/brand/icon.png");
const LOGO = require("../../assets/brand/logo.png");

export function BrandMark({
  variant = "combo",
  size = "sm",
  text = "LeadRadar",
  containerStyle,
  showText = true,
}: Props) {
  const dims =
    size === "md"
      ? { icon: 26, logoW: 180, logoH: 32, gap: 10, font: 16 }
      : { icon: 22, logoW: 160, logoH: 28, gap: 8, font: 14 };

  return (
    <View style={[styles.row, { gap: dims.gap }, containerStyle]} accessibilityLabel="LeadRadar">
      {variant === "logo" ? (
        <Image source={LOGO} style={{ width: dims.logoW, height: dims.logoH }} resizeMode="contain" />
      ) : variant === "icon" ? (
        <Image source={ICON} style={{ width: dims.icon, height: dims.icon }} resizeMode="contain" />
      ) : (
        <>
          <Image source={ICON} style={{ width: dims.icon, height: dims.icon }} resizeMode="contain" />
          {showText ? <Text style={[styles.text, { fontSize: dims.font }]}>{text}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
