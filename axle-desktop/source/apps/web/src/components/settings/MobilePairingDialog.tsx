import { CheckIcon, CopyIcon, LoaderIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as DateTime from "effect/DateTime";
import { AuthStandardClientScopes, type AdvertisedEndpoint } from "@axle/contracts";

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
  /**
   * Every advertised endpoint a phone could dial, best first. The dialog
   * preselects the first available one and lets the person switch — a tailnet
   * address is the only thing that works when the phone cannot cross to this
   * computer's network.
   */
  readonly endpoints: ReadonlyArray<AdvertisedEndpoint>;
  /** Fallback when nothing is advertised yet (loopback-only desktops). */
  readonly fallbackEndpointUrl: string | null;
  readonly unavailableReason?: string | null;
  readonly showDownloadPrompt?: boolean;
};

type PairingCredential = {
  readonly id: string;
  readonly token: string;
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
  endpoints,
  fallbackEndpointUrl,
  unavailableReason = null,
  showDownloadPrompt = false,
}: MobilePairingDialogProps) {
  const [credential, setCredential] = useState<PairingCredential | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);

  const available = useMemo(
    () => endpoints.filter((endpoint) => endpoint.status === "available"),
    [endpoints],
  );
  const selected = useMemo(
    () => available.find((endpoint) => endpoint.id === selectedEndpointId) ?? available[0] ?? null,
    [available, selectedEndpointId],
  );
  const endpointUrl = selected?.httpBaseUrl ?? fallbackEndpointUrl;
  const networkAccessible = endpointUrl !== null;

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
        token: issued.credential,
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

  // The credential is a bare token, not bound to a host, so switching
  // endpoints re-addresses the same code instead of burning it for a new one.
  const pairingUrl = useMemo(
    () =>
      credential !== null && endpointUrl !== null
        ? makePairingUrl(endpointUrl, credential.token)
        : null,
    [credential, endpointUrl],
  );

  const copyUrl = useCallback(async () => {
    if (pairingUrl === null) return;
    await navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [pairingUrl]);

  const status = useMemo(() => {
    if (!networkAccessible) {
      return (
        unavailableReason ??
        "Your phone needs local-network or Tailscale access to reach this Axle instance."
      );
    }
    return "Scan this code in Axle Mobile. The code expires after five minutes and can only be used once.";
  }, [networkAccessible, unavailableReason]);

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
          {showDownloadPrompt ? (
            <div className="w-full rounded-xl border border-border bg-muted/20 px-4 py-3 text-center">
              <p className="text-sm font-medium text-foreground">First, download Axle Mobile</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Install the mobile app, then scan this code to connect it to your desktop.
              </p>
            </div>
          ) : null}
          {available.length > 1 ? (
            <div className="w-full">
              <p className="mb-1.5 text-xs font-medium text-foreground">Address to pair with</p>
              <div className="flex flex-col gap-1">
                {available.map((endpoint) => (
                  <label
                    key={endpoint.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-left has-checked:border-primary has-checked:bg-muted/30"
                  >
                    <input
                      type="radio"
                      name="axle-pairing-endpoint"
                      value={endpoint.id}
                      checked={selected?.id === endpoint.id}
                      onChange={() => setSelectedEndpointId(endpoint.id)}
                      className="size-3.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-foreground">
                        {endpoint.label}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {endpoint.httpBaseUrl}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Pick the tailnet address when your phone is not on the same network as this
                computer.
              </p>
            </div>
          ) : null}
          {credential !== null && pairingUrl !== null && !expired ? (
            <>
              <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                <QRCodeSvg
                  value={pairingUrl}
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
                  {pairingUrl}
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
