import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabsParamList = {
  Forms: undefined;
  Outbox: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList>;
  Capture: { formId: string; formName?: string };
};

export type LockedStackParamList = {
  Activation: undefined;
  Settings: undefined;
};
