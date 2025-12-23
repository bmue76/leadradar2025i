import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import type { LockedStackParamList, RootStackParamList, TabsParamList } from "./types";

import FormsScreen from "../screens/FormsScreen";
import OutboxScreen from "../screens/OutboxScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CaptureScreen from "../screens/CaptureScreen";
import ActivationScreen from "../screens/ActivationScreen";
import StartScreen from "../screens/StartScreen";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";

const AppStack = createNativeStackNavigator<RootStackParamList>();
const LockedStack = createNativeStackNavigator<LockedStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();
const BootStack = createNativeStackNavigator<{ Boot: undefined }>();

function TabsNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerTitleAlign: "center",
      }}
    >
      <Tabs.Screen name="Forms" component={FormsScreen} options={{ title: "Forms" }} />
      <Tabs.Screen name="Outbox" component={OutboxScreen} options={{ title: "Outbox" }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </Tabs.Navigator>
  );
}

function BootScreen() {
  return (
    <View style={styles.boot}>
      <Text style={styles.brand}>LEADRADAR</Text>
      <View style={styles.row}>
        <ActivityIndicator />
        <Text style={styles.hint}>Loading…</Text>
      </View>
    </View>
  );
}

function BootNavigator() {
  return (
    <BootStack.Navigator>
      <BootStack.Screen name="Boot" component={BootScreen} options={{ headerShown: false }} />
    </BootStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator>
      <AppStack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
      <AppStack.Screen name="Capture" component={CaptureScreen} options={{ title: "Capture" }} />
    </AppStack.Navigator>
  );
}

function LockedNavigator() {
  return (
    <LockedStack.Navigator
      initialRouteName="Start"
      screenOptions={{
        headerTitleAlign: "center",
      }}
    >
      <LockedStack.Screen name="Start" component={StartScreen} options={{ headerShown: false }} />
      <LockedStack.Screen name="Activation" component={ActivationScreen} options={{ title: "Activation" }} />
      <LockedStack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </LockedStack.Navigator>
  );
}

export default function RootNavigator() {
  const settings = useSettings();
  const activation = useActivation();

  const hasSettings = useMemo(() => {
    return Boolean(settings.baseUrl && settings.tenantSlug);
  }, [settings.baseUrl, settings.tenantSlug]);

  // Boot/Loading: bis Settings + Activation geladen sind (kein UI-Flackern)
  if (!settings.isLoaded || !activation.isLoaded) {
    return <BootNavigator />;
  }

  // Unlocked -> direkt in App (kein Startscreen/Activation Flash)
  if (hasSettings && activation.isActiveNow) {
    return <AppNavigator />;
  }

  // Locked -> StartScreen Einstieg, von dort Activation/Settings
  return <LockedNavigator />;
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0f14" },
  brand: { fontSize: 30, fontWeight: "900", color: "white", letterSpacing: 1 },
  row: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  hint: { color: "#b8c0cc" },
});
