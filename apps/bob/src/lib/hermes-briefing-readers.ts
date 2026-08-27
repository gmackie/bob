import {
  buildHermesEveningClose,
  type HermesBriefItem,
  type HermesBriefSnapshot,
  type HermesEveningClose,
} from "./hermes-briefing";
import {
  HERMES_BRIEFING_SOURCE_TIMEOUT_MS,
  readHermesBriefingSource,
} from "./hermes-briefing-timeout";

export const HERMES_ACTIVE_BOB_WORK_STATUSES = [
  "blocked",
  "in_progress",
  "in_review",
  "ready",
  "todo",
  "backlog",
  "draft",
  "pending",
] as const;

interface BobWorkBriefReaderDependencies {
  now(): Date;
  countActive(): Promise<Record<string, number>>;
  listActive(): Promise<Array<{
    id: string;
    identifier?: string;
    title: string;
    status: string;
  }>>;
}

export function createBobWorkBriefReader(
  dependencies: BobWorkBriefReaderDependencies,
): { read(): Promise<HermesBriefSnapshot> } {
  return {
    async read() {
      try {
        const [counts, active] = await Promise.all([
          dependencies.countActive(),
          dependencies.listActive(),
        ]);
        return {
          source: "bob",
          observedAt: dependencies.now().toISOString(),
          coverage: "complete",
          total: HERMES_ACTIVE_BOB_WORK_STATUSES.reduce(
            (sum, status) => sum + (counts[status] ?? 0),
            0,
          ),
          items: active.slice(0, 5).map((item) => ({
            label: `${item.status.toUpperCase()} · ${item.identifier ?? item.id} · ${item.title}`,
            canonicalRef: { kind: "work-item", id: item.id },
          })),
        };
      } catch {
        return {
          source: "bob",
          observedAt: null,
          coverage: "unknown",
          total: 0,
          items: [],
        };
      }
    },
  };
}

interface BobWorkStatusReaderDependencies {
  now(): Date;
  getById(id: string): Promise<{
    workItem: {
      id: string;
      identifier: string;
      title: string;
      status: string;
    };
  } | null>;
}

const BOB_WORK_IDENTIFIER = /\b([a-z][a-z0-9]*-\d+)\b/i;

export function createBobWorkStatusReader(
  dependencies: BobWorkStatusReaderDependencies,
): {
  read(query: string): Promise<{
    summary: string;
    canonicalRef: { kind: string; id: string };
    observedAt: string;
    coverage: "complete" | "partial" | "unknown";
  }>;
} {
  return {
    async read(query) {
      const observedAt = dependencies.now().toISOString();
      const identifier = BOB_WORK_IDENTIFIER.exec(query)?.[1]?.toUpperCase();
      if (!identifier) {
        return {
          summary:
            "Provide a Bob work-item identifier such as BOB-17 for canonical status.",
          canonicalRef: { kind: "status-query", id: "unresolved" },
          observedAt,
          coverage: "unknown",
        };
      }

      try {
        const result = await dependencies.getById(identifier);
        if (!result) {
          return {
            summary: `No accessible Bob work item was found for ${identifier}.`,
            canonicalRef: { kind: "status-query", id: identifier },
            observedAt,
            coverage: "unknown",
          };
        }
        const item = result.workItem;
        const terminal = ["completed", "done"].includes(item.status);
        return {
          summary: `${item.identifier} is ${item.status.replaceAll("_", " ").toUpperCase()}: ${item.title}${terminal
            ? ". Bob work-item state only; release, deployment, installation, and runtime evidence were not checked."
            : ""}`,
          canonicalRef: { kind: "work-item", id: item.id },
          observedAt,
          coverage: terminal ? "partial" : "complete",
        };
      } catch {
        return {
          summary: `Bob could not verify canonical status for ${identifier}.`,
          canonicalRef: { kind: "status-query", id: identifier },
          observedAt,
          coverage: "unknown",
        };
      }
    },
  };
}

interface OodaBriefReaderConfig {
  origin: string;
  apiKey: string;
  conversationId: string;
  branchId: string;
  now(): Date;
  fetch?: typeof fetch;
}

interface OodaListPage {
  items: unknown[];
  pageInfo: { hasMore: boolean };
}

function parseOodaListPage(value: unknown): OodaListPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OODA returned an invalid list page");
  }
  const row = value as Record<string, unknown>;
  const pageInfo = row.pageInfo;
  if (
    !Array.isArray(row.items)
    || !pageInfo
    || typeof pageInfo !== "object"
    || Array.isArray(pageInfo)
    || typeof (pageInfo as Record<string, unknown>).hasMore !== "boolean"
  ) {
    throw new Error("OODA returned an invalid list page");
  }
  return {
    items: row.items,
    pageInfo: {
      hasMore: (pageInfo as Record<string, unknown>).hasMore as boolean,
    },
  };
}

export function createOodaBriefReader(
  config: OodaBriefReaderConfig,
): {
  read(): Promise<HermesBriefSnapshot>;
  readClose(): Promise<{
    captured: HermesBriefItem[];
    tomorrow: HermesBriefItem[];
    gaps: string[];
  }>;
} {
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
  ) {
    throw new Error("OODA origin must be an explicit HTTPS URL");
  }
  if (!config.apiKey.trim()) throw new Error("OODA owner-scoped API key is required");
  const fetchImpl = config.fetch ?? fetch;
  const headers = { authorization: `Bearer ${config.apiKey}` };

  async function load() {
    const eventUrl = new URL("/api/v1/events", origin);
    eventUrl.search = new URLSearchParams({
      conversationId: config.conversationId,
      branchId: config.branchId,
      limit: "250",
    }).toString();
    const proposalUrl = new URL("/api/v1/proposals", origin);
    proposalUrl.search = new URLSearchParams({
      conversationId: config.conversationId,
      status: "awaiting_approval",
      limit: "100",
    }).toString();
    const [eventsResponse, proposalsResponse] = await Promise.all([
      fetchImpl(eventUrl, { headers }),
      fetchImpl(proposalUrl, { headers }),
    ]);
    if (!eventsResponse.ok || !proposalsResponse.ok) {
      throw new Error("OODA briefing read failed");
    }
    const [events, proposals] = await Promise.all([
      eventsResponse.json().then(parseOodaListPage),
      proposalsResponse.json().then(parseOodaListPage),
    ]);
    const proposalItems = proposals.items.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      if (
        typeof item.id !== "string"
        || typeof item.kind !== "string"
        || typeof item.destination !== "string"
        || item.status !== "awaiting_approval"
      ) return [];
      return [{
        label: `AWAITING APPROVAL · ${item.kind.replaceAll("_", " ").toUpperCase()} · ${item.destination}`,
        occurredAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        canonicalRef: { kind: "proposal", id: item.id },
      }];
    });
    const captureItems = events.items.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const payload = item.payload;
      if (
        typeof item.id !== "string"
        || typeof item.occurredAt !== "string"
        || !payload
        || typeof payload !== "object"
        || Array.isArray(payload)
        || (payload as Record<string, unknown>).source !== "hermes"
      ) return [];
      return [{
        label: `CAPTURED · ${item.occurredAt}`,
        occurredAt: item.occurredAt,
        canonicalRef: { kind: "conversation-event", id: item.id },
      }];
    });
    return { events, proposals, proposalItems, captureItems };
  }

  return {
    async read() {
      try {
        const { events, proposals, proposalItems, captureItems } = await load();
        const items = [...proposalItems, ...captureItems];
        return {
          source: "ooda",
          observedAt: config.now().toISOString(),
          coverage:
            events.pageInfo.hasMore || proposals.pageInfo.hasMore
              ? "partial"
              : "complete",
          total: items.length,
          items: items.slice(0, 5).map(({ label, canonicalRef }) => ({ label, canonicalRef })),
        };
      } catch {
        return {
          source: "ooda",
          observedAt: null,
          coverage: "unknown",
          total: 0,
          items: [],
        };
      }
    },
    async readClose() {
      try {
        const { events, proposals, proposalItems, captureItems } = await load();
        const date = config.now().toISOString().slice(0, 10);
        return {
          captured: captureItems
            .filter((item) => item.occurredAt.startsWith(date))
            .slice(0, 5)
            .map(({ label, canonicalRef }) => ({ label, canonicalRef })),
          tomorrow: proposalItems.slice(0, 5).map(({ canonicalRef, label }) => ({
            label: label.replace("AWAITING APPROVAL", "PROPOSED"),
            canonicalRef,
          })),
          gaps:
            events.pageInfo.hasMore || proposals.pageInfo.hasMore
              ? ["ooda reported partial coverage"]
              : [],
        };
      } catch {
        return { captured: [], tomorrow: [], gaps: ["ooda did not report"] };
      }
    },
  };
}

interface BobEveningCloseReaderDependencies {
  now(): Date;
  listChanged(updatedAfter: string): Promise<Array<{
    id: string;
    identifier?: string;
    title: string;
    status: string;
    updatedAt?: string | null;
  }>>;
}

export function createBobEveningCloseReader(
  dependencies: BobEveningCloseReaderDependencies,
) {
  return {
    async read() {
      try {
        const date = dependencies.now().toISOString().slice(0, 10);
        const listed = await dependencies.listChanged(`${date}T00:00:00.000Z`);
        const truncated = listed.length > 100;
        const changed = listed.slice(0, 100)
          .filter((item) => item.updatedAt?.slice(0, 10) === date);
        const itemsFor = (statuses: readonly string[]) => changed
          .filter((item) => statuses.includes(item.status))
          .slice(0, 5)
          .map((item) => ({
            label: `${item.status.replaceAll("_", " ").toUpperCase()} · ${item.identifier ?? item.id} · ${item.title}`,
            canonicalRef: { kind: "work-item", id: item.id },
          }));
        return {
          completed: itemsFor(["completed", "done"]),
          blocked: itemsFor(["blocked"]),
          waiting: itemsFor(["in_review", "pending"]),
          gaps: truncated ? ["bob work-item results were truncated"] : [],
        };
      } catch {
        return {
          completed: [],
          blocked: [],
          waiting: [],
          gaps: ["bob did not report"],
        };
      }
    },
  };
}

interface HermesEveningCloseReaderDependencies {
  now(): Date;
  bob: ReturnType<typeof createBobEveningCloseReader>;
  ooda: {
    readClose(): Promise<{
      captured: HermesBriefItem[];
      tomorrow: HermesBriefItem[];
      gaps: string[];
    }>;
  };
  supportingSources?: Partial<Record<
    "skillfleet" | "forgegraph",
    { read(): Promise<HermesBriefSnapshot> }
  >>;
  sourceTimeoutMs?: number;
}

const HERMES_EVENING_SUPPORTING_SOURCES = ["skillfleet", "forgegraph"] as const;
const HERMES_EVENING_MAX_SOURCE_AGE_MS = 15 * 60 * 1_000;
const HERMES_EVENING_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

async function readEveningSupportingGap(
  source: (typeof HERMES_EVENING_SUPPORTING_SOURCES)[number],
  reader: { read(): Promise<HermesBriefSnapshot> } | undefined,
  timeoutMs: number,
  referenceTimeMs: number,
): Promise<string[]> {
  if (!reader) return [`${source} did not report`];
  const snapshot = await readHermesBriefingSource(() => reader.read(), timeoutMs);
  if (!snapshot) return [`${source} did not report`];
  if (snapshot.source !== source || snapshot.coverage === "unknown") {
    return [`${source} did not report`];
  }
  const observedAtMs = Date.parse(snapshot.observedAt ?? "");
  if (
    !Number.isFinite(observedAtMs)
    || observedAtMs < referenceTimeMs - HERMES_EVENING_MAX_SOURCE_AGE_MS
    || observedAtMs > referenceTimeMs + HERMES_EVENING_MAX_FUTURE_SKEW_MS
  ) {
    return [`${source} did not report current evidence`];
  }
  if (snapshot.coverage === "partial") {
    return [`${source} reported partial coverage`];
  }
  return [];
}

export function createHermesEveningCloseReader(
  dependencies: HermesEveningCloseReaderDependencies,
): { read(): Promise<HermesEveningClose> } {
  const sourceTimeoutMs = dependencies.sourceTimeoutMs
    ?? HERMES_BRIEFING_SOURCE_TIMEOUT_MS;
  if (!Number.isSafeInteger(sourceTimeoutMs) || sourceTimeoutMs < 1) {
    throw new Error("Hermes close source timeout must be a positive integer");
  }
  return {
    async read() {
      const generatedAt = dependencies.now();
      const [bob, ooda, supportingGaps] = await Promise.all([
        readHermesBriefingSource(() => dependencies.bob.read(), sourceTimeoutMs)
          .then((result) => result ?? {
            completed: [],
            blocked: [],
            waiting: [],
            gaps: ["bob did not report"],
          }),
        readHermesBriefingSource(() => dependencies.ooda.readClose(), sourceTimeoutMs)
          .then((result) => result ?? {
            captured: [],
            tomorrow: [],
            gaps: ["ooda did not report"],
          }),
        Promise.all(HERMES_EVENING_SUPPORTING_SOURCES.map((source) =>
          readEveningSupportingGap(
            source,
            dependencies.supportingSources?.[source],
            sourceTimeoutMs,
            generatedAt.getTime(),
          )))
          .then((gaps) => gaps.flat()),
      ]);
      return buildHermesEveningClose(
        {
          completed: bob.completed,
          blocked: bob.blocked,
          waiting: bob.waiting,
          captured: ooda.captured,
          tomorrow: ooda.tomorrow,
        },
        generatedAt,
        [
          ...bob.gaps,
          ...ooda.gaps,
          ...supportingGaps,
        ],
      );
    },
  };
}

interface SkillfleetBriefReaderConfig {
  origin: string;
  readSecret: string;
  accessClientId: string;
  accessClientSecret: string;
  fetch?: typeof fetch;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Skillfleet returned an invalid count");
  }
  return value as number;
}

export function createSkillfleetBriefReader(
  config: SkillfleetBriefReaderConfig,
): { read(): Promise<HermesBriefSnapshot> } {
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
  ) {
    throw new Error("Skillfleet origin must be an explicit HTTPS URL");
  }
  if (!config.readSecret.trim()) {
    throw new Error("Skillfleet Hermes read secret is required");
  }
  if (!config.accessClientId.trim() || !config.accessClientSecret.trim()) {
    throw new Error("Skillfleet Access service identity is required");
  }
  const endpoint = new URL("/api/v1/hermes/brief", origin);
  const fetchImpl = config.fetch ?? fetch;

  return {
    async read() {
      try {
        const response = await fetchImpl(endpoint, {
          headers: {
            authorization: `Bearer ${config.readSecret}`,
            "cf-access-client-id": config.accessClientId,
            "cf-access-client-secret": config.accessClientSecret,
          },
        });
        if (!response.ok) throw new Error("Skillfleet briefing read failed");
        const value = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("Skillfleet returned an invalid briefing");
        }
        const row = value as Record<string, unknown>;
        const fleet = row.fleet;
        const usage = row.usage;
        if (
          row.schemaVersion !== 1
          || typeof row.observedAt !== "string"
          || (row.coverage !== "complete" && row.coverage !== "partial")
          || !fleet
          || typeof fleet !== "object"
          || Array.isArray(fleet)
          || !usage
          || typeof usage !== "object"
          || Array.isArray(usage)
        ) {
          throw new Error("Skillfleet returned an invalid briefing");
        }
        const fleetRow = fleet as Record<string, unknown>;
        const usageRow = usage as Record<string, unknown>;
        const fleetTotal = nonNegativeInteger(fleetRow.total);
        const online = nonNegativeInteger(fleetRow.online);
        const requests = nonNegativeInteger(usageRow.requests);
        const failed = nonNegativeInteger(usageRow.failed);
        const evidenceGaps = nonNegativeInteger(usageRow.evidenceGaps);
        if (online > fleetTotal || !Array.isArray(fleetRow.attention)) {
          throw new Error("Skillfleet returned an invalid fleet summary");
        }
        const attention = fleetRow.attention.map((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Skillfleet returned invalid machine attention");
          }
          const machine = value as Record<string, unknown>;
          if (typeof machine.machineId !== "string" || typeof machine.status !== "string") {
            throw new Error("Skillfleet returned invalid machine attention");
          }
          return {
            label: `ATTENTION · ${machine.machineId} · ${machine.status.toUpperCase()}`,
            canonicalRef: { kind: "machine", id: machine.machineId },
          };
        });
        const items = [
          ...(fleetTotal > 0
            ? [{
                label: `FLEET · ${online}/${fleetTotal} online`,
                canonicalRef: { kind: "fleet", id: "current" },
              }]
            : []),
          ...attention,
          ...(requests > 0
            ? [{
                label: `HERMES · ${requests} requests · ${failed} failed · ${evidenceGaps} evidence gaps`,
                canonicalRef: { kind: "hermes-usage", id: "current" },
              }]
            : []),
        ];
        return {
          source: "skillfleet",
          observedAt: row.observedAt,
          coverage: row.coverage,
          total: Math.max(fleetTotal + requests, items.length),
          items: items.slice(0, 5),
        };
      } catch {
        return {
          source: "skillfleet",
          observedAt: null,
          coverage: "unknown",
          total: 0,
          items: [],
        };
      }
    },
  };
}

interface ForgeGraphBriefReaderConfig {
  origin: string;
  apiKey: string;
  appSlugs: readonly string[];
  now(): Date;
  fetch?: typeof fetch;
}

export function createForgeGraphBriefReader(
  config: ForgeGraphBriefReaderConfig,
): { read(): Promise<HermesBriefSnapshot> } {
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
  ) {
    throw new Error("ForgeGraph origin must be an explicit HTTPS URL");
  }
  if (!config.apiKey.trim()) throw new Error("ForgeGraph API key is required");
  const appSlugs = config.appSlugs
    .map((value) => value.trim())
    .filter((value) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    .slice(0, 12);
  if (appSlugs.length === 0) throw new Error("ForgeGraph app slugs are required");
  const fetchImpl = config.fetch ?? fetch;
  const headers = { authorization: `Bearer ${config.apiKey}` };

  return {
    async read() {
      const settled = await Promise.allSettled(appSlugs.map(async (appSlug) => {
        const endpoint = new URL("/api/fg/changesets", origin);
        endpoint.searchParams.set("app", appSlug);
        const response = await fetchImpl(endpoint, { headers });
        if (!response.ok) throw new Error("ForgeGraph changeset read failed");
        const value = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("ForgeGraph returned an invalid changeset list");
        }
        const changesets = (value as Record<string, unknown>).changesets;
        if (!Array.isArray(changesets)) {
          throw new Error("ForgeGraph returned an invalid changeset list");
        }
        return changesets.flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return [];
          }
          const row = candidate as Record<string, unknown>;
          if (
            typeof row.id !== "string"
            || typeof row.title !== "string"
            || typeof row.status !== "string"
          ) return [];
          return [{
            label: `${appSlug.toUpperCase()} · ${row.status.replaceAll("_", " ").toUpperCase()} · ${row.title}`,
            canonicalRef: { kind: "changeset", id: row.id },
          }];
        });
      }));
      const successful = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []);
      if (successful.length === 0) {
        return {
          source: "forgegraph",
          observedAt: null,
          coverage: "unknown",
          total: 0,
          items: [],
        };
      }
      const items = successful.flat();
      return {
        source: "forgegraph",
        observedAt: config.now().toISOString(),
        coverage: successful.length === appSlugs.length ? "complete" : "partial",
        total: items.length,
        items: items.slice(0, 5),
      };
    },
  };
}
