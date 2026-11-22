import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useAtomValue } from "@effect/atom-react";
import { GitPullRequestIcon, PlugZapIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { desktopNetworkAccessStateAtom } from "../../state/desktopNetworkAccess";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironment } from "../../state/environments";
import { MobilePairingDialog } from "../settings/MobilePairingDialog";
import {
  pairableAdvertisedEndpoints,
  pairingUnavailableReason,
} from "../settings/SettingsPanels.logic";
import { useSidebar } from "../ui/sidebar";
import { WorkspaceRailAccountMenu } from "./WorkspaceRailAccountMenu";
import { WorkspaceRailButton } from "./WorkspaceRailButton";

function RemoteAccessRailButton() {
  const [isOpen, setIsOpen] = useState(false);
  const networkAccess = useAtomValue(desktopNetworkAccessStateAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryHttpBaseUrl = useEnvironmentHttpBaseUrl(primaryEnvironment?.environmentId ?? null);
  const snapshot = AsyncResult.getOrElse(networkAccess, () => null);
  const exposure = snapshot?.serverExposureState ?? null;
  const advertisedEndpoints = snapshot?.advertisedEndpoints ?? [];
  const pairableEndpoints = useMemo(
    () => pairableAdvertisedEndpoints(advertisedEndpoints),
    [advertisedEndpoints],
  );

  return (
    <>
      <WorkspaceRailButton
        active={isOpen}
        label="Remote access"
        onClick={() => setIsOpen(true)}
        testId="sidebar-remote-access-trigger"
      >
        <SmartphoneIcon className="size-4.5" />
      </WorkspaceRailButton>
      <MobilePairingDialog
        endpoints={pairableEndpoints}
        fallbackEndpointUrl={exposure?.endpointUrl ?? primaryHttpBaseUrl}
        onOpenChange={setIsOpen}
        open={isOpen}
        showDownloadPrompt
        unavailableReason={pairingUnavailableReason(advertisedEndpoints)}
      />
    </>
  );
}

function RouteRailButton({
  icon,
  label,
  testId,
  to,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly testId: string;
  readonly to: "/plugins" | "/pull-requests";
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to });
  }, [isMobile, navigate, setOpenMobile, to]);

  return (
    <WorkspaceRailButton
      active={pathname === to}
      label={label}
      onClick={handleClick}
      testId={testId}
    >
      {icon}
    </WorkspaceRailButton>
  );
}

/**
 * Narrow column of workspace destinations, pinned to the left of the thread
 * sidebar. It stays put while the sidebar collapses, so pull requests, plugins,
 * remote access, and settings are always one click away.
 *
 * Its top is left clear for the window controls: the floating sidebar toggle
 * sits there on Windows and Linux, and the macOS traffic lights overlap it.
 */
export function WorkspaceIconRail() {
  return (
    <div
      aria-label="Workspace rail"
      className="z-20 flex w-(--workspace-rail-width) shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar"
      data-workspace-rail=""
      role="navigation"
    >
      <div
        aria-hidden="true"
        className={cn("h-[var(--workspace-topbar-height)] w-full", isElectron && "drag-region")}
      />
      <div className="flex flex-1 flex-col items-center gap-1 py-1">
        <RouteRailButton
          icon={<GitPullRequestIcon className="size-4.5" />}
          label="Pull requests"
          testId="sidebar-pull-requests-trigger"
          to="/pull-requests"
        />
        <RouteRailButton
          icon={<PlugZapIcon className="size-4.5" />}
          label="Plugins"
          testId="sidebar-plugins-trigger"
          to="/plugins"
        />
        <RemoteAccessRailButton />
      </div>
      <div className="flex flex-col items-center gap-1 pb-3">
        <WorkspaceRailAccountMenu />
      </div>
    </div>
  );
}
