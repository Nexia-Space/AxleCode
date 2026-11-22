import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../env";
import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { DesktopUpdateBanner } from "./DesktopUpdateBanner";
import {
  SIDEBAR_EDGE_REVEAL_CLOSE_DELAY_MS,
  SIDEBAR_EDGE_REVEAL_ZONE_WIDTH,
} from "./AppSidebarLayout.logic";
import ThreadSidebar from "./Sidebar";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { WorkspaceIconRail } from "./workspaceRail/WorkspaceIconRail";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "90px";

/** Right edge of the open sidebar, which starts after the icon rail. */
function resolveOpenSidebarFootprint(): number {
  const container = document.querySelector<HTMLElement>("[data-slot='sidebar-container']");
  return container?.getBoundingClientRect().right ?? 0;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    // Electron builds the window's draggable region by replaying Blink's
    // annotated regions in document order: every `-webkit-app-region: drag`
    // rect is unioned in, every `no-drag` rect is cut back out. The toggle only
    // keeps its hole if nothing paints a drag rect over it later in the
    // document, which is why `AppSidebarLayout` renders this control last. Mark
    // the whole titlebar-height strip `no-drag` so the hole covers the control
    // even while the button is mid-transition.
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-[100] flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]"
      data-sidebar-control=""
    >
      <SidebarTrigger
        className="pointer-events-auto rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Toggle main sidebar"
        title={`Toggle main sidebar${shortcutLabel ? ` (${shortcutLabel})` : ""}`}
      />
    </div>
  );
}

function SidebarEdgeReveal() {
  const { isMobile, open, setOpen } = useSidebar();
  const lastPointerXRef = useRef<number | null>(null);
  const revealedByHoverRef = useRef(false);

  useEffect(() => {
    if (isMobile) return;

    let closeTimer: number | null = null;

    const clearCloseTimer = () => {
      if (closeTimer === null) return;
      window.clearTimeout(closeTimer);
      closeTimer = null;
    };

    const scheduleClose = () => {
      if (closeTimer !== null) return;
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        revealedByHoverRef.current = false;
        setOpen(false);
      }, SIDEBAR_EDGE_REVEAL_CLOSE_DELAY_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      const previousX = lastPointerXRef.current;
      lastPointerXRef.current = event.clientX;

      if (!open) {
        if (
          (previousX === null || previousX > SIDEBAR_EDGE_REVEAL_ZONE_WIDTH) &&
          event.clientX <= SIDEBAR_EDGE_REVEAL_ZONE_WIDTH
        ) {
          revealedByHoverRef.current = true;
          setOpen(true);
        }
        return;
      }

      if (!revealedByHoverRef.current) return;
      if (event.clientX <= resolveOpenSidebarFootprint()) {
        clearCloseTimer();
      } else {
        scheduleClose();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      clearCloseTimer();
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    if (!open) {
      revealedByHoverRef.current = false;
    }
  }, [open]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(window.innerWidth);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen style={sidebarProviderStyle}>
      <WorkspaceIconRail />
      <Sidebar
        side="left"
        variant="sidebar"
        collapsible="offcanvas"
        // The panel is fixed to the viewport, so it has to be pushed past the
        // in-flow rail by hand. `md:` only makes this win over the component's
        // own `left-0`; the collapsed `group-data-[collapsible=offcanvas]`
        // offset is more specific and still slides the panel off screen.
        className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:left-(--workspace-rail-width)"
        resizable={{
          maxWidth: sidebarMaximumWidth,
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
            nextWidth <= currentWidth ||
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          onResize: setSidebarWidth,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      <SidebarEdgeReveal />
      {children}
      <DesktopUpdateBanner />
      {/* Last on purpose. A collapsed sidebar lets the workspace topbar — an
          Electron drag region — stretch back under the toggle, and a drag
          region that comes later in the document re-covers the toggle's
          no-drag hole, so the OS swallows the click that would reopen the
          sidebar. Keeping the control last keeps its hole on top. */}
      <SidebarControl />
    </SidebarProvider>
  );
}
