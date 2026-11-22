import { LoaderCircleIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useAccountActions, useAccountState } from "../../account/AccountAuthProvider";
import { signOutAccount } from "../../account/accountClient";
import { useAccountSnapshot } from "../../account/useAccountSnapshot";
import { AccountAvatar } from "../account/AccountAvatar";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSidebar } from "../ui/sidebar";

const TRIGGER_CLASS =
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 [-webkit-app-region:no-drag] hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";

/**
 * Bottom of the icon rail: a single gear that opens upward onto the signed-in
 * identity and the settings entry point. Everything the old account chip linked
 * to — billing, credits, API keys — lives inside Settings, so the rail only
 * needs the one way in.
 */
export function WorkspaceRailAccountMenu() {
  const account = useAccountState();
  const { signOut } = useAccountActions();
  const { state } = useAccountSnapshot();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Revoke server-side while the token can still be read, then clear locally.
      await signOutAccount();
    } catch {
      // A failed revoke must not trap the user in a signed-in shell.
    } finally {
      setSigningOut(false);
      signOut();
    }
  }, [signOut]);

  const profile = state.snapshot?.user ?? null;
  const email =
    profile?.email ??
    (account.status === "signed-in" ? account.user.primaryEmailAddress?.emailAddress : null) ??
    null;
  const name = profile?.displayName ?? email ?? "Axle account";

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  aria-label="Open settings and account"
                  className={TRIGGER_CLASS}
                  data-testid="workspace-rail-settings-trigger"
                  type="button"
                />
              }
            />
          }
        >
          <SettingsIcon className="size-4.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Settings</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="top">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <AccountAvatar
            className="size-7"
            email={email}
            name={name}
            url={profile?.avatarUrl ?? null}
          />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-4.5">{name}</span>
            {email && email !== name ? (
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                {email}
              </span>
            ) : null}
          </span>
        </div>
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            closeMobileSidebar();
            void navigate({ to: "/settings" });
          }}
        >
          <SettingsIcon className="size-3.5" />
          Settings
        </MenuItem>
        {account.status === "signed-in" ? (
          <MenuItem disabled={signingOut} onClick={() => void handleSignOut()}>
            {signingOut ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <LogOutIcon className="size-3.5" />
            )}
            Sign out
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
