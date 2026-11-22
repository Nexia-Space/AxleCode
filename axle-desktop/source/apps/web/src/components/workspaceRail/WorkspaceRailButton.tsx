import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * One destination in the workspace icon rail. The rail has no room for labels,
 * so the accessible name lives on the button and the same text is shown as a
 * tooltip on hover.
 */
export function WorkspaceRailButton({
  active = false,
  children,
  label,
  onClick,
  testId,
}: {
  /** Highlights the rail entry whose surface is currently open. */
  readonly active?: boolean;
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={cn(
              "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 [-webkit-app-region:no-drag] hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
              active && "bg-sidebar-accent text-foreground",
            )}
            data-testid={testId}
            onClick={onClick}
            type="button"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}
