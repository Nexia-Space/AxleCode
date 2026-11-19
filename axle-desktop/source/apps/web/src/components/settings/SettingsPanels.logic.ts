import type {
  AdvertisedEndpoint,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerSettings,
  UnifiedSettings,
} from "@axle/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@axle/contracts/settings";

/**
 * Endpoints a phone could actually dial, best first.
 *
 * The loopback endpoint is always advertised but only ever reaches this
 * computer, so it can never pair a phone. Everything else is ordered by how
 * likely it is to work: the endpoint the desktop marked default (the LAN one,
 * when network access is on) stays first so the common same-wifi case is
 * unchanged, then remaining available endpoints, then unavailable ones — a
 * Tailscale endpoint whose Serve is not configured is still worth showing, so
 * the person can see why it is not an option.
 */
export function pairableAdvertisedEndpoints(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
): ReadonlyArray<AdvertisedEndpoint> {
  const rank = (endpoint: AdvertisedEndpoint): number => {
    if (endpoint.status !== "available") return 2;
    return endpoint.isDefault === true ? 0 : 1;
  };
  return endpoints
    .filter((endpoint) => endpoint.reachability !== "loopback")
    .toSorted((left, right) => rank(left) - rank(right));
}

/**
 * The endpoint to preselect when the pairing dialog opens, or null when nothing
 * advertised can reach a phone.
 */
export function defaultPairingEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
): AdvertisedEndpoint | null {
  return (
    pairableAdvertisedEndpoints(endpoints).find((endpoint) => endpoint.status === "available") ??
    null
  );
}

/**
 * Whether a phone can reach this desktop right now.
 *
 * Derived from the advertised endpoints rather than from the persisted
 * toggles: `tailscaleServeEnabled` records only that the switch is on, so with
 * Tailscale uninstalled or Serve unconfigured it would otherwise claim the
 * server is reachable and hand out a dead address.
 */
export function isPairingReachable(endpoints: ReadonlyArray<AdvertisedEndpoint>): boolean {
  return defaultPairingEndpoint(endpoints) !== null;
}

/**
 * Why pairing is unavailable, taken from the provider's own description of the
 * closest endpoint, so Tailscale explains its own setup requirement.
 */
export function pairingUnavailableReason(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
): string | null {
  if (isPairingReachable(endpoints)) return null;
  const [closest] = pairableAdvertisedEndpoints(endpoints);
  return closest?.description ?? null;
}

function collapseOtelSignalsUrl(input: {
  readonly tracesUrl: string;
  readonly metricsUrl: string;
}): string | null {
  const tracesSuffix = "/traces";
  const metricsSuffix = "/metrics";
  if (!input.tracesUrl.endsWith(tracesSuffix) || !input.metricsUrl.endsWith(metricsSuffix)) {
    return null;
  }

  const tracesBase = input.tracesUrl.slice(0, -tracesSuffix.length);
  const metricsBase = input.metricsUrl.slice(0, -metricsSuffix.length);
  if (tracesBase !== metricsBase) {
    return null;
  }

  return `${tracesBase}/{traces,metrics}`;
}

export function formatDiagnosticsDescription(input: {
  readonly localTracingEnabled: boolean;
  readonly otlpTracesEnabled: boolean;
  readonly otlpTracesUrl?: string | undefined;
  readonly otlpMetricsEnabled: boolean;
  readonly otlpMetricsUrl?: string | undefined;
}): string {
  const mode = input.localTracingEnabled ? "Local trace file" : "Terminal logs only";
  const tracesUrl = input.otlpTracesEnabled ? input.otlpTracesUrl : undefined;
  const metricsUrl = input.otlpMetricsEnabled ? input.otlpMetricsUrl : undefined;

  if (tracesUrl && metricsUrl) {
    const collapsedUrl = collapseOtelSignalsUrl({ tracesUrl, metricsUrl });
    return collapsedUrl
      ? `${mode}. Exporting OTEL to ${collapsedUrl}.`
      : `${mode}. Exporting OTEL traces to ${tracesUrl} and metrics to ${metricsUrl}.`;
  }

  if (tracesUrl) {
    return `${mode}. Exporting OTEL traces to ${tracesUrl}.`;
  }

  if (metricsUrl) {
    return `${mode}. Exporting OTEL metrics to ${metricsUrl}.`;
  }

  return `${mode}.`;
}

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];
  const legacyProviderDefaults = DEFAULT_UNIFIED_SETTINGS.providers as Record<
    string,
    LegacyProviderSettings | undefined
  >;
  const legacyProviderDefault = input.isDefault ? legacyProviderDefaults[input.driver] : undefined;
  return {
    ...(legacyProviderDefault !== undefined
      ? {
          providers: {
            ...input.settings.providers,
            [input.driver]: legacyProviderDefault,
          } as ServerSettings["providers"],
        }
      : {}),
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}
