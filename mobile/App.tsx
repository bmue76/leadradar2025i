import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { enableScreens } from "react-native-screens";
import RootNavigator from "./src/navigation/RootNavigator";
import { SettingsProvider, useSettings } from "./src/storage/SettingsContext";
import { ActivationProvider, useActivation } from "./src/storage/ActivationContext";
import { OutboxAutoSyncGate } from "./src/sync/outboxAutoSync";

enableScreens(true);

function MaybeOutboxAutoSyncGate() {
  const settings = useSettings();
  const activation = useActivation();

  if (!settings.isLoaded || !activation.isLoaded) return null;
  if (!settings.baseUrl || !settings.tenantSlug) return null;
  if (!activation.isActiveNow) return null;

  return <OutboxAutoSyncGate />;
}

export default function App() {
  return (
    <SettingsProvider>
      <ActivationProvider>
        <MaybeOutboxAutoSyncGate />
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </ActivationProvider>
    </SettingsProvider>
  );
}
