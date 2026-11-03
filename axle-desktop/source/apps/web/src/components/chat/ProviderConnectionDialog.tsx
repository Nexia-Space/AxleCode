import { useNavigate } from "@tanstack/react-router";
import { PlugZapIcon, Settings2Icon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
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
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PlugZapIcon className="size-5" aria-hidden />
          </div>
          <DialogTitle>Connect a provider to start chatting</DialogTitle>
          <DialogDescription>
            Axle no longer ships with a default model. Connect your own provider or local model in
            Settings, then come back here to start a conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="rounded-xl bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
          Your keys stay in your Axle environment. You can connect OpenAI, Claude, Gemini,
          OpenRouter, Ollama, or any compatible endpoint.
        </DialogPanel>
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
