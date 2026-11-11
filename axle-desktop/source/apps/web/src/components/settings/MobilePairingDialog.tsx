import { CheckIcon, CopyIcon, LoaderIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as DateTime from "effect/DateTime";
import { AuthStandardClientScopes } from "@axle/contracts";

import {
  createServerPairingCredential,
  revokeServerPairingLink,
} from "../../environments/primary/auth";
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
import { QRCodeSvg } from "../ui/qr-code";

type MobilePairingDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly endpointUrl: string | null;
  readonly networkAccessible: boolean;
};

type PairingCredential = {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
};

function makePairingUrl(endpointUrl: string, credential: string): string {
  const url = new URL(endpointUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = new URLSearchParams({ token: credential }).toString();
  return url.toString();
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function MobilePairingDialog({
  open,
  onOpenChange,
  endpointUrl,
  networkAccessible,
}: MobilePairingDialogProps) {
  const [credential, setCredential] = useState<PairingCredential | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const expiresAtMs = credential ? Date.parse(credential.expiresAt) : 0;
  const remainingMs = credential ? Math.max(0, expiresAtMs - now) : 0;
  const expired = credential !== null && remainingMs === 0;

  useEffect(() => {
    if (!open || credential === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [credential, open]);

  const issueCredential = useCallback(async () => {
    if (endpointUrl === null) {
      setError("Turn on local network or Tailscale access before pairing a phone.");
      return;
    }
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      if (credential !== null) {
        await revokeServerPairingLink(credential.id).catch(() => undefined);
      }
      const issued = await createServerPairingCredential({
        label: "Axle mobile",
        scopes: AuthStandardClientScopes,
      });
      setCredential({
        id: issued.id,
        url: makePairingUrl(endpointUrl, issued.credential),
        expiresAt: DateTime.formatIso(issued.expiresAt),
      });
      setNow(Date.now());
    } catch {
      setError(
        "Axle couldn't create a mobile pairing code. Check that the desktop server is ready.",
      );
    } finally {
      setLoading(false);
    }
  }, [credential, endpointUrl]);

  const copyUrl = useCallback(async () => {
    if (credential === null) return;
    await navigator.clipboard.writeText(credential.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [credential]);

  const status = useMemo(() => {
    if (!networkAccessible) {
      return "Your phone needs local-network or Tailscale access to reach this Axle instance.";
    }
    if (endpointUrl === null) return "Waiting for an address that your phone can reach.";
    return "Scan this code in Axle Mobile. The code expires after five minutes and can only be used once.";
  }, [endpointUrl, networkAccessible]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md overflow-hidden">
        <DialogHeader className="border-b border-border/70 bg-background">
          <DialogTitle className="flex items-center gap-2">
            <SmartphoneIcon className="size-4 text-muted-foreground" />
            Connect Axle Mobile
          </DialogTitle>
          <DialogDescription>{status}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col items-center gap-5 bg-background py-6">
          {credential !== null && !expired ? (
            <>
              <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                <QRCodeSvg
                  value={credential.url}
                  size={220}
                  level="M"
                  marginSize={3}
                  title="Axle mobile pairing code"
                />
              </div>
              <div className="text-center text-xs text-muted-foreground">
                Expires in{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {formatRemaining(remainingMs)}
                </span>
              </div>
              <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {credential.url}
                </code>
                <Button size="xs" variant="outline" onClick={() => void copyUrl()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
              <SmartphoneIcon className="size-8 text-muted-foreground/60" />
              <p className="max-w-xs text-sm text-muted-foreground">
                {expired
                  ? "This pairing code has expired."
                  : "Create a one-time code to connect your phone."}
              </p>
            </div>
          )}
          {error ? <p className="w-full text-center text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter className="border-t border-border/70 bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => void issueCredential()} disabled={loading || endpointUrl === null}>
            {loading ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />}
            {credential === null || expired ? "Create pairing code" : "Refresh code"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
