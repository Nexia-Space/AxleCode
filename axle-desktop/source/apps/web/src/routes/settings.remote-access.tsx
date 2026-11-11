import { createFileRoute } from "@tanstack/react-router";

import { RemoteAccessSettingsPanel } from "../components/settings/SettingsPanels";

function RemoteAccessSettingsRoute() {
  return <RemoteAccessSettingsPanel />;
}

export const Route = createFileRoute("/settings/remote-access")({
  component: RemoteAccessSettingsRoute,
});
