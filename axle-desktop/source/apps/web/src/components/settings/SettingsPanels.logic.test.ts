import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type AdvertisedEndpoint,
  type ProviderInstanceConfig,
} from "@axle/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildProviderInstanceUpdatePatch,
  defaultPairingEndpoint,
  formatDiagnosticsDescription,
  isPairingReachable,
  pairableAdvertisedEndpoints,
  pairingUnavailableReason,
} from "./SettingsPanels.logic";

function endpoint(input: {
  readonly id: string;
  readonly reachability: AdvertisedEndpoint["reachability"];
  readonly status?: AdvertisedEndpoint["status"];
  readonly providerId?: string;
  readonly isDefault?: boolean;
  readonly description?: string;
}): AdvertisedEndpoint {
  return {
    id: input.id,
    label: input.id,
    provider: {
      id: input.providerId ?? "core",
      label: input.providerId ?? "core",
      kind: input.providerId === "tailscale" ? "private-network" : "core",
      isAddon: input.providerId === "tailscale",
    },
    httpBaseUrl: `http://${input.id}:3773/`,
    wsBaseUrl: `ws://${input.id}:3773/`,
    reachability: input.reachability,
    compatibility: { hostedHttpsApp: "unknown", desktopApp: "compatible" },
    source: "desktop-core",
    status: input.status ?? "available",
    ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    ...(input.description === undefined ? {} : { description: input.description }),
  };
}

const LOOPBACK = endpoint({ id: "loopback", reachability: "loopback" });
const LAN = endpoint({ id: "lan", reachability: "lan", isDefault: true });
const TAILNET = endpoint({
  id: "tailnet",
  reachability: "private-network",
  providerId: "tailscale",
});
const TAILNET_UNCONFIGURED = endpoint({
  id: "tailnet",
  reachability: "private-network",
  providerId: "tailscale",
  status: "unavailable",
  description: "MagicDNS hostname. Configure Tailscale Serve for HTTPS access.",
});

describe("pairableAdvertisedEndpoints", () => {
  it("drops loopback, which can never reach a phone", () => {
    expect(pairableAdvertisedEndpoints([LOOPBACK, LAN]).map((e) => e.id)).toEqual(["lan"]);
  });

  it("keeps the desktop's default endpoint first so the same-wifi case is unchanged", () => {
    expect(pairableAdvertisedEndpoints([TAILNET, LAN]).map((e) => e.id)).toEqual([
      "lan",
      "tailnet",
    ]);
  });

  it("sorts unavailable endpoints last but still surfaces them", () => {
    expect(pairableAdvertisedEndpoints([TAILNET_UNCONFIGURED, LAN]).map((e) => e.id)).toEqual([
      "lan",
      "tailnet",
    ]);
  });

  it("returns nothing when only loopback is advertised", () => {
    expect(pairableAdvertisedEndpoints([LOOPBACK])).toEqual([]);
  });
});

describe("defaultPairingEndpoint", () => {
  it("prefers the LAN endpoint when both are available", () => {
    expect(defaultPairingEndpoint([LOOPBACK, LAN, TAILNET])?.id).toBe("lan");
  });

  it("falls back to the tailnet endpoint when LAN is not advertised", () => {
    expect(defaultPairingEndpoint([LOOPBACK, TAILNET])?.id).toBe("tailnet");
  });

  it("never selects an unavailable endpoint", () => {
    expect(defaultPairingEndpoint([LOOPBACK, TAILNET_UNCONFIGURED])).toBeNull();
  });
});

describe("isPairingReachable", () => {
  it("is false for a loopback-only desktop", () => {
    expect(isPairingReachable([LOOPBACK])).toBe(false);
  });

  it("is false when Tailscale is enabled but Serve is not configured", () => {
    expect(isPairingReachable([LOOPBACK, TAILNET_UNCONFIGURED])).toBe(false);
  });

  it("is true once any non-loopback endpoint is available", () => {
    expect(isPairingReachable([LOOPBACK, TAILNET])).toBe(true);
  });
});

describe("pairingUnavailableReason", () => {
  it("surfaces the provider's own explanation instead of a false positive", () => {
    expect(pairingUnavailableReason([LOOPBACK, TAILNET_UNCONFIGURED])).toBe(
      "MagicDNS hostname. Configure Tailscale Serve for HTTPS access.",
    );
  });

  it("is null when pairing is possible", () => {
    expect(pairingUnavailableReason([LOOPBACK, LAN])).toBeNull();
  });

  it("is null when there is no endpoint to explain", () => {
    expect(pairingUnavailableReason([LOOPBACK])).toBeNull();
  });
});

describe("formatDiagnosticsDescription", () => {
  it("collapses trace and metric URLs that share the same OTEL base path", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      }),
    ).toBe("Local trace file. Exporting OTEL to http://localhost:4318/v1/{traces,metrics}.");
  });

  it("keeps separate trace and metric URLs when their base paths differ", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:9000/v1/metrics",
      }),
    ).toBe(
      "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces and metrics to http://localhost:9000/v1/metrics.",
    );
  });

  it("omits OTEL text when no exporter is enabled", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      }),
    ).toBe("Local trace file.");
  });
});

describe("buildProviderInstanceUpdatePatch", () => {
  it("promotes an edited default provider into providerInstances and resets the legacy provider", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        binaryPath: "/opt/t3/codex",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/legacy/codex",
          },
        },
      },
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: true,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers?.codex).toEqual(DEFAULT_SERVER_SETTINGS.providers.codex);
  });

  it("updates custom instances without touching legacy provider settings", () => {
    const instanceId = ProviderInstanceId.make("codex_personal");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        homePath: "/Users/example/.codex-personal",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: DEFAULT_SERVER_SETTINGS,
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: false,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers).toBeUndefined();
  });
});
