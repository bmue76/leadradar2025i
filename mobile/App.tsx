import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { enableScreens } from "react-native-screens";
import RootNavigator from "./src/navigation/RootNavigator";
import { SettingsProvider } from "./src/storage/SettingsContext";

enableScreens(true);

export default function App() {
  return (
    <SettingsProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SettingsProvider>
  );
}
