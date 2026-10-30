import { AsyncLocalStorage } from "node:async_hooks";
import z from "@deepseek-ai/schemastery";
import { RemoteResult, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/identity.d.ts
/**
 * Component and package identity.
 *
 * The same plugin answers to several names, and they are not interchangeable:
 * see `AGENTS.md` ("Package vs component") for the full mapping. Keeping the
 * literals here — rather than scattered across `index.ts`, `lifecycle.ts` and
 * the client bundle — makes the one place that must agree with
 * `package.json`/`cordis.patch.yml` obvious.
 *
 * @module dsh-opencode-patch/identity
 */
/** Component identity (log lines, service scoping). */
export declare const name = "dsh-opencode-patch";
/** Pre-rename component identity; rows using it get a rename notice. */
export declare const LEGACY_NAME = "dsh-opencode";
/** Pre-rename npm package; rows using it get a rename notice. */
export declare const LEGACY_PKG = "@viztor/dsh-opencode";
/** Host injections: the plugin needs the `llm` stream lifecycle. */
export declare const inject: string[];
/**
 * The OpenCode CLI version this plugin claims to be.
 *
 * The User-Agent is origin proof: the gateway reads it to decide whether the
 * caller is the official CLI, so it has to name a version the CLI actually has.
 * It is a single constant here, and every other place that needs it imports it,
 * because seven hand-copied strings are seven chances to disagree and nothing
 * notices when one drifts - a stale patch version still looks like a version.
 * `pnpm run cli:version` compares this against the published CLI.
 *
 * The pin names the 1.x line - the generation this plugin emulates, and what
 * the registry's `latest` tag publishes. The 2.x line ships as
 * `0.0.0-<channel>-*` snapshots under the `dev`/`next`/`beta` tags; nothing
 * here claims it, and a claim that did would need its own constant.
 */
export declare const OPENCODE_CLI_VERSION = "1.19.4";
/**
 * The User-Agent the stream hook sends: the CLI's own shape, verbatim.
 *
 * `packages/opencode/src/session/llm/request.ts:18` is
 * `opencode/${InstallationVersion}` and nothing more - no SDK, no runtime, no
 * build. The `ai-sdk/provider-utils/… runtime/bun/…` tail this sent was the AI
 * SDK's own User-Agent, which is what a DIFFERENT transport stamps on a request;
 * it is not the client's, and 2.x changed the shape again to
 * `opencode/<channel>/<version>/<client>` (`packages/core/src/app.ts:24`).
 */
export declare const OPENCODE_USER_AGENT = "opencode/1.19.4";
/** The User-Agent the plugin signs its own requests with. */
export declare const OPENCODE_PATCH_USER_AGENT = "opencode/1.19.4 dsh-opencode-patch";
//#endregion
//#region src/config-values.d.ts
/**
 * Coercion readers shared by the host config resolver and the client card, so
 * both apply the same "absent or invalid means default" rule. Dependency-free by
 * design: importing schemastery would ship the validator to the browser.
 *
 * @module dsh-opencode-patch/config-values
 */
/** Marker meaning "apply to every model" instead of a literal substring. */
export declare const ALL_MODELS_MARKER = "*";
/**
 * Provider routes the plugin claims: intercepted for headers, and the routes
 * whose quota the meter reports. One list, because they are the same set — a
 * route we do not intercept carries no OpenCode headers and has no quota to
 * show.
 *
 * **It must cover every route this layer mounts**, which is the invariant the
 * list is for. `llm-pi-ai` carries one `api` per route and offers no per-model
 * override, so each non-default protocol needs its own route: Responses and
 * Messages for each plane, plus the Google bridge's route. An unclaimed route
 * gets no session header, no origin headers, and no key injection.
 *
 * `opencode-google` was missing here while every other internal route was
 * present. It mattered less before the picker began publishing the whole catalog
 * on the parent route; now a Google model is reachable and dispatched to this
 * route, so it has to be claimed like the rest. It is mounted by the Google
 * bridge (`google-bridge.ts`) rather than the wrapper, which is why it is easy to
 * forget: `SELF_MOUNTED_ROUTES` excludes it from the wrapper's mount loop.
 *
 * Shared here rather than in `config.ts` so the client bundle can read the same
 * default without importing schemastery.
 */
export declare const DEFAULT_PROVIDERS: string[];
/**
 * Whether the meter shows session spend and the active model's rate. Shared
 * here because the host schema's default and the client pill's fallback gate
 * must agree on the same value.
 */
/**
 * Which credential source wins when more than one resolves.
 *
 * Declared here rather than in `config.ts` so the client card can read the same
 * list without importing schemastery. `AGENTS.md` → "Key resolution" records what
 * each policy orders, and why the default is not a behaviour change.
 */
export declare const KEY_SOURCE_POLICIES: readonly ["auto", "request", "configured"];
/** One accepted {@link KEY_SOURCE_POLICIES} value. */
type KeySourcePolicy = (typeof KEY_SOURCE_POLICIES)[number];
/** Policy applied when a row does not name one. */
export declare const DEFAULT_KEY_SOURCE: KeySourcePolicy;
/**
 * Which endpoint family the gateway's requests go to.
 *
 * The gateway answers on two families and the user, not the catalog, is the one
 * who knows which their account is entitled to:
 *
 * - `auto` follows the catalog — the `api` the vendor's own entry names, which
 *   today is the `inference` family.
 * - `legacy` forces the older `/zen/v1` pair.
 * - `modern` forces the newer `/inference/v1` pair.
 *
 * Declared here rather than in `config.ts` so the client card can read the same
 * list without importing schemastery.
 */
export declare const ENDPOINT_FAMILIES: readonly ["auto", "legacy", "modern"];
/** One accepted {@link ENDPOINT_FAMILIES} value. */
type EndpointFamily = (typeof ENDPOINT_FAMILIES)[number];
/** Family applied when a row does not name one. */
export declare const DEFAULT_ENDPOINT_FAMILY: EndpointFamily;
/**
 * Unwrap a schemastery volatile `.get()` node to its current value.
 *
 * Idempotent: plain values pass through untouched, so the host behaves
 * identically whether the row carries explicit values, schema-defaulted
 * nodes, or raw JSON.
 */
export declare const unwrapNode: (val: unknown) => unknown;
/**
 * Read a boolean: an explicit boolean wins, non-boolean junk degrades to
 * `fallback` rather than toggling the feature by accident.
 */
export declare const readBoolean: (value: unknown, fallback: boolean) => boolean;
/**
 * Read a trimmed string, or `undefined` when absent/blank.
 *
 * @param value - raw value, possibly a volatile node.
 */
export declare const readString: (value: unknown) => string | undefined;
/**
 * Read a trimmed list of non-blank strings, dropping anything else.
 *
 * @param value - raw value, possibly a volatile node.
 * @returns the valid trimmed entries; empty when the value is not a usable list.
 */
export declare const readStringList: (value: unknown) => string[];
//#endregion
//#region src/config.d.ts
/**
 * Optional user-defined overrides for a specific model in configuration.
 * Allows tuning contextWindow, maxTokens, name, reasoningEfforts, etc. per model.
 */
/**
 * One model's wire routing, in the shape the catalog uses.
 *
 * `api` is a pi protocol (`openai-completions`, `openai-responses`,
 * `anthropic-messages`, `google-generative-ai`); `baseURL` is the endpoint that
 * model is sent to. Both are optional, and an absent field means "whatever the
 * shim and its live refresh computed".
 */
interface ModelRouteConfig {
  /** The pi protocol this model speaks. */
  readonly api?: string;
  /** The endpoint this model is sent to, when it differs from the catalog's. */
  readonly baseURL?: string;
}
interface ModelOverrideConfig {
  /** Custom context window limit in tokens. */
  readonly contextWindow?: number;
  /** Custom maximum output generation tokens. */
  readonly maxTokens?: number;
  /** Custom display name. */
  readonly name?: string;
  /** Custom reasoning efforts to offer. */
  readonly reasoningEfforts?: readonly string[];
  /** Custom input modalities (e.g. ["text", "image"]). */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Custom token pricing override. */
  readonly cost?: {
    readonly input: number;
    readonly output: number;
    readonly cache_read?: number;
    readonly cache_write?: number;
  };
}
/**
 * URL substrings that mark a request as OpenCode gateway traffic even when no
 * turn is active. Configurable so mirrors, proxies, and self-hosted gateways
 * can be targeted without a code change.
 */
/**
 * URL substrings marking gateway traffic.
 *
 * Both endpoint families: the older `zen` one and the `inference` one OpenCode
 * 2.x's catalog names. A request on either belongs to this plugin, and the
 * credential's format decides which of the two it is actually sent to - see
 * `endpoint-pairing.ts`.
 */
export declare const DEFAULT_GATEWAY_URLS: string[];
/** Value restored into `x-opencode-client` by default. */
export declare const DEFAULT_ORIGIN_CLIENT = "cli";
/** Whether to attach the workspace project identifier (x-opencode-project) by default. */
export declare const DEFAULT_INJECT_PROJECT = true;
/**
 * Model-id substring that marks a request as free-tier (and therefore in need
 * of the core-tool schema fallback).
 */
export declare const DEFAULT_FREE_MODEL_MARKER = "free";
/** Environment variable consulted for the fallback session id. */
export declare const DEFAULT_SESSION_ID_ENV = "OPENCODE_SESSION_ID";
/** Default OpenCode Go quota endpoint. */
export declare const DEFAULT_USAGE_BASE_URL = "https://opencode.ai/zen/go/v1";
/** Default environment variable / credential ref holding the Go key. */
export declare const DEFAULT_USAGE_KEY_ENV = "OPENCODE_GO_API_KEY";
/**
 * The single source of truth for every documented default. Blank / absent
 * user values fall back to these; the `Config` schema `.default()`s to the
 * same values.
 */
export declare const CONFIG_DEFAULTS: {
  readonly credentialOrg: string | undefined;
  readonly debug: false;
  readonly enrichModels: true;
  readonly endpoint: "auto" | "legacy" | "modern";
  readonly freeModelMarker: "free";
  readonly gatewayUrls: string[];
  readonly injectCoreTools: true;
  readonly injectOriginHeaders: true;
  readonly injectProject: true;
  readonly injectUserAgent: true;
  readonly keySource: "auto" | "configured" | "request";
  readonly maxContextWindow: number | undefined;
  readonly modelOverrides: Readonly<Record<string, ModelOverrideConfig>>;
  readonly modelRoutes: Readonly<Record<string, ModelRouteConfig>>;
  readonly internalRoutes: true;
  readonly originClient: "cli";
  readonly providers: string[];
  readonly readOpencodeStore: false;
  readonly sessionIdEnv: "OPENCODE_SESSION_ID";
  readonly usageBaseURL: "https://opencode.ai/zen/go/v1";
  readonly usageEnabled: true;
};
/** The raw shape a cordis row's `config` may carry (all optional). */
interface PluginConfig {
  credentialOrg?: string;
  debug?: boolean;
  debugFile?: string;
  enrichModels?: boolean;
  endpoint?: EndpointFamily;
  freeModelMarker?: string;
  gatewayUrls?: string[];
  injectCoreTools?: boolean;
  injectOriginHeaders?: boolean;
  injectProject?: boolean;
  injectUserAgent?: boolean;
  keySource?: KeySourcePolicy;
  maxContextWindow?: number;
  modelOverrides?: Record<string, ModelOverrideConfig>;
  /**
   * Per-model wire routing, in the shape the catalog uses: `api` is the protocol
   * and `baseURL` the endpoint for that model.
   *
   * This is the OVERRIDE layer over what the shim and its live refresh computed.
   * A model whose protocol the catalog puts on an internal route can be pinned
   * here instead, and a curated deployment that declares its own providers for
   * the other protocols can switch {@link internalRoutes} off entirely.
   */
  modelRoutes?: Record<string, ModelRouteConfig>;
  /**
   * Whether to mount the internal per-protocol routes.
   *
   * On (default) the plugin registers a route for every protocol a plane serves,
   * so a declared model that speaks Anthropic or Google is reachable with no
   * configuration. Each mounted route is a provider whose model list is the
   * WHOLE protocol catalog — the price of not being able to see the deployment's
   * own selection from inside a plugin. A deployment that writes its own provider
   * entries for those protocols turns this off and declares `modelRoutes` for the
   * models that need it.
   */
  internalRoutes?: boolean;
  originClient?: string;
  providers?: string[];
  readOpencodeStore?: boolean;
  sessionIdEnv?: string;
  userAgent?: string;
  usageBaseURL?: string;
  usageEnabled?: boolean;
}
/** The fully-defaulted shape the plugin's runtime branches read. */
interface ResolvedPluginConfig {
  /**
   * The org to send with an account credential, when the credential does not
   * carry one itself.
   *
   * A session token needs the org it belongs to: measured on a paid model,
   * `200` with the org and `403` without. It never unlocked the free tier —
   * nothing sent from a request does. A login performed by this plugin stores
   * the org beside the token, so a deployment that logged in needs nothing
   * here — this is for one whose token came from somewhere else.
   */
  readonly credentialOrg: string | undefined;
  debug: boolean;
  debugFile?: string;
  enrichModels: boolean;
  /**
   * Which endpoint family the gateway's requests go to.
   *
   * The two families are independently entitled and both are still served, so
   * the choice is the user's: `auto` follows the catalog, and `legacy` /
   * `modern` pin one. See {@link ENDPOINT_FAMILIES}.
   */
  endpoint: EndpointFamily;
  /** `*` when the core-tool fallback should run for every model. */
  freeModelMarker: string;
  /** Ids withheld from every listing; empty unless the deployment names some. */
  /** URL substrings marking gateway traffic; never empty after resolution. */
  gatewayUrls: string[];
  injectCoreTools: boolean;
  injectOriginHeaders: boolean;
  injectProject: boolean;
  injectUserAgent: boolean;
  /** Which credential source wins when more than one resolves. */
  keySource: KeySourcePolicy;
  /** Optional ceiling to clamp model context windows. */
  maxContextWindow?: number;
  /** Optional per-model configuration overrides. */
  readonly modelOverrides: Readonly<Record<string, ModelOverrideConfig>>;
  /** The per-model protocol/base overrides, keyed by model id. */
  readonly modelRoutes: Readonly<Record<string, ModelRouteConfig>>;
  /** Whether the internal per-protocol routes are mounted. */
  readonly internalRoutes: boolean;
  originClient: string;
  providers: Set<string>;
  /**
   * Whether the OpenCode installation's own credential store may be read.
   *
   * Off by default, and LAST in the resolution order when on: reading another
   * program's private store is something a user turns on, and a credential they
   * declared in DSH always outranks one inferred from the installation.
   */
  readonly readOpencodeStore: boolean;
  sessionIdEnv: string;
  userAgent?: string;
  usageBaseURL: string;
  usageEnabled: boolean;
}
export declare const resolveConfig: (rawInput?: PluginConfig) => ResolvedPluginConfig;
/**
 * The plugin's settings schema, in the harness's own `@deepseek-ai/schemastery`
 * fork (not the public line): it implements the `~standard` surface the loader
 * uses to validate the row, and the settings UI relies on the same schema to
 * serve the namespace the client card binds.
 *
 * Exporting this is what makes the row render as a real settings section
 * rather than free-form YAML: `dsh-settings` filters out any schema whose
 * fields are not marked `.volatile()`, so without `.volatile()` on these fields
 * the namespace is omitted from `describe()`, `configForms.whileServed` never
 * fires, and the Plugins page shows the bundle with no card.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
  providers: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  gatewayUrls: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  injectUserAgent: z<boolean, boolean, "volatile-defined">;
  userAgent: z<string, string, "volatile">;
  keySource: z<string, string, "volatile-defined">;
  readOpencodeStore: z<boolean, boolean, "volatile-defined">;
  injectOriginHeaders: z<boolean, boolean, "volatile-defined">;
  originClient: z<string, string, "volatile-defined">;
  injectProject: z<boolean, boolean, "volatile-defined">;
  injectCoreTools: z<boolean, boolean, "volatile-defined">;
  freeModelMarker: z<string, string, "volatile-defined">;
  sessionIdEnv: z<string, string, "volatile-defined">;
  usageEnabled: z<boolean, boolean, "volatile-defined">;
  enrichModels: z<boolean, boolean, "volatile-defined">;
  endpoint: z<string, string, "volatile-defined">;
  maxContextWindow: z<number, number, "volatile">;
  modelOverrides: z<any, any, "volatile-defined">;
  modelRoutes: z<any, any, "volatile-defined">;
  internalRoutes: z<boolean, boolean, "volatile-defined">;
  usageBaseURL: z<string, string, "volatile-defined">;
  credentialOrg: z<string, string, "volatile">;
  debug: z<boolean, boolean, "defined">;
  debugFile: z<string, string, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
  providers: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  gatewayUrls: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  injectUserAgent: z<boolean, boolean, "volatile-defined">;
  userAgent: z<string, string, "volatile">;
  keySource: z<string, string, "volatile-defined">;
  readOpencodeStore: z<boolean, boolean, "volatile-defined">;
  injectOriginHeaders: z<boolean, boolean, "volatile-defined">;
  originClient: z<string, string, "volatile-defined">;
  injectProject: z<boolean, boolean, "volatile-defined">;
  injectCoreTools: z<boolean, boolean, "volatile-defined">;
  freeModelMarker: z<string, string, "volatile-defined">;
  sessionIdEnv: z<string, string, "volatile-defined">;
  usageEnabled: z<boolean, boolean, "volatile-defined">;
  enrichModels: z<boolean, boolean, "volatile-defined">;
  endpoint: z<string, string, "volatile-defined">;
  maxContextWindow: z<number, number, "volatile">;
  modelOverrides: z<any, any, "volatile-defined">;
  modelRoutes: z<any, any, "volatile-defined">;
  internalRoutes: z<boolean, boolean, "volatile-defined">;
  usageBaseURL: z<string, string, "volatile-defined">;
  credentialOrg: z<string, string, "volatile">;
  debug: z<boolean, boolean, "defined">;
  debugFile: z<string, string, "plain">;
}>>, "plain">;
//#endregion
//#region src/cordis-context.d.ts
/**
 * Structural view of the Cordis host context.
 *
 * The host plugin cannot import `@deepseek-ai/cordis` types: that package
 * ships with the Harness installation, not as a dependency of this package.
 * So the context surface the plugin actually touches is declared here as
 * minimal interfaces, and every narrow step is a runtime-checked predicate
 * (never an `as` cast) — mock contexts in tests and future Cordis versions
 * both fail loudly instead of silently mis-shaping.
 *
 * @module dsh-opencode-patch/cordis-context
 */
/**
 * The disposer `llm.registerAdapter` returns.
 *
 * It is a **callable**, not an object with a `dispose` method, and it carries an
 * atomic route swap: `replace(providers)` re-points the same adapter at a new
 * route set. A stand-in handed to a plugin that expects the real contract has to
 * answer both, or the plugin's own re-registration path throws on a missing
 * method rather than on the conflict it should be reporting.
 */
type AdapterRegistrationLike = (() => void) & {
  replace?: (providers: readonly string[]) => void;
};
/**
 * The directory counterpart of {@link AdapterRegistrationLike}: withdraws every
 * configurable provider a registration holds, and swaps them atomically.
 */
type DirectoryRegistrationLike = (() => void) & {
  replace?: (entries: readonly unknown[]) => void;
};
/** Logging + lifecycle capabilities `apply()` uses. */
interface CordisContext {
  effect?: (fn: () => unknown, name?: string) => void;
  /**
   * A child context with extra metadata on top of this scope, prototypally
   * inheriting every property. Own properties of the metadata shadow the
   * inherited ones, which is how a service can be shadowed for one subtree
   * without the parent being mutated.
   */
  extend?: (meta?: Record<string, unknown>) => CordisContext;
  get?: (name: string) => unknown;
  inject?: (deps: string[], cb: (scope: unknown) => void) => void;
  /**
   * The ROOT context of this composition.
   *
   * Cordis exposes it on every context (`typert-protocol` reads `ctx.root` to
   * install its invocation accessor), and it is the only scope whose lifetime is
   * the process rather than one activation — which is what a service the
   * Gateway scans has to have. Optional because a stand-in host may not carry it;
   * the callers fall back to the context they were given.
   */
  root?: CordisContext;
  /**
   * The loader's entry list. Every configured entry the host loaded keeps its
   * raw import result there, which is how the plugin reaches a package it is
   * deliberately not a dependency of.
   */
  loader?: LoaderService;
  llm?: {
    /**
     * Offer to interrogate provider endpoints on behalf of one settings
     * namespace. Uniqueness is by namespace, so a second registration under the
     * same one is a conflict rather than a replacement.
     */
    registerModelDiscovery?: (ns: string, discover: (request?: unknown, signal?: AbortSignal) => Promise<unknown>) => (() => void) | undefined;
    /** Declare routes a plugin can activate through configuration. */
    registerConfigurableProviders?: (entries: readonly unknown[]) => DirectoryRegistrationLike | undefined;
    discoverModels?: (settingsNs: string, request?: unknown, signal?: AbortSignal) => Promise<unknown>;
    /**
     * Re-dispatch a generation. Used to hand a call to the route whose `api`
     * already names the format it needs, instead of translating the protocol.
     */
    stream?: (options: unknown) => unknown;
    /** Registered provider routes, for checking a target exists before using it. */
    listProviders?: () => unknown;
    /** Routes offered in Settings → Models. */
    listConfigurableProviders?: () => unknown;
    /**
     * Register an adapter for routes the plugin owns. Used to serve the
     * gateway's Responses plane without the user declaring anything.
     */
    registerAdapter?: (providers: readonly string[], adapter: unknown) => AdapterRegistrationLike | undefined;
    /**
     * The models one route advertises. The browser catalog turns each route into
     * a group and DROPS groups with no models, so this is how an internal route
     * stays out of the picker.
     */
    listModels?: (provider: string) => Promise<unknown>;
    /**
     * One exact model's capabilities. What the model picker's Effort row reads:
     * a route that reports no `reasoning` here shows no thinking-level control,
     * which is why {@link decorateModelInfo} fills the gap for the plane routes.
     */
    resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<unknown>;
  };
  /**
   * A child context whose reads and writes of `name` resolve in a new scope.
   * Used to hide the authorization seam from a mounted `llm-pi-ai` instance, so
   * it registers no auth flows and cannot collide with the host's own.
   */
  isolate?: (name: string) => CordisContext;
  /**
   * Register a service on the current fiber. The only write a live context
   * proxy accepts from a running fiber: an ad-hoc property set for a name that
   * was never provided is rejected, which is a load failure rather than a
   * degraded feature.
   */
  provide?: (name: string, value: unknown) => unknown;
  logger?: {
    info?: (msg: string, ...args: unknown[]) => void;
    warn?: (msg: string, ...args: unknown[]) => void;
  };
  on?: (event: string, callback: (options: unknown, next: () => unknown, ...rest: unknown[]) => unknown, options?: {
    prepend?: boolean;
  }) => void;
  /**
   * Start a plugin in this context and return its fiber. A plugin is a function
   * or an object with an `apply` method — which is exactly what `llm-pi-ai`
   * exports, so this is how the plugin mounts it.
   */
  plugin?: (plugin: unknown, config?: unknown) => PluginFiber | undefined;
}
/**
 * The fiber `ctx.plugin` starts a plugin in.
 *
 * **Not thenable.** Cordis's `Fiber` has no `then`, so `await fiber` resolves
 * immediately with the fiber itself and swallows nothing: `await()` is the
 * method that waits for the lifecycle work and rethrows a startup or
 * config-validation error. Without calling it, a mount that failed validation
 * looks exactly like one that succeeded.
 */
interface PluginFiber {
  /** Wait for current lifecycle work, rethrowing a startup error if any. */
  await?: () => Promise<unknown>;
  /** Dispose and unload; resolves once the unwind is complete. */
  dispose?: () => Promise<unknown>;
}
/**
 * Structural claim satisfied by any context exposing the loader's entry list.
 *
 * `unwrapExports` is what turns an entry's RAW import result into the plugin
 * object the registry would have applied — the same normalization the loader
 * itself performs, so a default-export or CJS-interop shape needs no second
 * guess here.
 */
interface LoaderHost {
  loader: {
    entries: () => Iterable<unknown>;
    unwrapExports?: (exports: unknown) => unknown;
  };
}
/** The loader surface, as the plugin reads it off its own context. */
type LoaderService = LoaderHost["loader"];
//#endregion
//#region src/lifecycle.d.ts
export declare const apply: (ctx: CordisContext, rawConfig?: PluginConfig) => void;
//#endregion
//#region src/utils/session-id.d.ts
/**
 * OpenCode session identity: the RULES, as pure functions.
 *
 * The gateway rejects requests without a valid OpenCode session id, and the id
 * must stay stable for a DSH session or every turn looks like a new conversation
 * to the prompt cache. The rules that decide one — how it is derived from a
 * digest, which of several candidate ids wins, what the gateway will accept —
 * are all functions of their arguments, so they live here and are tested by
 * calling them.
 *
 * Two things deliberately stayed out:
 *
 *   - **the hash.** `openCodeSessionIdFor` takes the already-computed digest, so
 *     the construction is pure and the `node:crypto` call sits at the caller.
 *     The shape below is a whole algorithm; testing it should not require
 *     arranging a crypto module.
 *   - **the environment read.** `sessionIdForRequest` takes the value the
 *     variable held, not its name. A rule that reaches into `process.env` is a
 *     rule a test has to mutate the process to exercise.
 *
 * @module dsh-opencode-patch/utils/session-id
 */
/** Header carrying the derived OpenCode session id. */
export declare const SESSION_HEADER = "x-opencode-session";
/** Generic proxy session affinity header used by gateways and connection pools. */
export declare const SESSION_AFFINITY_HEADER = "x-session-affinity";
/** Header carrying the derived OpenCode parent session id for subagents. */
export declare const PARENT_SESSION_HEADER = "x-opencode-parent-session-id";
/** Generic parent session header used by third-party proxies. */
export declare const PARENT_SESSION_ALT_HEADER = "x-parent-session-id";
/** The digest the id is derived from. */
interface SessionDigest {
  /** The 32-byte SHA-256 of the DSH session id. */
  readonly bytes: Uint8Array;
  /** Those bytes as lowercase hex. */
  readonly hex: string;
}
/**
 * Whether a string is a session id the gateway will accept.
 *
 * The shape is `ses_` + 12 hex + 14 base62, which is what {@link deriveSessionId}
 * produces and what the client's own ids look like.
 *
 * This exists because a prefix is not a format. A configuration that pins
 * `x-opencode-session: ses_dsh_default` starts with `ses_` and is not a session
 * id at all — the gateway answers it `401 Invalid API key`, which reads as a
 * credential fault and is really a malformed header. Anything that cannot be
 * accepted is better replaced with a derived id than sent as written.
 *
 * @param value - the candidate.
 * @returns whether it is a session id the gateway accepts.
 */
export declare const isOpenCodeSessionId: (value: unknown) => value is string;
/**
 * Whether a string is a message id the client could have minted.
 *
 * Same shape rule as {@link isOpenCodeSessionId}, and for the same reason: a
 * prefix is not a format. Anything that cannot be read is better dropped than
 * sent — the gateway reads this value for per-request metrics, and unlike a
 * session id there is no fallback that would repair a malformed one.
 *
 * @param value - the candidate.
 * @returns whether it is a message id the gateway will read.
 */
export declare const isOpenCodeMessageId: (value: unknown) => value is string;
/**
 * The session id a deployment PINNED, or a derived default.
 *
 * A pinned id is used only when the gateway would accept it, because
 * `ses_dsh_default` starts with `ses_` and is not a session id at all — sending
 * it earns a `401 Invalid API key`, which reads as a credential fault and is
 * really a malformed header. Anything that cannot be accepted is replaced by a
 * derived id rather than sent as written.
 *
 * Takes the VALUE the variable held, not its name: reading `process.env` here
 * would make this rule a thing a test has to mutate the process to exercise.
 *
 * @param pinned - the value the environment held, if any.
 * @param digestOf - derives a digest for a DSH session id; injected so this
 *   module needs no crypto.
 * @returns a session id the gateway accepts.
 */
export declare const pinnedSessionId: (pinned: unknown, digestOf: (sessionId: string) => SessionDigest) => string;
/**
 * Which session id a request carries, given everything that could decide it.
 *
 * The precedence, in order:
 *
 *   1. the id of the turn that issued the request — the only source with
 *      certainty, because it is the conversation actually running;
 *   2. a header the deployment pinned, when the gateway would accept it;
 *   3. a derived default.
 *
 * Extracted from the fetch patch, where it was an inline three-branch closure:
 * unreachable from a test, and therefore uncovered by construction.
 *
 * @param turnSessionId - the turn's own session id, when a turn is tracked.
 * @param pinnedHeader - the `x-opencode-session` the request already carried.
 * @param pinnedEnv - the id the session-id environment variable held.
 * @param digestOf - derives a digest for a DSH session id.
 * @returns the id to send.
 */
export declare const sessionIdForRequest: (turnSessionId: string | undefined, pinnedHeader: unknown, pinnedEnv: unknown, digestOf: (sessionId: string) => SessionDigest) => string;
//#endregion
//#region src/session.d.ts
/** Canonical OpenCode CLI User-Agent the DSH LLM adapter strips. */
export declare const OPENCODE_UA = "opencode/1.19.4";
/**
 * Derive the OpenCode session id for a DSH session.
 *
 * The construction is `utils/session-id.ts`; this is where the digest comes
 * from. Split so the algorithm is testable without arranging a crypto module,
 * and so the one impure step is visible as exactly one line.
 *
 * @param sessionId - the DSH session id.
 * @param createdAt - that session's creation time in ms, when known.
 * @returns the derived `ses_…` id.
 */
export declare const openCodeSessionIdFor: (sessionId: string | number, createdAt?: number) => string;
/**
 * Session id for a streamed turn, or `undefined` when there is none to carry.
 *
 * Always derives: raw DSH UUIDs satisfy no gateway, while derived `ses_…`
 * values route stably everywhere a UUID would.
 *
 * @param sessionId - the DSH session id carried by the turn.
 * @param createdAt - that session's creation time in milliseconds, when the
 * Host's session service can supply it.
 */
export declare const headerValueFor: (sessionId: string | number | undefined | null, createdAt?: number) => string | undefined;
/**
 * Fallback session id for requests issued outside any tracked turn.
 *
 * Prefers the configured environment variable (headless runs pin one id per
 * process) and otherwise derives a stable id for the reserved `"default"`
 * conversation. This is the one function here that reads the environment: the
 * RULE it applies is `pinnedSessionId` in `utils/`, which takes the value.
 *
 * @param envName - environment variable consulted first; defaults to
 * `OPENCODE_SESSION_ID` when blank.
 */
export declare const fallbackSessionId: (envName?: string) => string;
/**
 * A fresh message id for `x-opencode-request`, minted the way the vendor does.
 *
 * Identity for the gateway's own metrics and accounting, not affinity: the
 * vendor mints a fresh one per user message, so this does too. The only stateful
 * function in this module, which is why it is here rather than in `utils/`.
 *
 * @param now - the millisecond to anchor the id to.
 * @returns a `msg_<12hex><14base62>` id.
 */
export declare const newOpenCodeMessageId: (now?: number) => string;
//#endregion
//#region src/turn-store.d.ts
/** What one active streamed turn contributes to outgoing requests. */
interface ActiveTurnState {
  model?: string;
  parentValue?: string;
  project?: string;
  provider: string;
  /**
   * The `x-opencode-request` value for the turn: the id of the user message the
   * turn answers, in the client's own `msg_` shape. Minted once per turn
   * (`newOpenCodeMessageId` in `session.ts`) so every request the turn issues
   * carries one id, as the client's own do; absent for requests issued outside
   * any tracked turn — the usage and discovery calls — which send no such
   * header.
   */
  requestValue?: string;
  value: string;
}
/**
 * Drive an async iterable while the turn state is registered in the store.
 *
 * Deliberately synchronous in shape: the wrapper functions return promises
 * without awaiting anything first, so `AsyncLocalStorage.run` binds the turn
 * without an extra async tick that would widen the context window.
 *
 * @param iterable - the downstream stream to carry the store across.
 * @param store - turn state visible to every `next`/`throw` call.
 * @param als - the store's AsyncLocalStorage instance.
 */
export declare const withStore: <T>(iterable: AsyncIterable<T>, store: ActiveTurnState, als: AsyncLocalStorage<ActiveTurnState>) => AsyncIterable<T>;
//#endregion
//#region src/tool-fallback.d.ts
/**
 * Free-tier core-tool schema fallback.
 *
 * The OpenCode Zen gateway rejects free-tier `/responses` bodies that lack
 * `read` and `bash` in `tools`, while DSH deliberately does not send them.
 * When the request model is marked free-tier, this module rewrites the body
 * to carry both schemas — and only when they are actually missing, so a body
 * that already declares them passes through byte-identical.
 *
 * @module dsh-opencode-patch/tool-fallback
 */
/** Path segment that marks a Responses-API body worth inspecting. */
export declare const RESPONSES_PATH = "/responses";
/** Placeholder `read` schema the gateway's validator accepts. */
export declare const DUMMY_READ_TOOL: {
  readonly description: "Read a file or directory from the local filesystem.";
  readonly name: "read";
  readonly parameters: {
    readonly properties: {
      readonly filePath: {
        readonly description: "The absolute path to the file or directory to read";
        readonly type: "string";
      };
      readonly offset: {
        readonly description: "The line number to start reading from (1-indexed)";
        readonly type: "number";
      };
      readonly limit: {
        readonly description: "The maximum number of lines to read (defaults to 2000)";
        readonly type: "number";
      };
    };
    readonly required: readonly ["filePath"];
    readonly type: "object";
  };
  readonly type: "function";
};
/** Placeholder `bash` schema the gateway's validator accepts. */
export declare const DUMMY_BASH_TOOL: {
  readonly description: "Execute a bash command.";
  readonly name: "bash";
  readonly parameters: {
    readonly properties: {
      readonly command: {
        readonly description: "The command to execute";
        readonly type: "string";
      };
      readonly workdir: {
        readonly description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.";
        readonly type: "string";
      };
      readonly timeout: {
        readonly description: "Optional timeout in milliseconds";
        readonly type: "number";
      };
    };
    readonly required: readonly ["command"];
    readonly type: "object";
  };
  readonly type: "function";
};
/** Whether `modelId` is in scope for the core-tool fallback. */
export declare const isCoreToolModel: (modelId: string, marker: string) => boolean;
/**
 * Inject `read` + `bash` schemas into a free-tier completions body.
 *
 * @param url - request URL (supports `/responses` and `/chat/completions`).
 * @param body - the outgoing request body.
 * @param headers - the mutable header bag whose `content-length` must track a
 * rewritten body.
 * @param options - whether injection is enabled and which model marker scopes it.
 * @returns the (possibly rewritten) body; the original reference when untouched.
 */
export declare const maybeInjectCoreTools: (url: string, body: RequestInit["body"], headers: Headers, options: {
  enabled: boolean;
  modelMarker: string;
}) => RequestInit["body"];
//#endregion
//#region src/fetch-patch.d.ts
export declare const hasSessionHeader: (input: RequestInfo | URL, init?: RequestInit) => boolean;
/**
 * Determines if a request targets an OpenCode API endpoint.
 *
 * Two independent claims: a URL containing any configured gateway substring
 * (works even with no active turn, which is what keeps session affinity for
 * background calls), or a turn routed to a configured provider.
 *
 * @param url - the request URL.
 * @param state - the active turn, when the request belongs to one.
 * @param providers - configured provider route keys.
 * @param gatewayUrls - URL substrings marking gateway traffic; blank entries
 * are ignored, and the caller's absence of a list falls back to the default
 * gateway markers.
 */
export declare const isOpenCodeRequest: (url: string, state: ActiveTurnState | undefined, providers: Set<string>, gatewayUrls?: readonly string[]) => boolean;
/**
 * Wrap `fetch` so claimed OpenCode requests carry the gateway's expected
 * headers and session id.
 *
 * @param original - the fetch implementation to wrap (usually `globalThis.fetch`).
 * @param als - turn store consulted for the session id of the current turn.
 * @param config - resolved plugin configuration.
 */
/**
 * What the interceptor needs from the plugin beyond its configuration.
 *
 * An object rather than more positional parameters, because these are the
 * plugin's own seams into the request path and there will be more of them. The
 * configuration stays separate: it is what the deployment wrote, and these are
 * what the running plugin knows.
 */
interface FetchPatchHooks {
  /**
   * The org a plane's credential belongs to, when it has one.
   *
   * Asked per request rather than captured once, because a login can arrive
   * while the process runs. The org is not a setting: it is part of the
   * credential, and a request carrying a token without its org is answered as
   * though the token were a plain key.
   *
   * @param plane - the gateway plane the request is bound for.
   * @returns the org id, `wrk_...`, or undefined when the plane's credential has
   * none — which is every key deployment, and the reason this is optional.
   */
  readonly resolveOrg?: (plane: string) => string | undefined;
  /**
   * One entry per claimed request, for the debug file.
   *
   * The question it exists to answer is why a request that should have been
   * patched was not, or was patched wrongly — which is invisible from the
   * outside, because the gateway's answer for a malformed session id reads
   * exactly like the answer for a bad credential. So it records what the
   * interceptor SAW and what it SENT, never the credential itself.
   */
  readonly debug?: (entry: Record<string, unknown>) => void;
}
export declare const patchFetch: (original: typeof fetch, als: AsyncLocalStorage<ActiveTurnState>, config: ResolvedPluginConfig, hooks?: FetchPatchHooks) => typeof fetch;
//#endregion
//#region src/key-capture.d.ts
/**
 * Credential capture: what a key *is*, and where it was last seen.
 *
 * The plugin can learn a key two ways — observed on a live request, or resolved
 * from declared configuration — and this module owns the first: pulling a
 * credential out of whatever header shape carried it, classifying which account
 * tier it belongs to, and remembering it so later lookups do not have to fall
 * back to a static environment variable that may have gone stale.
 *
 * Split out of `go-discovery.ts`, which keeps the *plan* side (which endpoint,
 * which key reference, and the policy that orders the two sources). The seam is
 * deliberate: everything here is about a credential value, nothing here knows
 * what a provider row or a base URL looks like.
 *
 * @module dsh-opencode-patch/key-capture
 */
/** Account tiers a captured credential can belong to. */
type KeyTier = "go" | "zen" | "unknown";
/** Whether a value is one of the adapter's placeholder credentials. */
export declare const isPlaceholderApiKey: (key: string) => boolean;
/**
 * Which account tier a request belongs to.
 *
 * Ordered by how much each signal can be trusted, which is the whole point:
 *
 * 1. The **key prefix** is intrinsic to the credential, so it survives a rotated
 *    key and a renamed provider route alike.
 * 2. The **URL** is what the adapter actually called — observed, not configured.
 * 3. The **provider route id** is only a hint. It is user-defined config and may
 *    be named anything (`zen`, `oc`, `my-opencode`), so it must never be the sole
 *    reason a lookup succeeds — that would make a captured, working key
 *    invisible the moment the user renamed a route.
 *
 * @param url - the request URL, when the caller has one.
 * @param provider - the routed provider id, when known.
 * @param key - the credential itself, when known; its prefix is the best signal.
 */
export declare const tierForRequest: (url?: string, provider?: string, key?: string) => KeyTier;
/**
 * Extract an API key from a `Headers` instance or a plain header record.
 *
 * Handles Bearer, Anthropic and Google key headers. A placeholder in one
 * header must not mask a real credential in another. When every value is a
 * placeholder, returns the first raw value for callers that diagnose it.
 */
export declare const extractApiKeyFromHeaders: (headers: unknown) => string | undefined;
/**
 * Record an API key captured from live HTTP request headers or provider configurations.
 *
 * A blank or placeholder value is ignored rather than stored.
 */
export declare const recordCapturedApiKey: (rawKey: string, provider?: string, url?: string) => void;
/**
 * Retrieve a previously captured API key by provider or tier.
 *
 * @param provider - route id to try first, when the caller has one.
 * @param tier - the tier the key must belong to. Pass it whenever the request
 * already identifies one: omitting it lets the most recently seen key win,
 * which may be for the other tier. A route-scoped hit is filtered by it too —
 * naming a route is a preference, not a licence to ignore the tier.
 */
export declare const getCapturedApiKey: (provider?: string, tier?: "go" | "zen") => string | undefined;
/**
 * Clear all captured API keys (primarily used in test teardown).
 */
export declare const clearCapturedApiKeys: () => void;
//#endregion
//#region src/go-discovery.d.ts
/** Gateway settings found in other entries, if any. */
interface DiscoveredGoConfig {
  baseURL?: string;
  keyEnv?: string;
  literalKey?: string;
}
/**
 * Auto-discover OpenCode Go provider configuration from loaded Cordis
 * entries (e.g. llm-pi-ai), honoring both shapes it ships in: a
 * provider row inside a provider registry, and a standalone entry.
 *
 * Checks `targetProvider` first if specified, then falls back to `opencode-go`
 * and `opencode` (Zen), or any provider pointing to `opencode.ai`.
 *
 * Later entries win, mirroring composition order.
 *
 * @param ctx - the plugin context, mock or real.
 * @param targetProvider - optional specific provider route id to prioritize.
 */
export declare const discoverGoConfig: (ctx: unknown, targetProvider?: string) => DiscoveredGoConfig;
/**
 * Point a discovered base URL at the Go quota endpoint.
 *
 * **Both endpoint families have to land on the `zen/go` form, and that is
 * measured rather than assumed.** The public quota route is
 * `GET /zen/go/v1/usage` and there is no second one: the only route file in
 * either major version is
 * `packages/console/app/src/routes/zen/go/v1/usage.ts` (checked in 1.19.4 and
 * 2.0.32), and the inference proxy's path table
 * (`packages/console/app/src/lib/inference-proxy.ts`) lists
 * `"GET /zen/go/v1/usage": "/go/v1/usage"` with no `/inference/.../usage`
 * counterpart.
 *
 * The catalog now names the INFERENCE family for the `opencode` provider
 * (`api: https://opencode.ai/inference/openai/v1`), so a base discovered from a
 * provider row is very often that family. Rewriting only `zen/v1` left it
 * untouched, and the meter then asked `…/inference/openai/v1/usage` — a path
 * that does not exist — which is an unavailable meter with no explanation.
 *
 * A URL on neither family (a mirror, a self-hosted gateway) passes through
 * untouched: this function does not invent an endpoint it was not given.
 *
 * @param url - candidate base URL.
 */
export declare const toGoBaseURL: (url: string) => string;
/**
 * Base URL for Go quota requests: an explicit non-default config wins,
 * otherwise a discovered gateway URL, otherwise the configured default.
 *
 * @param ctx - the plugin context used for discovery.
 * @param configured - the row's `usageBaseURL` setting.
 * @param targetProvider - optional specific provider route id to prioritize.
 */
export declare const resolveGoBaseURL: (ctx: unknown, configured: string, targetProvider?: string) => string;
/**
 * The effective credential reference for Go key lookups.
 *
 * The composition is the only place a reference comes from: an `apiKeyEnv`
 * declared by the provider registry is honoured as-is, and the built-in default
 * is the fallback. There is deliberately no row setting for this — a knob here
 * would duplicate the provider row's own declaration, which is exactly the
 * setting a user has already made once.
 *
 * @param discovered - result of {@link discoverGoConfig} (reuse when already computed).
 */
export declare const effectiveGoKeyRef: (discovered: DiscoveredGoConfig) => string;
/**
 * The credential the OpenCode installation already holds for a plane.
 *
 * The path is resolved the way the installation resolves it, from the ambient
 * environment and the user's home, because that is where those facts live at
 * request time. Nothing here throws and nothing here logs: a machine without
 * OpenCode is the ordinary case, and a secret never reaches a message.
 *
 * @param plane - the integration id to match: `opencode` (Zen) or
 *   `opencode-go`.
 * @param enabled - the deployment's opt-in. When false this answers
 *   `undefined` without touching the filesystem, which is the default.
 * @returns the stored value, or `undefined` when the switch is off, the store
 *   is absent or unreadable, or it holds nothing for this plane.
 */
export declare const resolveOpencodeStoreKey: (plane: string, enabled: boolean) => string | undefined;
/**
 * Resolve the Go API key without ever exposing it to the client.
 *
 * Order is {@link KEY_SOURCE_ORDER}`[policy]`; with the default `auto` that is
 * a literal `apiKey` discovered in another entry, then a captured key for the
 * Go tier, then the credential service and environment, then any captured key,
 * and last the installation's own store when the deployment opted in.
 *
 * @param ctx - the plugin context used for discovery and credentials.
 * @param targetProvider - optional specific provider route id to prioritize.
 * @param policy - which source wins when several resolve.
 * @param readOpencodeStore - whether the installation's own store may be read
 *   as the last resort. Off by default.
 * @returns the key, or `undefined` when nothing resolves — the caller raises
 * the typed `MISSING_CREDENTIAL` error instead of a raw one.
 */
export declare const resolveGoApiKey: (ctx: unknown, targetProvider?: string, policy?: KeySourcePolicy, readOpencodeStore?: boolean) => Promise<string | undefined>;
/** Result of resolving Zen credit/balance status. */
interface ZenCreditInfo {
  isConfigured: boolean;
}
/**
 * Resolve whether OpenCode Zen pay-as-you-go is configured.
 *
 * Checks whether an OpenCode Zen key (`OPENCODE_API_KEY` or `oc_sk_...`)
 * is configured in DSH credentials or environment. There is no endpoint to ask
 * for a balance, so this answers "can the Go plan overflow into Zen credit?"
 * rather than "how much credit is left".
 *
 * @param ctx - plugin context used for credentials service lookup.
 */
export declare const resolveZenCreditInfo: (ctx: unknown) => Promise<ZenCreditInfo>;
/** Key resolution details for a routed provider. */
interface RoutedKeyDetails {
  key?: string;
  keyPrefix?: string;
  provider: string;
  tier: "go" | "zen" | "unknown";
}
/**
 * Resolve the effective API key and account tier for a currently routed provider.
 *
 * The routed provider *is* the tier, so a Zen route legitimately resolves a
 * Zen key — and so does {@link resolveGoApiKey}, which does not reject one
 * either. An earlier guard there refused a key starting `oc_sk_` on the belief
 * that the prefix meant "Zen, no Go entitlement"; the same prefix answers `200`
 * with real windows, and the guard was removed. What separates the tiers is the
 * observed request, never a string.
 *
 * @param ctx - plugin context
 * @param provider - routed provider name (e.g. "opencode-go", "opencode")
 * @param policy - which source wins when several resolve.
 * @param readOpencodeStore - whether the installation's own store may be read
 *   as the last resort. Off by default.
 */
export declare const resolveRoutedKey: (ctx: unknown, provider: string, policy?: KeySourcePolicy, readOpencodeStore?: boolean) => Promise<RoutedKeyDetails>;
//#endregion
//#region src/catalog-data.d.ts
/**
 * One way a model accepts a thinking/reasoning setting.
 *
 * `models.dev` describes these as a discriminated list; only the fields it
 * actually sends are modelled, and an unknown `type` is dropped rather than
 * guessed at.
 */
interface ReasoningOptionSpec {
  min?: number;
  type: string;
  values?: readonly string[];
}
interface CatalogModelSpec {
  context_window: number;
  cost?: ModelCostRate;
  id: string;
  input_modalities: string[];
  is_free?: boolean;
  /**
   * Whether the model accepts a thinking/reasoning setting at all, and which
   * kind - `models.dev` carries it as a boolean plus an options list. The three
   * shapes seen live are `{type:"effort",values:[…]}`, `{type:"budget_tokens",
   * min}`, and `{type:"toggle"}`.
   *
   * The shim dropped both fields, so a picker built from it could not offer a
   * thinking level for any model: 117 of 122 Zen models declare `reasoning` and
   * none of them reached the plugin.
   */
  reasoning?: boolean;
  reasoning_options?: readonly ReasoningOptionSpec[];
  max_output_tokens: number;
  name: string;
  /**
   * The SDK this model needs, present only when it differs from the provider's
   * default.
   *
   * models.dev sets `provider.npm` as an OVERRIDE: `opencode`'s provider-level
   * value is `@ai-sdk/openai-compatible`, so the 53 models carrying no override
   * speak that, while the 32 carrying `@ai-sdk/openai` are served on the
   * Responses API and the 23 carrying `@ai-sdk/anthropic` on Messages. That is
   * the vendor's own statement of the split, which is why `responses-routes.ts`
   * dispatches on it rather than on a list we would have to maintain.
   */
  provider_npm?: string;
}
export declare const OPENCODE_GO_CATALOG: readonly CatalogModelSpec[];
/** Complete catalog of OpenCode Zen models (free tier & flagships) from models.dev. */
export declare const OPENCODE_ZEN_CATALOG: readonly CatalogModelSpec[];
//#endregion
//#region src/models-catalog.d.ts
type CatalogProvider = "go" | "zen";
/**
 * The registry this plugin actually fetches: the OpenCode catalog, served from
 * OpenCode's own host.
 *
 * Measured: this and `https://models.dev/api.json` return the SAME object today —
 * byte-identical body, identical ETag — so the two names are one registry, not two
 * sources. The OpenCode host is the one that is called, and a test pins it: a
 * silent re-point would still return valid data, which is precisely why the
 * assertion is on the request rather than on the answer.
 */
export declare const MODELS_OPENCODE_URL = "https://models.opencode.ai/api.json";
/**
 * The same registry under its public name, `models.dev`.
 *
 * Exported for callers that want the human-facing URL (documentation links, a
 * health probe). It is NOT what {@link refreshCatalog} fetches, and it need not
 * stay in step with {@link MODELS_OPENCODE_URL}: if the two ever diverge, the
 * OpenCode host wins, because that is the one the plugin reads.
 */
export declare const MODELS_DEV_URL = "https://models.dev/api.json";
/**
 * Modalities supported by DeepSeek Harness model configuration schemas.
 * DSH strictly accepts ("text" | "image")[], rejecting "video", "audio", "pdf".
 */
export declare const DSH_SUPPORTED_MODALITIES: Set<string>;
/**
 * Sanitize an input modalities list to match the DSH schema ("text" | "image").
 * Drops "video", "audio", "pdf", and defaults to ["text"] if empty.
 */
export declare const sanitizeModalities: (modalities: unknown) => ("text" | "image")[];
/** TTL for cached models before triggering a background revalidation (60 minutes). */
export declare const CATALOG_REVALIDATION_TTL_MS: number;
/**
 * Timeout for catalog revalidation requests.
 *
 * 8s was measured against the endpoint when it answered in ~200ms, and the
 * vendor has since slowed to 7-12s for the same payload. The budget was tighter
 * than the thing it budgets, so the freshness job - and every runtime revalidation
 * - failed with a `TimeoutError` rather than with a content mismatch. Two CI runs
 * on `catalog freshness` were this, not vendor churn.
 *
 * 30s is comfortably past the observed worst case while still bounded, because a
 * revalidation that hangs is worse than one that fails: the shim ships with the
 * bundled catalog, and the SWR refresh keeps serving it, so a slow answer costs
 * a wait and a dead one costs a retry.
 */
export declare const MODELS_DEV_TIMEOUT_MS = 30000;
interface ParsedCatalogs {
  /**
   * The endpoint each plane's provider declares, read from the catalog itself
   * rather than assumed. `models.dev` puts it on the provider entry as `api`, and
   * the client consumes exactly this field
   * (`packages/core/src/models-dev.ts:107`, `settings: { baseURL: item.api }`).
   */
  api: {
    go: string;
    zen: string;
  };
  /**
   * The endpoint each WIRE FAMILY declares, per plane, keyed by the SDK package
   * the catalog names for it (`""` for the provider default).
   *
   * The provider-level `api` above is not the whole story: the vendor serves
   * anthropic and google at their own paths, and declares that per model. Read
   * from the same data rather than restated in code, so a vendor move is a shim
   * regeneration and not a source change.
   */
  familyApi: {
    go: FamilyApi;
    zen: FamilyApi;
  };
  go: CatalogModelSpec[];
  zen: CatalogModelSpec[];
}
/** One plane's endpoint per SDK package (`""` = the provider's own default). */
type FamilyApi = Readonly<Record<string, string>>;
/** Which of the two catalogs a model id should be read from. */
type CatalogPlane = "go" | "zen";
/**
 * The plane a route's models come from.
 *
 * `opencode-go` is the subscription plane; everything else this plugin knows
 * about (`opencode`, and the internal routes derived from it) is Zen.
 */
export declare const catalogPlaneForRoute: (route: unknown) => CatalogPlane;
/**
 * The spec a given PLANE declares for a model.
 *
 * **The two planes declare different SDKs for the same model id**, which is why
 * this exists at all. models.dev's `opencode-go` names `@ai-sdk/anthropic` for
 * `qwen3.8-max`, `minimax-m2.7` and `minimax-m3`, while its `opencode` names
 * nothing — the default, i.e. completions. A single Go-first lookup therefore
 * answers a ZEN question with GO data, and for those three models that is a
 * mis-route rather than a detail.
 *
 * Measured 2026-10-06 against the live Zen gateway: `qwen3.8-max` and
 * `minimax-m3` answer `200` on `/chat/completions` and
 * `400 ModelProtocolUnsupported` on `/messages` — and `/messages` is exactly
 * where the Go-first read sent them. Both were reachable and failing.
 */
export declare const findModelSpecOn: (plane: CatalogPlane, modelId: string) => CatalogModelSpec | undefined;
/**
 * Look up model specifications and pricing rates by model ID, preferring the Go
 * plane.
 *
 * Correct for "does either plane know this model" — pricing and limits, which
 * agree across the planes for every shared id. **Not** correct for routing: see
 * {@link findModelSpecOn}. Anywhere the answer decides which ENDPOINT serves a
 * model, the plane has to come from the route in play.
 */
export declare const findModelSpec: (modelId: string) => CatalogModelSpec | undefined;
/**
 * Safely parse raw models.dev JSON data for both opencode-go and opencode providers.
 *
 * @param data - raw parsed JSON from `https://models.dev/api.json`
 * @returns extracted model specifications for both Go and Zen
 */
export declare const parseModelsDevCatalog: (data: unknown) => ParsedCatalogs;
/**
 * Whether the most recent catalog parse saw `id` as retired on `plane`.
 *
 * The complement of {@link findModelSpecOn}: a model can be absent from the
 * catalog because it is NEW or because it is RETIRED, and the two want opposite
 * treatment in a merge. This is what tells them apart.
 *
 * @param plane - `zen` or `go`.
 * @param id - the model id to test.
 * @returns whether the registry has retired it.
 */
export declare const isDeprecatedModelOn: (plane: "go" | "zen", id: string) => boolean;
/**
 * Fetch and merge the latest live model specifications from the OpenCode
 * catalog (`models.opencode.ai`).
 *
 * Never throws: on network failure, timeout, or invalid reply, gracefully falls
 * back to the current active catalog. Concurrent calls coalesce into one in-flight promise.
 *
 * @param fetchFn - fetch implementation to use (defaults to globalThis.fetch)
 * @param force - bypass TTL cache and force immediate refresh
 */
export declare const refreshCatalog: (fetchFn?: typeof fetch, force?: boolean) => Promise<{
  go: readonly CatalogModelSpec[];
  zen: readonly CatalogModelSpec[];
}>;
/**
 * Return the current Go catalog immediately, triggering SWR revalidation if stale.
 *
 * @param fetchFn - fetch implementation to use for background refresh
 */
export declare const getLiveGoCatalog: (fetchFn?: typeof fetch) => readonly CatalogModelSpec[];
/**
 * Return the current Zen catalog immediately, triggering SWR revalidation if stale.
 *
 * @param fetchFn - fetch implementation to use for background refresh
 */
export declare const getLiveZenCatalog: (fetchFn?: typeof fetch) => readonly CatalogModelSpec[];
/** Legacy alias for getLiveGoCatalog. */
export declare const getLiveCatalog: typeof getLiveGoCatalog;
/**
 * Check whether a request URL is interrogating the models directory.
 *
 * The gateway marker is a PARAMETER, not a constant. It used to be hardcoded to
 * `opencode.ai/zen` while `isOpenCodeRequest` already took `gatewayUrls` — so a
 * relay or mirror that matched every other OpenCode rule got the headers and the
 * session id but no catalog enrichment, and the only symptom was a shorter model
 * list. Same shape as that predicate: match any configured marker, defaulting to
 * the stock one.
 *
 * @param url - the request URL
 * @param gatewayUrls - configured gateway markers; defaults to the stock one
 */
export declare const isModelsListingUrl: (url: string, gatewayUrls?: readonly string[]) => boolean;
/**
 * Whether that listing is on the GO plane.
 *
 * The plane is a property of the PATH, never of the host: a custom gateway's Go
 * route is still `/go/v1`, so this reads the same way for a relay as for
 * opencode.ai — which is exactly why the marker above had to be lifted out.
 *
 * **Both endpoint families, and the newer one is the one that matters here.**
 * The Go plane's base is the `inference` family (`…/inference/go/openai/v1`),
 * and that path carries no `/models` of its own — the listing lives on the
 * older `zen/go` route, so the answer the gateway gives is a 404 and this
 * enrichment is what fills it. Reading the plane by substring instead put the
 * modern Go path in the ZEN bucket, and the Go plane was then answered with the
 * ZEN catalog: every Zen model, and none of the Go plane's own.
 */
export declare const isGoModelsListingUrl: (url: string, gatewayUrls?: readonly string[]) => boolean;
/**
 * Merge and enrich a gateway `/models` response with the complete OpenCode Go or Zen catalog.
 *
 * @param url - the request URL
 * @param response - the upstream fetch Response
 * @param fetchFn - optional fetch implementation for SWR background refresh
 * @returns an enriched Response with all models and complete metadata
 */
export declare const enrichModelsResponse: (url: string, response: Response, fetchFn?: typeof fetch) => Promise<Response>;
//#endregion
//#region src/session-cost.d.ts
interface ModelCostRate {
  cache_read?: number;
  cache_write?: number;
  input: number;
  output: number;
}
interface SessionUsageSnapshot {
  /**
   * The model that executed the most recent turn. A session may switch models
   * midway, so this is the *current* one, not the only one used.
   */
  activeModel?: string;
  /** The catalog's display name for {@link activeModel}, when it has one. */
  activeModelName?: string;
  /** Human-readable rate for {@link activeModel}, e.g. `$2.5 / $15 per 1M`. */
  activeRateFormatted?: string;
  cacheReadTokens: number;
  /** Spend attributed to each billing plane — Go allowance vs Zen balance. */
  costByPlane: {
    go: number;
    zen: number;
  };
  costFormatted: string;
  costUsd: number;
  /**
   * THIS route's plane spend, projected by the usage service once it knows
   * which plane the reading is for. `costUsd` above is the session's
   * all-planes total and is the wrong number for a panel that answers for one
   * balance.
   */
  planeCostFormatted?: string;
  planeSpendUsd?: number;
  /**
   * True when the ACTIVE model is free — the catalog's free-tier flag, not a
   * plan entitlement. The name this carried (`includedInPlan`) said the Go plan
   * covered the cost, which is a different and often false claim: a free model
   * bills nothing at all, on any plan.
   */
  freeModel?: boolean;
  inputTokens: number;
  modelsUsed: string[];
  outputTokens: number;
  totalTokens: number;
  turns: number;
}
/**
 * Format a USD dollar amount, always two decimals.
 *
 * The precision used to tier by magnitude — three decimals below a cent, four
 * below a tenth of one — and the owner read `$0.006` on the trigger and called
 * it too much precision in the wrong place. A meter is a gauge, not an
 * invoice: `$0.01` of a real spend is an honest rounding of six tenths of a
 * cent, the same rounding every wallet UI makes. Precision tiers reintroduce
 * the exact thing the panel keeps paying to remove — a number whose LENGTH
 * changes with its value, so the row shifts on every turn. (The allowance
 * table's `formatUsd` in go-limits.ts keeps its own contract: whole dollars
 * drop the cents, because a published $60 total is not the same kind of
 * figure as a metered spend.)
 */
export declare const formatUsd: (usd: number) => string;
/** Format model rate per 1M tokens. */
export declare const formatModelRate: (cost?: ModelCostRate, isFree?: boolean) => string;
/** Calculate the cost of a turn given tokens and pricing rates (prices per 1M tokens). */
export declare const calculateTurnCost: (tokens: {
  cacheReadTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}, cost?: ModelCostRate, isFree?: boolean) => number;
/**
 * Record a completed turn's token usage into the session accumulator.
 *
 * `plane` is which billing plane served the turn — Go allowance or Zen balance —
 * and it is what makes the split below possible. A session that switches planes
 * midway (Go `mimo-v2.6-pro`, then Zen `mimo-v2.6-flash-free`) used to fold BOTH
 * planes' spend into one total, so the Zen panel billed the session with money
 * the Go allowance had paid. Each turn is attributed where it was served.
 */
export declare const recordTurnUsage: (sessionId: string, tokens: {
  cacheReadTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}, cost?: ModelCostRate, model?: string, isFree?: boolean, plane?: CatalogPlane) => SessionUsageSnapshot;
/** Read accumulated token and dollar usage for a session (or the latest active session). */
export declare const getSessionUsage: (sessionId?: string) => SessionUsageSnapshot | undefined;
/**
 * Re-describe a snapshot for a DIFFERENT model, without touching the spend.
 *
 * The accumulator prices each turn at the model that ran it, so its `active*`
 * fields name the last one. The panel's rate is prospective — what the next turn
 * costs — so when the caller knows which model is selected now and it differs,
 * this swaps the identity and re-derives the rate from the catalog entry the Host
 * holds. The spend total is deliberately untouched: it is history.
 */
export declare const describeModel: (snapshot: SessionUsageSnapshot, model: string, rate: ModelCostRate | undefined, isFree: boolean, displayName?: string) => SessionUsageSnapshot;
/** Clear session usage (primarily for tests). */
export declare const clearSessionUsageStore: () => void;
//#endregion
//#region src/usage-contract.d.ts
/** The active model's published monthly allowance, resolved on the Host. */
interface ModelAllowanceSnapshot {
  /** Go, the $10/month plan. */
  go: number;
  /** Go Plus, the $40/month plan. */
  goPlus: number;
  /** The model this allowance is for, as the picker spells it. */
  model: string;
}
interface UsageWindow {
  percent: number;
  resetsAt: string;
  status: "ok" | "rate-limited";
}
interface GoUsage {
  /**
   * The selected model's monthly allowance, in whole US dollars per plan tier.
   *
   * A **total**, never a balance: `GET /zen/go/v1/usage` takes no model
   * parameter, so its percentages describe the ACCOUNT and cannot be turned into
   * a per-model remainder. See `src/go-limits.ts`.
   */
  allowance?: ModelAllowanceSnapshot;
  monthly: UsageWindow;
  rolling: UsageWindow;
  /** Accumulated token and dollar usage for the current session. */
  session?: SessionUsageSnapshot;
  /** Opaque Host identity for this endpoint/account; never a credential or its hash. */
  source?: string;
  weekly: UsageWindow;
  /**
   * The window figures above are a TYPE FLOOR, not a measurement.
   *
   * Set when the Host could not read Go's quota at all (403 EntitlementError
   * with a Zen balance configured), so it falls back to handing billing over to
   * Zen. `zenOverflowUsage` still has to return three `UsageWindow`s, and the
   * only way to fill them without inventing a number is `percent: 0` and a
   * reset time of "now" — which rendered as three `0%` rows all counting down
   * from `<1m`, i.e. a precise, confident-looking claim that the reading did not
   * support. Verified against the live API: the same Go key returns real
   * figures (2% / 1% / a monthly reset in November) moments later.
   *
   * The panel renders NO window rows when this is set. The inference that Go
   * overflowed is still honest — it is derived from the 403 — so the overflow
   * row stays; the three percentages were never knowable.
   */
  quotaUnavailable?: boolean;
  /** Whether Zen balance overflow fallback is active or configured. */
  zenOverflow?: boolean;
}
/**
 * Validate and normalize OpenCode Go usage response.
 *
 * Accepts either `{ usage: { rolling, weekly, monthly } }` (the live API payload)
 * or `{ rolling, weekly, monthly }` (unwrapped).
 */
export declare const parseGoUsage: (value: unknown) => GoUsage;
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    "opencode-go/usage-unavailable": {
      /**
       * `false` when the account has no Go credential at all — a configuration
       * state, not a fault, so the client renders nothing rather than an
       * unavailable meter.
       */
      readonly configured?: boolean;
      readonly retainPrevious: boolean;
      readonly retryable: boolean;
      readonly source?: string;
    };
  }
  interface TypertRemoteNamespaceMap {
    opencodeGoUsage: {
      read: (query?: UsageQuery) => Promise<RemoteResult<GoUsage>>;
    };
  }
}
/**
 * What the caller may tell the Host about the meter it is rendering.
 *
 * `provider` picks the route (hence the account) being metered, `sessionId`
 * scopes the spend figure to the conversation on screen, and `model` names the
 * model the picker is ON — which is not the model that priced the spend so far.
 * The Host owns the catalog, so it is the only side that can answer "what does
 * the next turn on this model cost"; without the field the rate beside the figure
 * describes the last completed turn and goes stale the moment you switch.
 */
interface UsageQuery {
  model?: string;
  provider?: string;
  sessionId?: string;
}
export declare const parseUsageQuery: (value?: unknown) => UsageQuery;
//#endregion
//#region src/usage.d.ts
interface UsageOptions {
  /** Explicit quota endpoint getter; discovery/defaults apply when absent. */
  baseURL?: () => string;
  /** Which credential source wins; the composition and capture cover the rest. */
  keySource?: KeySourcePolicy;
  /** Escape hatch for callers that resolve the key themselves. */
  resolveApiKey?: () => Promise<string | undefined>;
  /**
   * Whether the installation's own credential store may be read as the last
   * resort. Off unless the deployment opted in, which is the default.
   */
  readOpencodeStore?: boolean;
}
export declare class GoUsageService extends TypertRemoteService {
  private identity?;
  private readonly options;
  constructor(ctx: unknown, options?: UsageOptions);
  read(query?: UsageQuery): Promise<GoUsage>;
}
//#endregion
//#region src/models-discovery.d.ts
interface DiscoveryCandidate {
  contextWindow?: number;
  id: string;
  inputModalities?: string[];
  maxTokens?: number;
  name?: string;
}
/**
 * Decide which canonical catalog, if any, may supplement one discovery answer.
 *
 * Exact claimed route IDs win. A configured custom route or an unstored draft
 * falls back to the gateway URL only when the request names an OpenCode
 * gateway; anything else is left to its owning adapter.
 */
export declare const resolveDiscoveryProvider: (request: unknown, config: Pick<ResolvedPluginConfig, "gatewayUrls" | "providers">) => CatalogProvider | undefined;
/**
 * Enrich an adapter’s discovery answer from the catalog, honoring provider-scoped
 * retirements.
 *
 * The adapter’s own rows keep their capacities and order; a missing capacity is
 * filled from the catalog. **Catalog rows are NOT appended when the adapter
 * answered at all** — the deployment’s list is the list, and a refresh must not
 * widen it. They are used only as a cold-start fallback, when the adapter
 * reported nothing, so a route is never empty.
 *
 * An earlier version always appended the catalog. On the picker that was
 * invisible until someone counted the rows; on a refresh it is the same mistake a
 * second time — the settings model list would grow past what was configured.
 */
export declare const mergeDiscoveredModels: (discovered: unknown, provider: CatalogProvider) => DiscoveryCandidate[];
/**
 * Whether a route the plugin owns is really registered on the Host.
 *
 * The redirect must consult the UNFILTERED registry: the patched listing
 * deliberately omits every internal route, so asking it would always answer "no"
 * and the re-dispatch would never fire.
 *
 * @param routeId - the internal route to test for.
 * @returns true when the unfiltered registry still carries the route.
 */
export declare const isRouteRegistered: (routeId: string) => boolean;
/**
 * Keep the internal routes out of every listing a user sees.
 *
 * Three surfaces enumerate providers, and the route has to be absent from all
 * of them or it shows up as a provider the user is invited to configure:
 *
 * - `buildModelCatalog` (the model picker) turns every registered route into a
 *   group and drops the groups whose model list is empty, so reporting no models
 *   removes it there.
 * - `joinProviderDirectory` (Settings → Models) maps `listConfigurableProviders`
 *   and then pushes a row for **every remaining registered provider** — so
 *   filtering only the configurable directory would not hide it.
 *
 * **`listModels` IS patched, and the note that used to sit here saying it was
 * not is why the picker lost most of the catalog.** The old text read:
 *
 *   "`listModels` is deliberately NOT patched. Every consumer of it in the Host
 *    iterates `listProviders()` first … so once the registry omits the route,
 *    nothing reaches its model list."
 *
 * The premise is true and the conclusion does not follow. Hiding the internal
 * routes is exactly why their models must be JOINED into the parent route's list:
 * `buildModelCatalog` is `listProviders()` × `listModels(id)`, each internal route
 * carries only its own protocol's models, and hiding it therefore makes those
 * models unreachable rather than merely unlisted. Measured: 27 models in the
 * picker before the join, 88 after.
 *
 * The patch now does two things: it empties an internal route's own list (nothing
 * reaches it, but a third patch guarding nothing is cheaper than a surprise), and
 * it merges each plane root's list with its plane's catalog. Both are below.
 *
 * Nothing in dispatch reads these: the adapter registry resolves a route
 * internally, and the `llm/stream` hook uses {@link isResponsesRouteRegistered}
 * — which reads the ORIGINAL listing, captured here — to decide whether the
 * redirect has somewhere to go.
 *
 * @param ctx - host context carrying the LLM registry.
 * @param config - the resolved config, for the ids a deployment withholds.
 * @returns the disposer restoring the original methods, or `undefined` when
 *   there is nothing to patch.
 */
/**
 * What the listing patch needs from its caller beyond the configuration.
 */
interface ListingOptions {
  /**
   * Whether this plane has a credential the gateway would accept.
   *
   * Absent means "do not ask": a caller that cannot tell leaves the list exactly
   * as the deployment declared it. Only a definite `false` narrows anything.
   */
  readonly hasCredential?: (plane: string) => boolean | Promise<boolean>;
}
export declare const hideResponsesRoute: (ctx: CordisContext, config: ResolvedPluginConfig, options?: ListingOptions) => (() => void) | undefined;
/**
 * Wrap the Host’s model-discovery method so “fetch available models” answers
 * for claimed OpenCode routes include the canonical catalog’s missing rows
 * and omit its provider-scoped retired rows.
 *
 * The original method keeps ownership of errors, cancellation, and every
 * unclaimed route. The returned disposer restores it.
 */
export declare const decorateModelDiscovery: (ctx: CordisContext, config: ResolvedPluginConfig) => (() => void) | undefined;
/**
 * The context window a model actually gets.
 *
 * The rule is the repository's own, applied to a number: **a declaration outranks
 * an estimate.** The window the deployment wrote wins outright, and the catalog's
 * value is the fallback when it wrote none — which matters because the catalog is
 * a bundled snapshot of the vendor's published limits and is conservative where
 * the vendor is: the free DeepSeek id is listed at 200k while the model serves 1M.
 * `Math.min(requested, canonical)` used to clamp that back down and made a stale
 * entry unoverridable.
 *
 * `maxContextWindow` still clamps, because it is the deployment's own explicit
 * ceiling rather than our estimate of the model's.
 *
 * @param requestedWindow - the window the deployment (or the catalog) declared.
 * @param maxCeiling - the deployment's ceiling, when it configured one.
 * @returns the effective window in tokens, or 0 when nothing usable was given.
 */
export declare const resolveEffectiveContextWindow: (requestedWindow: number, maxCeiling?: unknown) => number;
/**
 * Wrap the ADAPTERS behind the plane routes, so a model our catalog carries but
 * pi's installed catalog does not is resolvable at dispatch, and takes every
 * thinking level the composer offers.
 *
 * This is the seam the `modelOverrides` attempt missed, and the method that
 * matters is `modelOf`. The picker reads the public `ctx.llm.resolveModelInfo`,
 * which this plugin decorates, so the composer renders OUR catalog's context and
 * levels for every catalogued model. Dispatch (`streamWithSnapshot`) resolves
 * the model through the adapter's `modelOf` and validates the saved effort with
 * `getSupportedThinkingLevels`; `modelInfo` - and so `resolveModel` and
 * `prepareCall` - read the same method, which is why filling the picker's answer
 * was never enough. For an id pi's installed catalog does not carry -
 * `glm-5.3-flash-free` on Zen, `cat-jam-free` on both planes, both declared in
 * the deployment's profile - with no `reasoningEfforts` of its own on the row,
 * that model materializes as `reasoning: false` with no level map: the only
 * level it takes is `off`, so every level the picker offered came back
 * UNSUPPORTED_REASONING_EFFORT.
 *
 * A `modelOverrides` entry cannot fix this - it only DESCRIBES ids
 * `defaults.has(id)`, and `entries` comes from `defaults.values()`, so an id pi
 * has never heard of is rejected in strict validation and never served anyway.
 *
 * The registry keeps its adapters in a public `Map`, so the registration is
 * wrapped in place: nothing is re-registered, the user's profile is untouched, and
 * the route keeps the adapter it always had. `resolveModel` and `prepareCall` fill
 * only what the adapter left BLANK, so an adapter that knows the model keeps its
 * own answer. `modelOf` is the other shape - what comes out of it has to ACCEPT
 * the levels the composer offers, or a saved effort cannot be dispatched - so it
 * fills the levels the model REFUSES and leaves every level it already takes
 * alone: nothing is removed, and a level that dispatches today dispatches the
 * same way afterwards.
 *
 * Only the adapters behind the plane ROUTES are wrapped - a foreign adapter in
 * the same registry (another provider's) is not this plugin's to replace - and
 * the original runs with the adapter as its receiver, because all three are
 * class methods that read `this`.
 *
 * @param llm - the Host's LLM service.
 * @param config - the resolved config, for the ids a deployment withholds.
 * @returns the disposer restoring the original methods, or `undefined`.
 */
export declare const decoratePlaneAdapters: (llm: CordisContext["llm"], config: ResolvedPluginConfig) => (() => void) | undefined;
/**
 * Wrap the Host's `resolveModelInfo` so a plane route's model reports the
 * thinking level the catalog declares and the context window it names.
 *
 * This is the seam the model picker actually reads. `buildModelCatalog`
 * (`dsh-api-session-controller`) calls `ctx.llm.resolveModelInfo` per model and
 * renders an Effort row only from what comes back — so a plane route whose
 * adapter reports no `reasoning` shows no Effort row at all, which is the exact
 * symptom this exists for: `MiniMax-M3` and `MiniMax-M2.7` declare
 * `reasoning: true` in the catalog and still offered no thinking level.
 *
 * A plane route is a profile's own (`opencode`, `opencode-go`), and its adapter
 * materializes each declared row OVER the installed catalog's entry for the same
 * id: a row that declares no `reasoningEfforts` reports what that snapshot says
 * of the id — `reasoning: false`, with no level map, for every id it does not
 * carry — beside the row's own window and output cap.
 *
 * The fields our catalog carries are therefore AUTHORITATIVE here rather than
 * advisory: filling only what the adapter left blank let a stale snapshot report
 * itself on every surface that showed it, measured as 272k for `gpt-5.4` where
 * the vendor and our shim both say 1.05M. Only a model the catalog cannot
 * describe is passed through untouched, which is what keeps an id that only the
 * installed catalog knows — and a `reasoningEfforts` the row declares beside it
 * — reporting its own truth. A `modelOverrides` entry decides the fields it
 * names, its window being a request clamped by `maxContextWindow`. The INTERNAL
 * routes this plugin mounts already carry the right metadata through
 * {@link reasoningEffortsFor}, and are passed through so the two never disagree.
 *
 * That authority has a cost dispatch still pays: the requested level is
 * validated against the ADAPTER's object, not this one, so a level offered here
 * and refused there fails the turn — {@link decoratePlaneAdapters} fills that
 * object from the same catalog derivation so the two cannot disagree.
 *
 * @param ctx - host context carrying the LLM registry.
 * @param config - the resolved plugin config.
 * @returns the disposer restoring the original method, or `undefined`.
 */
export declare const decorateModelInfo: (ctx: CordisContext, config: ResolvedPluginConfig) => (() => void) | undefined;
//#endregion
//#region src/responses-routes.d.ts
/**
 * Which wire protocol each gateway model needs, and the internal route that
 * serves it.
 *
 * OpenCode Zen's provider-level SDK is `@ai-sdk/openai-compatible`; models.dev
 * names a DIFFERENT SDK per model only when that model needs one, so the
 * PRESENCE of `provider.npm` is the signal. Measured against the shipped
 * catalog: of its 85 `opencode` models, 28 name nothing (the default), **30 name
 * `@ai-sdk/openai`**, **18 name `@ai-sdk/anthropic`**, 8 name `@ai-sdk/google`
 * and 1 names `@ai-sdk/mistral` — the only one this plugin does not serve.
 *
 * So the split is read from the vendor's metadata rather than kept as a list of
 * model ids we would have to notice changing. The hand-written list this
 * replaced named ONE model, and 54 more were on the wrong side of it.
 *
 * DSH cannot express "this model speaks a different format" — `llm-pi-ai`
 * carries one `api` per ROUTE (`modelProfile`/`modelOverride` both exclude
 * `api`), and `llm.registerAdapter` refuses a route that already has an adapter.
 * So the format has to be a property of a route, and a model has to be
 * dispatched to the route whose `api` already names it. {@link internalRouteFor}
 * answers which; the `llm/stream` hook acts on it, and `responses-provider.ts`
 * registers the routes — from the plugin, so the user changes nothing.
 *
 * @module dsh-opencode-patch/responses-routes
 */
/** The SDK whose presence means "this model is served on the Responses API". */
export declare const RESPONSES_SDK = "@ai-sdk/openai";
/** The SDK whose presence means "this model is served on the Messages API". */
export declare const ANTHROPIC_SDK = "@ai-sdk/anthropic";
/** The SDK whose models speak pi's `google-generative-ai` protocol. */
export declare const GOOGLE_SDK = "@ai-sdk/google";
/** The SDK whose models speak pi's `mistral-conversations` protocol. */
export declare const MISTRAL_SDK = "@ai-sdk/mistral";
/** The SDK whose presence means "this model is served on Mistral's API". */
/** Route serving the gateway's Responses-API models. */
export declare const RESPONSES_ROUTE = "opencode-responses";
/** Route serving the gateway's Messages-API models. */
export declare const ANTHROPIC_ROUTE = "opencode-anthropic";
/** Route serving the gateway's Mistral-API models. */
/** Route serving the Go plane's Responses-API models. */
export declare const GO_RESPONSES_ROUTE = "opencode-go-responses";
/** Route serving the Go plane's Messages-API models. */
export declare const GO_ANTHROPIC_ROUTE = "opencode-go-anthropic";
/**
 * Route this plugin registers through its own adapter for the gateway's Gemini
 * models.
 *
 * Deliberately not `google`: that is a real provider id a deployment may
 * configure for Google AI Studio, and registering it would take the name away
 * from whoever configures it next. This one stays internal — the picker lists
 * its models under the plane route, and the stream hook dispatches the call
 * here, exactly as it does for the protocol routes above.
 */
export declare const GOOGLE_INTERNAL_ROUTE = "opencode-google";
/**
 * The gateway planes: one base URL, one catalog and one credential each.
 *
 * A plane is a property of the ACCOUNT and the base URL, never of a model — the
 * same model id can exist on both planes and be served on a different shape in
 * each. Routes are keyed by (plane, protocol) for exactly that reason: an SDK
 * says which shape a model needs, never which plane it belongs to.
 */
export declare const PLANES: {
  opencode: string;
  "opencode-go": string;
};
/**
 * The route that serves each (plane, protocol) pair.
 *
 * The plane's own base route (`opencode`, `opencode-go`) is implicit: it is the
 * one a model naming no SDK stays on, and it is not in this table because it is
 * never a redirect target — a model already there has nowhere to go.
 */
export declare const ROUTE_FOR_PLANE_PROTOCOL: Readonly<Record<string, {
  baseURL: string;
  routes: Readonly<Record<string, string>>;
}>>;
/**
 * The pi-ai protocol each SDK a model may name corresponds to, when that
 * protocol is not the route's own. Keys are models.dev `provider.npm` values.
 *
 * Two mechanisms serve the protocols here, and the split is the point:
 *
 * - `openai-responses` and `anthropic-messages` name protocols the wrapper's
 *   hand-declared route table implements, so their routes mount through the
 *   wrapper like every other route this plugin registers for it.
 * - `google-generative-ai` names a protocol that table does not carry, so its
 *   route mounts through this plugin's own adapter instead. The seam cannot
 *   express it — measured: a hand-declared route may only name a protocol in
 *   the wrapper's three-entry table, and a catalog route may only be named
 *   after the catalog provider it reuses, which a later-loading plugin cannot
 *   claim. `google-bridge.ts` is that adapter, and it is the record of how.
 *
 */
export declare const PROTOCOL_FOR_SDK: Readonly<Record<string, string>>;
/**
 * SDKs whose models are deliberately not offered.
 *
 * Every entry here is a DECISION, not an omission — and the distinction is the
 * point. A model naming an SDK that is in neither this set nor
 * `PROTOCOL_FOR_SDK` is a GAP: the catalog moved and the code did not, which is
 * how `mistral-large-4` went missing from the picker while every gate stayed
 * green. `catalog.test.ts` fails on that case and names the SDK.
 *
 * - `@ai-sdk/mistral` — pi implements `mistral-conversations` and the bridge
 *   pattern that would serve it is already built and measured for Google, but
 *   this dialect at the gateway is unmeasured and no entitled key exists to
 *   measure it. It moves to `PROTOCOL_FOR_SDK` the day that changes.
 */
export declare const UNSERVED_SDKS: ReadonlySet<string>;
/**
 * Routes this plugin registers through its own adapter rather than the
 * wrapper's mount, because the wrapper's hand-declared table refuses their
 * protocol. `registerResponsesProvider` skips these when building the wrapper's
 * providers dict and mounts each one itself.
 */
export declare const SELF_MOUNTED_ROUTES: ReadonlySet<string>;
/** The route each non-default protocol is served from. */
/** The Zen plane's rows of {@link ROUTE_FOR_PLANE_PROTOCOL}. */
export declare const ROUTE_FOR_PROTOCOL: Readonly<Record<string, string>>;
/** Every route this plugin registers for itself. */
export declare const INTERNAL_ROUTES: readonly string[];
/**
 * Whether a route id is one this plugin owns and keeps out of the UI.
 *
 * @param id - the route id to test.
 * @returns true when the plugin registered it for a non-default protocol.
 */
export declare const isInternalRoute: (id: unknown) => boolean;
/**
 * Whether a model can be served at all.
 *
 * A model naming no SDK speaks the route's own api, and one naming an SDK in
 * {@link PROTOCOL_FOR_SDK} has a route to be dispatched to. Anything else names
 * a protocol `llm-pi-ai` does not implement, so offering it would be offering a
 * model that cannot work — it must not reach a listing the user picks from.
 *
 * @param providerNpm - the model's `provider.npm` from the catalog, if any.
 * @returns true when the model has somewhere to be served from.
 */
export declare const isServableSdk: (providerNpm?: unknown) => boolean;
/**
 * The route a call should be dispatched through instead, or `undefined` when the
 * call is already going to the right place.
 *
 * Guarded on the SOURCE route as well as the model: a redirected call comes back
 * through the same hook with `provider` already set to an internal route, and
 * redirecting that again would recurse.
 *
 * @param provider - the route the caller selected.
 * @param model - the model id it selected.
 * @param providerNpm - that model's `provider.npm` from the catalog, if any.
 * @returns the route to dispatch through, or `undefined` to dispatch as asked.
 */
export declare const internalRouteFor: (provider: unknown, model: unknown, providerNpm?: unknown,
/**
 * The protocol to route by, overriding what `providerNpm` maps to.
 *
 * This is `modelRoutes`' entry point into dispatch: a deployment that knows the
 * catalog's protocol for a model is wrong can name the right one, and the call
 * is handed to the route that speaks it without waiting for the catalog to
 * agree.
 */
overrideProtocol?: string) => string | undefined;
//#endregion
//#region src/pi-provider.d.ts
/** The gateway plane a provider serves. */
type Plane = "opencode" | "opencode-go";
//#endregion
//#region src/responses-provider.d.ts
/** One model entry, in the shape `llm-pi-ai`'s config schema expects. */
interface ModelProfile {
  contextWindow: number;
  id: string;
  input: string[];
  maxTokens: number;
  name: string;
  reasoningEfforts?: Record<string, string | null> | false;
}
/**
 * The host's already-loaded `llm-pi-ai`, asked of the loader rather than guessed
 * from the filesystem.
 *
 * The loader imported the plugin in the first place, so its entry carries — or
 * carried — the raw import result. That is the only way to reach the plugin
 * which does not encode a package-manager layout — this repository deliberately
 * does not depend on `llm-pi-ai`, because doing so drags in roughly a thousand
 * lockfile lines and makes pnpm refuse the install over ignored build scripts.
 *
 * Two loader generations answer differently and both are in the wild, so both
 * shapes are read here: one keeps the raw module on the entry, and one keeps
 * only the fiber ({@link pluginFromFiber} reconstructs that). `unwrapExports`
 * is the loader's own normalization, so a default-export or CJS-interop shape
 * needs no second guess.
 *
 * @param ctx - host context carrying the loader.
 * @returns the plugin, or `undefined` when no entry carries a usable one.
 */
export declare const loadPiAi: (ctx: unknown) => Record<string, unknown> | undefined;
/**
 * The credential reference the composition already resolves for `opencode`.
 *
 * A deployment that named its own environment variable must not be asked to
 * state it again here: pi-ai resolves the reference through the credentials
 * service, so the same reference is the same stored record, and a different one
 * would be a route that authenticates as nobody.
 *
 * @param ctx - host context carrying the loader.
 * @returns the declared reference, or the documented default.
 */
export declare const inheritedCredentialRef: (ctx: unknown, plane?: Plane) => string;
/**
 * Every model the gateway serves on the API one SDK names.
 *
 * The default catalog unions BOTH planes, which is the right answer to "what
 * does this gateway serve". It is the wrong answer for the routes this module
 * mounts: they carry Zen's `baseURL`, and the Go plane names models the Zen
 * endpoint does not serve, so offering one resolves to "model not found" against
 * the route's own endpoint. The mount therefore passes {@link getLiveZenCatalog}
 * explicitly.
 *
 * @param sdk - the models.dev `provider.npm` value the route serves.
 * @param catalog - the catalog to read; both planes by default.
 * @returns one profile per model, deduplicated.
 */
export declare const modelsForSdk: (sdk: string, catalog?: readonly CatalogModelSpec[]) => ModelProfile[];
/**
 * Mount the host's `llm-pi-ai` once, for every internal route this plugin owns.
 *
 * One mount, not one per route: `apply` declares the whole catalog on every
 * call, so a per-route mount is a collision no matter how few routes it carries.
 *
 * Never throws. A deployment where the host plugin is not loaded, or that
 * already declares these routes, keeps its previous behaviour — reported at
 * `info`, because both are expected states rather than faults.
 *
 * @param ctx - host context carrying the loader, the LLM registry and the
 *   services the mounted plugin needs.
 * @returns the disposer withdrawing the mount, or `undefined` when nothing was
 *   mounted.
 */
/**
 * The model ids the deployment declared on one plane route.
 *
 * `ctx.llm` is the projection of the user's own configuration: `listModels(route)`
 * answers what that route advertises, and a route the user wrote is exactly what
 * we must not widen. Returns `undefined` when the service cannot answer — the
 * caller then falls back to the catalog rather than mounting nothing.
 *
 * @param ctx - the host context.
 * @param route - the plane route (`opencode`, `opencode-go`).
 * @returns the declared ids, or `undefined` when unreadable.
 */
/**
 * Narrow a route's models to the ones the deployment declared.
 *
 * The rule the mount needs and the whole reason it can be trusted: a route's
 * model list is what a picker shows, so it may never be wider than the user's own
 * configuration. `undefined` means "the declaration could not be read", which
 * falls back to the full list rather than mounting nothing.
 *
 * @param models - the protocol's models, from the catalog.
 * @param declared - the ids the user wrote, or `undefined` when unreadable.
 * @returns `models` when unreadable, otherwise only the declared entries.
 */
/**
 * Declared models that speak a protocol nothing in this composition serves.
 *
 * The case this exists for: `internalRoutes: false` turns the automatic mount off,
 * and a declared model whose protocol differs from its provider's then has no
 * route to answer for it. Silence would be the worst outcome — the model is in the
 * picker and every call fails — so the caller logs these by name and protocol.
 *
 * A model the catalog does not describe is skipped: it cannot be known to need
 * anything else, and guessing would produce a warning that is wrong more often
 * than right.
 *
 * @param declaredByPlane - the ids the deployment declared, per plane route.
 * @param served - the `plane:protocol` pairs some route serves.
 * @returns one `id (protocol)` entry per unrouted model, sorted for a stable log.
 */
export declare const unroutedDeclaredModels: (declaredByPlane: ReadonlyMap<string, ReadonlySet<string>>, served: ReadonlySet<string>) => string[];
/**
 * Declared models the bundled catalog does not describe.
 *
 * Two populations, and both are worth naming once at startup: an id NEWER than
 * the bundled snapshot (the shim is generated, so it lags the vendor between
 * releases) and an id the vendor has marked `deprecated` (the shim drops those by
 * design). Either way the model is served from the DEPLOYMENT's configuration —
 * the host lists it, the route speaks it — but this plugin can add no metadata:
 * no context window, no modalities, no reasoning levels. Saying so is the
 * difference between "the plugin is ignoring my model" and "the plugin has never
 * seen that id".
 *
 * @param declaredByPlane - the ids the deployment declared, per plane route.
 * @returns one `id (plane)` entry per undescribed model, sorted for a stable log.
 */
export declare const undescribedDeclaredModels: (declaredByPlane: ReadonlyMap<string, ReadonlySet<string>>) => string[];
export declare const narrowToDeclared: <T extends {
  readonly id: string;
}>(models: readonly T[], declared?: ReadonlySet<string>) => readonly T[];
export declare const registerResponsesProvider: (ctx: CordisContext, config?: ResolvedPluginConfig) => Promise<(() => void) | undefined>;
//#endregion
export type { ActiveTurnState, CatalogModelSpec, CatalogProvider, CordisContext, DiscoveryCandidate, EndpointFamily, GoUsage, KeySourcePolicy, ModelCostRate, ModelOverrideConfig, ParsedCatalogs, PluginConfig, ResolvedPluginConfig, RoutedKeyDetails, SessionUsageSnapshot, UsageQuery, UsageWindow };