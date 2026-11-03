import { useNavigate } from "@tanstack/react-router";
import { PlugZapIcon, Settings2Icon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function ProviderConnectionDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PlugZapIcon className="size-8" aria-hidden />
          </div>
          <DialogTitle>Connect a provider to start chatting</DialogTitle>
          <DialogDescription>
            Connect your provider or local model in Settings, then come back here to start a
            conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              void navigate({ to: "/settings/models" });
            }}
          >
            <Settings2Icon className="size-4" />
            Connect provider
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
