import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import type { RootStackParamList, TabsParamList } from "./types";

import FormsScreen from "../screens/FormsScreen";
import OutboxScreen from "../screens/OutboxScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CaptureScreen from "../screens/CaptureScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

function TabsNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerTitleAlign: "center",
      }}
    >
      <Tabs.Screen
        name="Forms"
        component={FormsScreen}
        options={{ title: "Forms" }}
      />
      <Tabs.Screen
        name="Outbox"
        component={OutboxScreen}
        options={{ title: "Outbox" }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
    </Tabs.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Tabs"
        component={TabsNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ title: "Capture" }}
      />
    </Stack.Navigator>
  );
}
