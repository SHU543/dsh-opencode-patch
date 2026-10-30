import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import z from "@deepseek-ai/schemastery";
import { appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region src/identity.ts
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
const name = "dsh-opencode-patch";
/** Pre-rename component identity; rows using it get a rename notice. */
const LEGACY_NAME = "dsh-opencode";
/** Pre-rename npm package; rows using it get a rename notice. */
const LEGACY_PKG = "@viztor/dsh-opencode";
/** Host injections: the plugin needs the `llm` stream lifecycle. */
const inject = ["llm"];
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
const OPENCODE_CLI_VERSION = "1.19.4";
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
const OPENCODE_USER_AGENT = `opencode/${OPENCODE_CLI_VERSION}`;
/** The User-Agent the plugin signs its own requests with. */
const OPENCODE_PATCH_USER_AGENT = `opencode/${OPENCODE_CLI_VERSION} dsh-opencode-patch`;
//#endregion
//#region src/utils/guards.ts
/**
* Structural type guards over `unknown` values, so every narrow step proves a
* shape instead of casting to it. Dependency-free: host and client both import it.
*
* @module dsh-opencode-patch/guards
*/
/** True for a non-null, non-array object usable as a property bag. */
const isRecord = (value) => {
	if (value === null || value === void 0) return false;
	if (typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	return true;
};
/** True for any array, regardless of element type. */
const isUnknownArray = (value) => Array.isArray(value);
/** True for any callable value (method guard for `Reflect.apply`). */
const isFunctionLike = (value) => typeof value === "function";
/** True when `value` carries a callable `next`, i.e. an async iterator. */
const isAsyncIteratorLike = (value) => {
	if (value === null || value === void 0) return false;
	if (typeof value !== "object" && typeof value !== "function") return false;
	if (!("next" in value)) return false;
	return typeof value.next === "function";
};
/** Pull the live async iterator out of an iterable, or `undefined` if none. */
const getAsyncIterator = (iterable) => {
	const candidate = iterable;
	if (candidate === null || candidate === void 0) return;
	if (typeof candidate !== "object" && typeof candidate !== "function") return;
	if (!(Symbol.asyncIterator in candidate)) return;
	const factory = candidate[Symbol.asyncIterator];
	if (typeof factory !== "function") return;
	const iterator = factory.call(candidate);
	if (!isAsyncIteratorLike(iterator)) return;
	return iterator;
};
/** True for anything exposing a callable `Symbol.asyncIterator`. */
const isAsyncIterableLike = (value) => {
	if (value === null || value === void 0) return false;
	if (typeof value !== "object" && typeof value !== "function") return false;
	if (!(Symbol.asyncIterator in value)) return false;
	return typeof value[Symbol.asyncIterator] === "function";
};
/** True for a callable `fetch`. */
const isFetchFunction = (value) => typeof value === "function";
//#endregion
//#region src/config-values.ts
/**
* Coercion readers shared by the host config resolver and the client card, so
* both apply the same "absent or invalid means default" rule. Dependency-free by
* design: importing schemastery would ship the validator to the browser.
*
* @module dsh-opencode-patch/config-values
*/
/** Marker meaning "apply to every model" instead of a literal substring. */
const ALL_MODELS_MARKER = "*";
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
const DEFAULT_PROVIDERS = [
	"opencode",
	"opencode-go",
	"opencode-responses",
	"opencode-anthropic",
	"opencode-google",
	"opencode-go-responses",
	"opencode-go-anthropic",
	"opencode-go-google"
];
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
const KEY_SOURCE_POLICIES = [
	"auto",
	"request",
	"configured"
];
/** Policy applied when a row does not name one. */
const DEFAULT_KEY_SOURCE = "auto";
/** Whether `value` is one of the accepted policies. */
const isKeySourcePolicy = (value) => typeof value === "string" && KEY_SOURCE_POLICIES.includes(value);
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
const ENDPOINT_FAMILIES = [
	"auto",
	"legacy",
	"modern"
];
/** Family applied when a row does not name one. */
const DEFAULT_ENDPOINT_FAMILY = "auto";
/** Whether `value` is one of the accepted families. */
const isEndpointFamily = (value) => typeof value === "string" && ENDPOINT_FAMILIES.includes(value);
/**
* Unwrap a schemastery volatile `.get()` node to its current value.
*
* Idempotent: plain values pass through untouched, so the host behaves
* identically whether the row carries explicit values, schema-defaulted
* nodes, or raw JSON.
*/
const unwrapNode = (val) => {
	if (val !== null && typeof val === "object" && "get" in val && typeof val.get === "function") return Reflect.apply(val.get, val, []);
	return val;
};
/**
* Read a boolean: an explicit boolean wins, non-boolean junk degrades to
* `fallback` rather than toggling the feature by accident.
*/
const readBoolean = (value, fallback) => {
	const raw = unwrapNode(value);
	return typeof raw === "boolean" ? raw : fallback;
};
/**
* Read a trimmed string, or `undefined` when absent/blank.
*
* @param value - raw value, possibly a volatile node.
*/
const readString = (value) => {
	const raw = unwrapNode(value);
	if (typeof raw !== "string") return;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : void 0;
};
/**
* Read a trimmed list of non-blank strings, dropping anything else.
*
* @param value - raw value, possibly a volatile node.
* @returns the valid trimmed entries; empty when the value is not a usable list.
*/
const readStringList = (value) => {
	const raw = unwrapNode(value);
	if (!isUnknownArray(raw)) return [];
	return raw.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
};
/**
* Read a positive finite integer, or `undefined` when absent/invalid.
*
* @param value - raw value, possibly a number or string.
*/
const readPositiveInteger = (value) => {
	const raw = unwrapNode(value);
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
	if (typeof raw === "string" && raw.trim().length > 0) {
		const parsed = Number(raw.trim());
		if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
	}
};
//#endregion
//#region src/config.ts
/**
* Host-side plugin configuration: defaults, raw/resolved types, the row
* schema, and the resolver that folds either into one resolved shape.
*
* Every default lives exactly once — in {@link CONFIG_DEFAULTS} — and both
* `resolveConfig` and the `Config` schema read from it, so the schema and the
* resolver cannot drift apart (the "defaults mirror resolveConfig" contract
* is structural rather than a comment asking future editors to keep two
* literal lists in sync).
*
* @module dsh-opencode-patch/config
*/
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
const DEFAULT_GATEWAY_URLS = ["opencode.ai/zen", "opencode.ai/inference"];
/** Value restored into `x-opencode-client` by default. */
const DEFAULT_ORIGIN_CLIENT = "cli";
/** Whether to attach the workspace project identifier (x-opencode-project) by default. */
const DEFAULT_INJECT_PROJECT = true;
/**
* Model-id substring that marks a request as free-tier (and therefore in need
* of the core-tool schema fallback).
*/
const DEFAULT_FREE_MODEL_MARKER = "free";
/** Environment variable consulted for the fallback session id. */
const DEFAULT_SESSION_ID_ENV = "OPENCODE_SESSION_ID";
/** Default OpenCode Go quota endpoint. */
const DEFAULT_USAGE_BASE_URL = "https://opencode.ai/zen/go/v1";
/** Default environment variable / credential ref holding the Go key. */
const DEFAULT_USAGE_KEY_ENV = "OPENCODE_GO_API_KEY";
/**
* The single source of truth for every documented default. Blank / absent
* user values fall back to these; the `Config` schema `.default()`s to the
* same values.
*/
const CONFIG_DEFAULTS = {
	credentialOrg: void 0,
	debug: false,
	enrichModels: true,
	endpoint: DEFAULT_ENDPOINT_FAMILY,
	freeModelMarker: DEFAULT_FREE_MODEL_MARKER,
	gatewayUrls: DEFAULT_GATEWAY_URLS,
	injectCoreTools: true,
	injectOriginHeaders: true,
	injectProject: true,
	injectUserAgent: true,
	keySource: DEFAULT_KEY_SOURCE,
	maxContextWindow: void 0,
	modelOverrides: {},
	modelRoutes: {},
	internalRoutes: true,
	originClient: "cli",
	providers: DEFAULT_PROVIDERS,
	readOpencodeStore: false,
	sessionIdEnv: DEFAULT_SESSION_ID_ENV,
	usageBaseURL: DEFAULT_USAGE_BASE_URL,
	usageEnabled: true
};
/**
* Fold a raw row config (or schema-validated output) into the resolved shape.
*
* Blank strings and empty lists inherit the defaults, so a row that mentions a
* key without a usable value behaves exactly like a row that omits it.
*
* @param rawInput - raw or validated row config.
*/
/**
* A row's key-source policy, or the default when it names something else.
*
* Deliberately lenient: a typo in a hand-edited row degrades to `auto` rather
* than failing the plugin load.
*/
const resolvedKeySource = (raw) => {
	const value = readString(raw);
	return isKeySourcePolicy(value) ? value : CONFIG_DEFAULTS.keySource;
};
/**
* A row's endpoint family, or the default when it names something else.
*
* Lenient for the same reason {@link resolvedKeySource} is: a typo in a
* hand-edited row degrades to `auto`, which follows the catalog and is the
* answer that cannot be wrong about which family is current.
*/
const resolvedEndpoint = (raw) => {
	const value = readString(raw);
	return isEndpointFamily(value) ? value : CONFIG_DEFAULTS.endpoint;
};
/**
* Read the per-model routing overrides.
*
* An entry without a usable field is dropped rather than repaired: a typo must
* not silently pin a model to an endpoint nobody meant.
*
* @param raw - the config value.
* @returns the overrides, keyed by model id.
*/
const resolveModelRoutes = (raw) => {
	if (!isRecord(raw)) return {};
	const result = {};
	for (const [modelId, value] of Object.entries(raw)) {
		if (!isRecord(value)) continue;
		const api = readString(value.api);
		const baseURL = readString(value.baseURL ?? value.base_url);
		if (api === void 0 && baseURL === void 0) continue;
		result[modelId] = {
			...api === void 0 ? {} : { api },
			...baseURL === void 0 ? {} : { baseURL }
		};
	}
	return result;
};
const resolveModelOverrides = (raw) => {
	if (!isRecord(raw)) return {};
	const result = {};
	for (const [modelId, value] of Object.entries(raw)) {
		if (!isRecord(value)) continue;
		const contextWindow = readPositiveInteger(value.contextWindow ?? value.context_window);
		const maxTokens = readPositiveInteger(value.maxTokens ?? value.max_output_tokens);
		const name = readString(value.name);
		const reasoningEfforts = readStringList(value.reasoningEfforts ?? value.efforts);
		let rawModalities;
		if (Array.isArray(value.inputModalities)) rawModalities = value.inputModalities;
		else if (Array.isArray(value.modalities)) rawModalities = value.modalities;
		const inputModalities = rawModalities === void 0 ? void 0 : rawModalities.filter((m) => m === "text" || m === "image");
		const cost = isRecord(value.cost) ? {
			input: typeof value.cost.input === "number" ? value.cost.input : 0,
			output: typeof value.cost.output === "number" ? value.cost.output : 0,
			...typeof value.cost.cache_read === "number" ? { cache_read: value.cost.cache_read } : {},
			...typeof value.cost.cache_write === "number" ? { cache_write: value.cost.cache_write } : {}
		} : void 0;
		const entry = {};
		if (contextWindow !== void 0) Object.assign(entry, { contextWindow });
		if (maxTokens !== void 0) Object.assign(entry, { maxTokens });
		if (name !== void 0) Object.assign(entry, { name });
		if (reasoningEfforts.length > 0) Object.assign(entry, { reasoningEfforts });
		if (inputModalities !== void 0) Object.assign(entry, { inputModalities });
		if (cost !== void 0) Object.assign(entry, { cost });
		result[modelId] = entry;
	}
	return result;
};
const resolveConfig = (rawInput = {}) => {
	const config = rawInput ?? {};
	const providers = readStringList(config.providers);
	const gatewayUrls = readStringList(config.gatewayUrls);
	return {
		credentialOrg: readString(config.credentialOrg),
		debug: readBoolean(config.debug, CONFIG_DEFAULTS.debug),
		debugFile: readString(config.debugFile),
		enrichModels: readBoolean(config.enrichModels, CONFIG_DEFAULTS.enrichModels),
		endpoint: resolvedEndpoint(config.endpoint),
		freeModelMarker: readString(config.freeModelMarker) ?? CONFIG_DEFAULTS.freeModelMarker,
		gatewayUrls: gatewayUrls.length > 0 ? gatewayUrls : [...CONFIG_DEFAULTS.gatewayUrls],
		injectCoreTools: readBoolean(config.injectCoreTools, CONFIG_DEFAULTS.injectCoreTools),
		injectOriginHeaders: readBoolean(config.injectOriginHeaders, CONFIG_DEFAULTS.injectOriginHeaders),
		injectProject: readBoolean(config.injectProject, CONFIG_DEFAULTS.injectProject),
		injectUserAgent: readBoolean(config.injectUserAgent, CONFIG_DEFAULTS.injectUserAgent),
		keySource: resolvedKeySource(config.keySource),
		maxContextWindow: readPositiveInteger(config.maxContextWindow),
		modelOverrides: resolveModelOverrides(config.modelOverrides),
		modelRoutes: resolveModelRoutes(config.modelRoutes),
		internalRoutes: readBoolean(config.internalRoutes, CONFIG_DEFAULTS.internalRoutes),
		originClient: readString(config.originClient) ?? CONFIG_DEFAULTS.originClient,
		providers: new Set(providers.length > 0 ? providers : [...CONFIG_DEFAULTS.providers]),
		readOpencodeStore: readBoolean(config.readOpencodeStore, CONFIG_DEFAULTS.readOpencodeStore),
		sessionIdEnv: readString(config.sessionIdEnv) ?? CONFIG_DEFAULTS.sessionIdEnv,
		userAgent: readString(config.userAgent),
		usageBaseURL: readString(config.usageBaseURL) ?? CONFIG_DEFAULTS.usageBaseURL,
		usageEnabled: readBoolean(config.usageEnabled, CONFIG_DEFAULTS.usageEnabled)
	};
};
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
const Config = z.object({
	providers: z.array(z.string()).default([...CONFIG_DEFAULTS.providers]).volatile().description("Provider route keys to intercept."),
	gatewayUrls: z.array(z.string()).default([...CONFIG_DEFAULTS.gatewayUrls]).volatile().description("URL substrings marking OpenCode gateway traffic (matched before providers)."),
	injectUserAgent: z.boolean().default(CONFIG_DEFAULTS.injectUserAgent).volatile().description("Restore the opencode CLI User-Agent stripped by the DSH LLM adapter."),
	userAgent: z.string().volatile().description("Custom User-Agent string. Leave blank to use the canonical OpenCode CLI one."),
	keySource: z.string().default(CONFIG_DEFAULTS.keySource).volatile().description("Which credential source wins when several resolve. auto: a literal key declared in another entry, then a key captured from a live request, then the declared reference, then a captured key for the other plane. request: a captured key first, then a literal one, then the declared reference. configured: a literal key, then the declared reference, then captured ones. An unrecognised value falls back to auto."),
	readOpencodeStore: z.boolean().default(CONFIG_DEFAULTS.readOpencodeStore).volatile().description("Read the credential the OpenCode installation already holds, from its own database, as the LAST resort: after every credential this deployment declares. Off by default — reading another tool's store is something a user turns on, not something that happens to them."),
	injectOriginHeaders: z.boolean().default(CONFIG_DEFAULTS.injectOriginHeaders).volatile().description("Inject x-opencode-client header."),
	originClient: z.string().default(CONFIG_DEFAULTS.originClient).volatile().description("Value restored into the x-opencode-client header."),
	injectProject: z.boolean().default(CONFIG_DEFAULTS.injectProject).volatile().description("Attach the active workspace folder name (or 'global' if outside a project) in x-opencode-project."),
	injectCoreTools: z.boolean().default(CONFIG_DEFAULTS.injectCoreTools).volatile().description("Auto-inject read and bash tool schemas on free-tier requests."),
	freeModelMarker: z.string().default(CONFIG_DEFAULTS.freeModelMarker).volatile().description("Model-id marker triggering the core-tool fallback; * applies to every model."),
	sessionIdEnv: z.string().default(CONFIG_DEFAULTS.sessionIdEnv).volatile().description("Environment variable consulted for the fallback session id outside a turn."),
	usageEnabled: z.boolean().default(CONFIG_DEFAULTS.usageEnabled).volatile().description("Enable host-side OpenCode Go usage querying."),
	enrichModels: z.boolean().default(CONFIG_DEFAULTS.enrichModels).volatile().description("Enrich and override gateway models list using canonical models.dev catalog."),
	endpoint: z.string().default(CONFIG_DEFAULTS.endpoint).description("Which endpoint family the gateway's requests go to. auto: follow the catalog's own address (today the inference family). legacy: force https://opencode.ai/zen/v1. modern: force https://opencode.ai/inference/v1. The two families are separately entitled and both still answer, so this is a choice rather than a migration; an unrecognised value falls back to auto.").volatile(),
	maxContextWindow: z.number().volatile().description("Optional ceiling to clamp model context windows (e.g. 131072, 262144)."),
	modelOverrides: z.any().default({}).volatile().description("Optional per-model overrides for contextWindow, maxTokens, and metadata."),
	modelRoutes: z.any().default({}).volatile().description("Per-model wire routing overrides: { <id>: { api, baseURL } }. The api names a pi protocol; baseURL replaces the catalog's endpoint."),
	internalRoutes: z.boolean().default(CONFIG_DEFAULTS.internalRoutes).volatile().description("Mount the internal per-protocol routes. Off for a deployment that declares its own providers for the other protocols."),
	usageBaseURL: z.string().default(CONFIG_DEFAULTS.usageBaseURL).volatile().description("OpenCode Go gateway base URL."),
	// 本机新增：key 直接存插件配置，避免依赖凭据库/环境变量。留空则回退到原有解析链。
	apiKey: z.string().volatile().description("OpenCode API key (Go: sk-..., Zen: oc_sk_...). Stored in this plugin's settings; leave blank to use the credentials service instead."),
	apiKeyEnv: z.string().volatile().description("Name of the env var / credential reference to fall back to when apiKey is blank (default OPENCODE_GO_API_KEY)."),
	credentialOrg: z.string().volatile().description("The org id (wrk_...) to send with an account credential. A login through this plugin stores the org with the token, so this is only for a token that came from elsewhere."),
	debug: z.boolean().default(CONFIG_DEFAULTS.debug).description("Log injected streamed calls."),
	debugFile: z.string().description("Server-side path for JSONL stream-debug entries.")
});
//#endregion
//#region src/cordis-context.ts
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
* The plugin's own cordis entry options (`fiber.entry.options`), when the
* context carries them. Used only to detect a legacy row id/name and log the
* rename notice.
*
* @param ctx - the plugin context, mock or real.
*/
const readEntryOptions = (ctx) => {
	if (!isRecord(ctx)) return;
	const fiber = ctx.fiber;
	if (!isRecord(fiber)) return;
	const entry = fiber.entry;
	if (!isRecord(entry)) return;
	const options = entry.options;
	if (!isRecord(options)) return;
	const id = typeof options.id === "string" ? options.id : void 0;
	const name = typeof options.name === "string" ? options.name : void 0;
	if (id === void 0 && name === void 0) return;
	return {
		id,
		name
	};
};
/**
* Resolve a credential reference through `ctx.get("credentials")`, or
* `undefined` when the Host serves no credentials service.
*
* Errors thrown by the service degrade to `undefined`: a broken credentials
* service must not fail a plugin whose env fallback still works.
*
* @param ctx - the plugin context, mock or real.
*/
const readCredentialsResolver = (ctx) => {
	if (!isRecord(ctx) || !isFunctionLike(ctx.get)) return;
	const { get } = ctx;
	let host;
	try {
		host = Reflect.apply(get, ctx, ["credentials"]);
	} catch {
		return;
	}
	if (!isRecord(host) || !isFunctionLike(host.resolve)) return;
	const { resolve } = host;
	return async (ref) => {
		let hit;
		try {
			hit = await Reflect.apply(resolve, host, [ref]);
		} catch {
			return;
		}
		if (!isRecord(hit)) return;
		const value = hit.value;
		return typeof value === "string" ? { value } : {};
	};
};
/**
* The loader's entry surface, or `undefined` when the context serves none.
*
* **Returns what it found rather than asserting a property exists.** The
* previous version was a type PREDICATE (`ctx is LoaderHost`) whose body read
* `ctx.loader` — so the guard threw `cannot get property "loader" without
* inject` on exactly the contexts it existed to describe, and the narrowed type
* pointed at a property that could throw on read. A guard has to hand back the
* value it verified.
*
* `ctx.get` first: it reads the store WITHOUT consulting `inject`, which is what
* an optional dependency needs, and this plugin declares only `llm`. The
* property is a guarded fallback for a context that serves only that.
*
* @param ctx - the plugin context, mock or real.
* @returns the loader service, or `undefined`.
*/
const loaderOfContext = (ctx) => {
	if (!isRecord(ctx)) return;
	let loader;
	const { get } = ctx;
	if (typeof get === "function") try {
		loader = Reflect.apply(get, ctx, ["loader"]);
	} catch {
		loader = void 0;
	}
	if (loader === void 0) try {
		const { loader: viaProperty } = ctx;
		loader = viaProperty;
	} catch {
		return;
	}
	if (!isRecord(loader) || typeof loader.entries !== "function") return;
	return loader;
};
/**
* Read the session metadata lookup function from `ctx.get("sessions")` or `ctx.sessions`,
* returning `undefined` when the Host serves no session service.
*/
const readSessionMetaResolver = (ctx) => {
	if (!isRecord(ctx)) return;
	let sessions;
	if (isFunctionLike(ctx.get)) try {
		sessions = Reflect.apply(ctx.get, ctx, ["sessions"]);
	} catch {
		return;
	}
	else try {
		sessions = Reflect.get(ctx, "sessions");
	} catch {
		return;
	}
	if (!isRecord(sessions) || !isFunctionLike(sessions.get)) return;
	const { get } = sessions;
	return (sessionId) => {
		try {
			const session = Reflect.apply(get, sessions, [sessionId]);
			if (!isRecord(session)) return;
			const header = session.header;
			if (!isRecord(header)) return;
			const parentSession = readString(header.parentSession);
			const cwd = readString(header.cwd);
			return {
				createdAt: typeof session.createdAt === "number" && Number.isSafeInteger(session.createdAt) && session.createdAt >= 0 ? session.createdAt : void 0,
				cwd,
				parentSession
			};
		} catch {
			return;
		}
	};
};
//#endregion
//#region src/debug.ts
/**
* Append-only JSONL stream-debug log.
*
* Debugging the gateway handshake needs the exact header set per streamed
* call, which must not spam the regular logger; a configured `debugFile`
* gets one JSON line per event, and a failed append degrades to a warning
* instead of failing the turn.
*
* @module dsh-opencode-patch/debug
*/
/**
* Append one JSONL entry to the debug file.
*
* Never rejects: an unwritable path is reported through `ctx.logger.warn`
* (or swallowed when the context has no logger).
*
* @param ctx - plugin context used only to report write failures.
* @param file - absolute server-side path to append to.
* @param entry - JSON-serializable entry; serialized with today's ISO time
* added by the caller when timing matters.
*/
const recordDebug = async (ctx, file, entry) => {
	try {
		await appendFile(file, `${JSON.stringify(entry)}\n`, "utf-8");
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		ctx.logger?.warn?.("[dsh-opencode-patch] debugFile write failed: %s", msg);
	}
};
//#endregion
//#region src/utils/request-shape.ts
/**
* Pure readers of a request's SHAPE — everything the fetch patch decides about a
* request before it touches it.
*
* Extracted because these were private inside `fetch-patch.ts`: seven
* predicates and resolvers, all pure, none reachable from a test. The exported
* ones (`hasSessionHeader`, `isOpenCodeRequest`) had tests; the private ones did
* not, which is the difference between "covered" and "testable" — a rule that
* lives in a closure cannot be exercised on its own, so its branches survive
* until some integration path happens to take them.
*
* Everything here is a function of its arguments: no context, no globals, no
* I/O. That is what makes each branch testable by calling it.
*
* @module dsh-opencode-patch/request-shape
*/
/**
* The PATH of a gateway URL, whether it is absolute or a bare path.
*
* A relative path is still a path — `"/zen/go/v1/models"` is what a caller with
* no origin passes, and the plane is a property of the path. Anything else that
* does not parse answers `""`, because guessing from a malformed string is how a
* rotation lands on the wrong credential.
*/
const pathOf = (url) => {
	try {
		return new URL(url).pathname;
	} catch {
		return url.startsWith("/") ? url.split("?")[0] ?? "" : "";
	}
};
/**
* The Go plane's paths, in both endpoint families.
*
* The vendor serves the Go plane under `/zen/go` on the older family and under
* `/inference/go` on the newer one, and a relay may use its own `/go/v1`.
*
* **The segment boundary is load-bearing.** `/inference/go` is a PREFIX of
* `/inference/google`, which is the ZEN google family — a plain `includes`
* reads it as the Go plane, and a captured key then belongs to the wrong
* account. So the segment must END there: `/inference/go` followed by a
* separator or the end of the path, never by more letters.
*/
const GO_PLANE_PATH = /\/zen\/go(?:\/|$)|\/inference\/go(?:\/|$)|\/go\/v1(?:\/|$)/u;
/** The Zen plane's paths, in both endpoint families. */
const ZEN_PLANE_PATH = /\/zen(?:\/|$)|\/inference(?:\/|$)/u;
/**
* Whether a URL is on the GO plane.
*
* **One answer for every caller.** Three places ask this question — the model
* listing's plane, a discovery request's plane, and the tier a captured key
* belongs to — and they had three answers, because the newer `inference`
* family was added to each of them separately and each addition was partial:
*
* | path | the old substring checks said |
* | :-- | :-- |
* | `/inference/go/openai/v1` | zen (the Go path was unknown to two of them) |
* | `/inference/google/v1beta` | **go** (`/inference/go` is a prefix of it) |
* | `/inference/openai/v1` | unknown (`/inference/v1` is not in it) |
*
* The middle row is a credential filed under the wrong account; the third is a
* credential filed under no account at all, which is the "my key is invalid"
* report. Both are the same mistake: a plane is a property of the PATH, and
* the path has to be read as a path.
*
* @param url - a request URL or a bare path.
* @returns whether this URL belongs to the Go plane.
*/
const isGoPlaneUrl = (url) => GO_PLANE_PATH.test(pathOf(url));
/**
* Which gateway plane a URL belongs to.
*
* From the URL alone, because the observer is called with nothing else and a
* mis-attributed rotation would move the wrong plane's credential. The Go plane
* lives under `/zen/go` and the Zen plane under `/zen`, so the longer path is
* matched first — and an unrecognised URL answers `""` rather than guessing,
* because a rotation is a side effect.
*
* @param url - a request URL (any absolute or relative string a `URL` accepts).
* @returns `opencode-go`, `opencode`, or `""` when the URL is not a gateway URL.
*/
const gatewayPlaneFor = (url) => {
	const path = pathOf(url);
	if (path === "") return "";
	if (GO_PLANE_PATH.test(path)) return "opencode-go";
	if (ZEN_PLANE_PATH.test(path)) return "opencode";
	return "";
};
/**
* The credential header the request's protocol actually reads.
*
* `/messages` is the Anthropic shape (`x-api-key`) and the Gemini path carries
* its key in `x-goog-api-key`; everything else reads `Authorization`.
*
* @param url - the request URL.
* @returns the header name, defaulting to `authorization`.
*/
const authHeaderFor = (url) => {
	let path;
	try {
		path = new URL(url).pathname;
	} catch {
		return "authorization";
	}
	if (path.endsWith("/messages")) return "x-api-key";
	if (/\/models\/[^/]+(?::streamGenerateContent|:generateContent)$/u.test(path)) return "x-goog-api-key";
	return "authorization";
};
/**
* The URL of a `fetch` input, or `""` when it has none.
*
* `fetch` accepts a string, a `URL`, or a `Request`, and the patch has to read
* every form because it wraps whatever the caller passed.
*
* @param input - the first `fetch` argument.
* @returns the URL string, or `""`.
*/
const requestUrlOf = (input) => {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (typeof input === "object" && input !== null && "url" in input) {
		const url = input.url;
		if (typeof url === "string") return url;
		if (url instanceof URL) return url.toString();
	}
	return "";
};
/**
* Where a request's headers come from: `init` when given, else the `Request`.
*
* @param input - the first `fetch` argument.
* @param init - the second, when the caller passed one.
* @returns the header source, or `undefined` when the input carries none.
*/
const headerSourceOf = (input, init) => {
	if (init?.headers !== void 0) return init.headers;
	if (typeof Request !== "undefined" && input instanceof Request) return input.headers;
};
/**
* The tool names a JSON request body carries, comma-joined.
*
* Both wire shapes are read — `{name}` and `{type:"function",function:{name}}` —
* because the fallback injects into either. A malformed body answers `""`.
*
* @param body - the request body, when there is one to read.
* @returns the names, comma-joined, or `""`.
*/
const toolNamesOf = (body) => {
	if (typeof body !== "string" || body.length === 0) return "";
	try {
		const parsed = JSON.parse(body);
		if (!isRecord(parsed)) return "";
		const { tools } = parsed;
		if (!Array.isArray(tools)) return "";
		const names = [];
		for (const tool of tools) {
			if (!isRecord(tool)) continue;
			if (typeof tool.name === "string") {
				names.push(tool.name);
				continue;
			}
			const fn = tool.function;
			if (isRecord(fn) && typeof fn.name === "string") names.push(fn.name);
		}
		return names.join(",");
	} catch {
		return "";
	}
};
/**
* The Anthropic protocol version the gateway requires on every Messages call.
*
* The official client sends it on every call and the vendor's API answers a
* request without it as a client error.
*/
const ANTHROPIC_VERSION = "2023-06-01";
/**
* Whether a provider route is OpenCode Zen rather than Go.
*
* Both routes share the `opencode` prefix, so the distinguishing signal is
* the presence of `go`: `opencode-go` is the subscription plan, plain
* `opencode` is Zen pay-as-you-go.
*/
const isZenProvider = (provider) => {
	if (typeof provider !== "string") return false;
	const lower = provider.toLowerCase();
	return lower.includes("opencode") && !lower.includes("go");
};
//#endregion
//#region src/key-capture.ts
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
/**
* Bearer values the DSH adapter emits when it holds no real credential, plus the
* gateway's own keyless sentinel.
*
* These are the exact strings the Authorization fallback exists to repair, so
* they must never be *recorded* as a captured key: doing so overwrites a working
* key with a dummy one, and every later lookup then re-injects the dummy.
*
* `public` is not an adapter placeholder — it is the gateway's own literal for a
* keyless request, the vendor's own path for a model whose entry allows
* anonymous use. The proxy treats no key and the literal alike, strips it and
* forwards keylessly (`packages/console/app/src/lib/inference-proxy.ts`, both
* 1.19 and 2.x: `const anonymous = !key || key === "public"`). What the service
* behind the proxy answers is its own decision — the Zen free tier is refused
* there — but the sentinel must never become a credential: capturing it would
* forward `Bearer public`, turning an anonymous request into an authenticated
* one. See `docs/upstream-findings.md` §1.5.
*/
const PLACEHOLDER_API_KEYS = /* @__PURE__ */ new Set([
	"null",
	"none",
	"public",
	"undefined",
	"unused"
]);
/** Whether a value is one of the adapter's placeholder credentials. */
const isPlaceholderApiKey = (key) => PLACEHOLDER_API_KEYS.has(key.trim().toLowerCase());
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
const tierForRequest = (url, provider, key) => {
	if (typeof key === "string" && key.length > 0) {
		if (key.startsWith("sk-")) return "go";
		if (key.startsWith("oc_sk_")) return "zen";
	}
	if (typeof url === "string" && url.length > 0) {
		const plane = gatewayPlaneFor(url);
		if (plane === "opencode-go") return "go";
		if (plane === "opencode") return "zen";
	}
	if (provider === "opencode-go") return "go";
	if (provider === "opencode") return "zen";
	return "unknown";
};
const readHeaderString = (headers, keys) => {
	for (const key of keys) {
		const val = headers[key];
		if (typeof val === "string" && val.length > 0) return val;
	}
};
/** `Authorization: Bearer <key>` reduced to `<key>`, or `undefined`. */
const bearerValue = (raw) => {
	const match = raw.replace(/^Bearer\s+/i, "").trim();
	return match.length > 0 ? match : void 0;
};
/**
* Extract an API key from a `Headers` instance or a plain header record.
*
* Handles Bearer, Anthropic and Google key headers. A placeholder in one
* header must not mask a real credential in another. When every value is a
* placeholder, returns the first raw value for callers that diagnose it.
*/
const extractApiKeyFromHeaders = (headers) => {
	if (headers === null || headers === void 0) return;
	let read;
	if (typeof Headers !== "undefined" && headers instanceof Headers) read = (keys) => headers.get(keys[0] ?? "") ?? void 0;
	else if (isRecord(headers)) read = (keys) => readHeaderString(headers, keys);
	if (read === void 0) return;
	const auth = read(["authorization", "Authorization"]);
	const candidates = [
		auth === void 0 ? void 0 : bearerValue(auth),
		read(["x-api-key", "X-Api-Key"]),
		read(["api-key", "API-KEY"]),
		read(["x-goog-api-key", "X-Goog-Api-Key"])
	].map((value) => value?.trim()).filter((value) => value !== void 0 && value.length > 0);
	return candidates.find((value) => !isPlaceholderApiKey(value)) ?? candidates[0];
};
/**
* The capture store, read three ways.
*
* A lookup can be scoped by route (`capturedKeysByProvider`) or by tier
* (`capturedKeysByTier`); the tier map is what makes a lookup survive a renamed
* route. `latestCapturedKey` is the last resort, and is why the tier argument
* matters: without it, "most recently seen" can hand the Go endpoint a Zen key.
*
* The route-scoped map carries the tier ALONGSIDE the key rather than only the
* key. It used to hold `string`, which made the route lookup the one path that
* ignored a requested tier: a Zen key seen while the Go route was in play came
* back verbatim, so it outranked every correctly-filtered source — and it is the
* FIRST captured step of both `auto` and `request`. Holding the tier is what lets
* the route lookup apply the same rule the other two already did.
*/
const capturedKeysByProvider = /* @__PURE__ */ new Map();
const capturedKeysByTier = /* @__PURE__ */ new Map();
let latestCapturedKey;
/**
* Whether a key classified as `tier` may answer a lookup for `wanted`.
*
* `unknown` is deliberately permissive, and identically so in all three lookup
* paths: an unclassifiable key is one we never identified, not one we proved to
* be the other tier. Filtering on "not the opposite" instead would make the
* guess fail closed and hide working keys.
*/
const tierSatisfies = (tier, wanted) => tier === wanted || tier === "unknown";
/**
* Record an API key captured from live HTTP request headers or provider configurations.
*
* A blank or placeholder value is ignored rather than stored.
*/
const recordCapturedApiKey = (rawKey, provider, url) => {
	const key = rawKey.trim();
	if (key.length === 0 || isPlaceholderApiKey(key)) return;
	const tier = tierForRequest(url, provider, key);
	if (typeof provider === "string" && provider.length > 0) capturedKeysByProvider.set(provider, {
		key,
		tier
	});
	if (tier !== "unknown") capturedKeysByTier.set(tier, key);
	latestCapturedKey = {
		key,
		provider,
		tier
	};
};
/**
* Retrieve a previously captured API key by provider or tier.
*
* @param provider - route id to try first, when the caller has one.
* @param tier - the tier the key must belong to. Pass it whenever the request
* already identifies one: omitting it lets the most recently seen key win,
* which may be for the other tier. A route-scoped hit is filtered by it too —
* naming a route is a preference, not a licence to ignore the tier.
*/
const getCapturedApiKey = (provider, tier) => {
	if (typeof provider === "string" && provider.length > 0) {
		const direct = capturedKeysByProvider.get(provider);
		if (direct !== void 0 && direct.key.length > 0 && (tier === void 0 || tierSatisfies(direct.tier, tier))) return direct.key;
	}
	if (tier !== void 0) {
		const byTier = capturedKeysByTier.get(tier);
		if (byTier !== void 0 && byTier.length > 0) return byTier;
	}
	if (latestCapturedKey !== void 0 && latestCapturedKey.key.length > 0 && (tier === void 0 || tierSatisfies(latestCapturedKey.tier, tier))) return latestCapturedKey.key;
};
/**
* Clear all captured API keys (primarily used in test teardown).
*/
const clearCapturedApiKeys = () => {
	capturedKeysByProvider.clear();
	capturedKeysByTier.clear();
	latestCapturedKey = void 0;
};
//#endregion
//#region src/opencode-paths.ts
/**
* Where an OpenCode installation keeps its files, resolved the way OpenCode
* resolves them.
*
* This is a port of two files in the OpenCode sources, and it exists because the
* path is not a constant: `~/.local/share/opencode/opencode.db` is right on a
* stable channel and wrong under a moved `$XDG_DATA_HOME`, a named channel, or an
* `$OPENCODE_DB` override.
*
* - `packages/util/src/global-roots.ts` — the directory. It is XDG on every
*   platform, so macOS and Windows use `~/.local/share` too; `os.os.homedir()` is the
*   only platform-dependent call, which is why `home` is a parameter here.
* - `packages/cli/src/database-path.ts` — the filename, which varies by channel.
*
* Nothing here reads the environment or the filesystem: the caller passes both, so
* the resolution can be tested on any platform from any platform.
*
* @module dsh-opencode-patch/opencode-paths
*/
/** The channels whose database is named plainly rather than per channel. */
const STABLE_CHANNELS = /* @__PURE__ */ new Set([
	"latest",
	"dev",
	"beta",
	"next",
	"prod"
]);
/**
* Resolve the XDG roots the way `roots("opencode")` does.
*
* Each falls back to a `~`-relative path, and `tmp` to the platform temporary
* directory, which the caller supplies for the same reason it supplies `home`.
*
* @param environment - home, environment variables, and the channel.
* @param tmp - the platform temporary directory.
* @returns the five roots.
*/
const opencodeRoots = (environment, tmp) => {
	const { env, home } = environment;
	const root = (variable, fallback) => path.join(env[variable] ?? path.join(home, fallback), "opencode");
	return {
		cache: root("XDG_CACHE_HOME", ".cache"),
		config: root("XDG_CONFIG_HOME", ".config"),
		data: root("XDG_DATA_HOME", path.join(".local", "share")),
		state: root("XDG_STATE_HOME", path.join(".local", "state")),
		tmp: path.join(tmp, "opencode")
	};
};
/**
* The database filename, before it is joined to a root.
*
* `$OPENCODE_DB` wins outright, including when it is `:memory:`. Otherwise a
* stable channel — or `$OPENCODE_DISABLE_CHANNEL_DB` — gives `opencode.db`, and
* anything else gives `opencode-<channel>.db` with characters outside
* `[a-zA-Z0-9._-]` replaced by `-`, which is what the original does.
*
* @param environment - home, environment variables, and the channel.
* @returns the filename, or `:memory:`.
*/
const opencodeDatabaseFile = (environment) => {
	const { channel, env } = environment;
	const declared = env.OPENCODE_DB;
	if (declared !== void 0 && declared.length > 0) return declared;
	const disable = env.OPENCODE_DISABLE_CHANNEL_DB;
	if (channel !== void 0 && STABLE_CHANNELS.has(channel) || disable === "1" || disable === "true" || channel === void 0 || channel.length === 0) return "opencode.db";
	return `opencode-${channel.replaceAll(/[^a-zA-Z0-9._-]/gu, "-")}.db`;
};
/**
* The absolute path of the credential database, or `:memory:`.
*
* The one place the two resolutions meet: the filename lives under **data**, not
* under config, so a reader that used one root for both would look in the wrong
* directory.
*
* @param environment - home, environment variables, and the channel.
* @param tmp - the platform temporary directory.
* @returns the path to open, or `:memory:`.
*/
const opencodeDatabasePath = (environment, tmp) => {
	const file = opencodeDatabaseFile(environment);
	return file === ":memory:" ? file : path.join(opencodeRoots(environment, tmp).data, file);
};
//#endregion
//#region src/opencode-store.ts
/**
* Reading the credentials an OpenCode installation already holds.
*
* This is the opt-in half of the credential story: a user who has signed in to
* OpenCode should not have to sign in again here. It is off by default and a
* credential declared in DSH always wins — reading another tool's store is
* something a user turns on, not something that happens to them.
*
* Two rules shape everything below.
*
* - **Nothing throws.** A missing file, an unreadable file, a database from a
*   different version and a table that is not there are all the ordinary case, and
*   every one of them answers `undefined`. A reader that fails loudly on a machine
*   without OpenCode installed would be a bug in the plugin.
* - **A value never leaves this module's return value.** No logging, no error
*   message carrying a token, no shape that reaches the client bundle. The caller
*   decides what to do with a secret; this module only finds it.
*
* `node:sqlite` is a host-only built-in, which is what keeps this module on the host
* side of the bundle rule rather than in the client.
*
* @module dsh-opencode-patch/opencode-store
*/
/**
* The bearer token a credential row actually carries.
*
* Measured against a real installation: EVERY row's `value` is a JSON document
* rather than a bare key, and the shape varies by integration. `cf-coding`,
* `google`, `nvidia`, `opencode` and the two Cloudflare ones carry
* `{ type, key, metadata? }`; the exception is `xai`, which carries
* `{ type, methodID, refresh, access, expires }` and is an OAuth grant.
*
* So the raw column is not a credential. Handing it to a Bearer header puts a JSON
* document where a key belongs, and the gateway answers `Invalid credential` or,
* on the free tier, a refusal that reads as though the model itself were unusable -
* which is exactly the wrong conclusion to draw from it. The whole document is also
* how a secret ends up in a log.
*
* @param value - the raw `value` column.
* @returns the key, the OAuth access token, or `undefined` for an unknown shape.
*/
const credentialToken = (value) => {
	if (!value.trimStart().startsWith("{")) return value;
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		return;
	}
	if (!isRecord(parsed)) return;
	for (const field of ["key", "access"]) {
		const candidate = parsed[field];
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
};
/** A text column, or `undefined` when the row holds something else. */
const text = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
/** The rows a query returned, or `undefined` when anything at all went wrong. */
const rows = (path, sql) => {
	let database;
	try {
		database = new DatabaseSync(path, { readOnly: true });
		return database.prepare(sql).all();
	} catch {
		return;
	} finally {
		try {
			database?.close();
		} catch {}
	}
};
/**
* The active credentials the installation holds, or `undefined` when it holds none
* this module can read.
*
* Only active rows are returned: an inactive credential is one the user has already
* replaced, and offering it would resurrect a key they retired.
*
* @param databasePath - the path {@link opencodeDatabasePath} resolved, or `:memory:`.
* @returns the credentials, or `undefined`.
*/
const readOpencodeCredentials = (databasePath) => {
	if (databasePath === ":memory:") return;
	const found = rows(databasePath, `SELECT integration_id AS integrationId, label, value FROM credential
     WHERE active = 1
        OR (active IS NULL AND NOT EXISTS (SELECT 1 FROM credential WHERE active = 1))
     ORDER BY time_updated DESC`);
	if (found === void 0) return;
	const credentials = found.flatMap((row) => {
		const integrationId = text(row.integrationId);
		const token = credentialToken(text(row.value) ?? "");
		if (integrationId === void 0 || token === void 0) return [];
		return [{
			integrationId,
			label: text(row.label) ?? integrationId,
			value: token
		}];
	});
	return credentials.length === 0 ? void 0 : credentials;
};
/**
* Summarize one credential document, keeping only what identifies it.
*
* PURE, and extracted for that reason: every shape a real store can hold — the
* JSON document an OAuth session is, the JSON document an API key is, a bare key
* from an older version, and something malformed — is a branch a test can hand
* this function directly. Buried in the query above, the same branches would only
* be reachable by building a database per case.
*
* The token is never read: `key` and `access` are simply not consulted. `refresh`
* is looked at only to answer whether one EXISTS — its value never leaves this
* function — because that is what decides whether a lapsed session is a problem.
*
* @param raw - the `value` column, verbatim.
* @returns the identifying fields, with `type` always present.
*/
const summarizeCredential = (raw) => {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { type: raw.trimStart().startsWith("{") ? "unknown" : "key" };
	}
	if (!isRecord(parsed)) return { type: "unknown" };
	const kind = parsed.type;
	const { email, orgName } = isRecord(parsed.metadata) ? parsed.metadata : {};
	const { expires, refresh } = parsed;
	return {
		...typeof email === "string" ? { email } : {},
		...typeof expires === "number" ? {
			expired: expires < Date.now(),
			expiresAt: new Date(expires).toISOString()
		} : {},
		...typeof orgName === "string" ? { orgName } : {},
		...typeof refresh === "string" ? { refreshable: true } : {},
		type: kind === "oauth" || kind === "key" ? kind : "unknown"
	};
};
/**
* Inspect the local OpenCode installation to summarize stored account information
* WITHOUT exposing any secret tokens.
*
* Checks database existence, parses the primary active credential and/or
* account row, and extracts email, organization, account type, and expiry date.
*
* @param databasePath - path to opencode.db or :memory:
* @returns inspection summary with zero secrets
*/
const inspectOpencodeStore = (databasePath) => {
	if (databasePath === ":memory:" || !existsSync(databasePath)) return {
		found: false,
		message: "not_found"
	};
	const credRows = rows(databasePath, `SELECT integration_id AS integrationId, label, value FROM credential
     WHERE integration_id = 'opencode'
     ORDER BY active DESC, time_updated DESC`);
	const [account] = rows(databasePath, `SELECT id, email, token_expiry AS tokenExpiry FROM account
     ORDER BY time_updated DESC LIMIT 1`) ?? [];
	const [primary] = credRows ?? [];
	const summary = primary === void 0 ? void 0 : summarizeCredential(text(primary.value) ?? "");
	const email = text(account?.email) ?? summary?.email;
	const expiresAt = typeof account?.tokenExpiry === "number" ? new Date(account.tokenExpiry).toISOString() : summary?.expiresAt;
	const expired = typeof account?.tokenExpiry === "number" ? account.tokenExpiry < Date.now() : summary?.expired;
	const label = primary === void 0 ? void 0 : text(primary.label);
	const accountId = text(account?.id);
	const orgName = summary?.orgName;
	const refreshable = summary?.refreshable;
	const type = summary?.type ?? "unknown";
	if (email === void 0 && label === void 0 && type === "unknown") return {
		found: true,
		message: "no_credentials_in_store",
		path: databasePath
	};
	return {
		account: {
			accountId,
			email,
			expired,
			expiresAt,
			label,
			orgName,
			refreshable,
			type
		},
		found: true,
		message: "ok",
		path: databasePath
	};
};
//#endregion
//#region src/go-discovery.ts
/**
* OpenCode Go credential & gateway discovery.
*
* The Go plan's key and endpoint normally live in another plugin's row (an
* `llm-pi-ai` provider registry or a standalone `opencode-go` entry) rather
* than in this one, so this module reads what the composition already declares
* and falls back to a built-in default. There is deliberately **no** row setting
* for the credential reference: a knob here would duplicate the provider row's
* own `apiKeyEnv`, and the live request is the better source anyway
* (`key-capture.ts`). `usageBaseURL` remains as the one endpoint override.
*
* Credential *capture* — pulling a key off a live request and classifying its
* tier — lives in `key-capture.ts`. This module owns the plan side: which
* endpoint, which credential reference, and the policy that orders the two
* sources against each other.
*
* @module dsh-opencode-patch/go-discovery
*/
/**
* A configured string that is worth treating as a credential.
*
* Two rejections, and both are load-bearing rather than tidiness:
*
* - **Whitespace.** `apiKey: "   "` is what a YAML file produces when someone
*   indents a secret they then blank out. It passes a bare `length > 0`, and
*   since `literal` is the FIRST step of both `auto` and `configured`, it would
*   outrank a working stored credential. `config-values.ts:readString` already
*   trims, so this is also where the two halves of the repo used to disagree.
* - **Placeholders.** `Bearer unused` is not a typo — it is what this plugin's
*   own keyless routes carry, and what the README tells users to write. It is a
*   deliberate stand-in for "this route needs a key injected later", so it must
*   never be mistaken for the key itself. `recordCapturedApiKey` already refuses
*   one; a discovered literal has to refuse it too, or the meter's first step
*   hands the gateway a placeholder and the poll fails with a 401 that reads
*   like a missing subscription.
*/
const usableCredential = (value) => typeof value === "string" && value.trim().length > 0 && !isPlaceholderApiKey(value.trim());
const readProviderRow = (row, into) => {
	const keyEnv = row.apiKeyEnv;
	if (typeof keyEnv === "string" && keyEnv.length > 0) into.keyEnv = keyEnv;
	if (into.literalKey === void 0 && usableCredential(row.apiKey)) into.literalKey = row.apiKey.trim();
	const baseURL = row.baseURL;
	if (typeof baseURL === "string" && baseURL.length > 0) into.baseURL = baseURL;
	if (into.literalKey === void 0) {
		const fromHeaders = extractApiKeyFromHeaders(row.headers);
		if (usableCredential(fromHeaders)) into.literalKey = fromHeaders.trim();
	}
	if (into.literalKey === void 0 && isRecord(row.options)) {
		if (usableCredential(row.options.apiKey)) into.literalKey = row.options.apiKey.trim();
		else {
			const fromOptHeaders = extractApiKeyFromHeaders(row.options.headers);
			if (usableCredential(fromOptHeaders)) into.literalKey = fromOptHeaders.trim();
		}
	}
};
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
const discoverGoConfig = (ctx, targetProvider) => {
	const result = {};
	const loader = loaderOfContext(ctx);
	if (loader === void 0) return result;
	for (const entry of loader.entries()) {
		if (!isRecord(entry)) continue;
		const options = entry.options;
		if (!isRecord(options)) continue;
		const config = options.config;
		if (!isRecord(config)) continue;
		const providers = config.providers;
		if (isRecord(providers)) {
			if (typeof targetProvider === "string" && targetProvider.length > 0 && isRecord(providers[targetProvider])) {
				readProviderRow(providers[targetProvider], result);
				continue;
			}
			if (isRecord(providers["opencode-go"])) readProviderRow(providers["opencode-go"], result);
			else if (isRecord(providers.opencode)) readProviderRow(providers.opencode, result);
			else for (const pRow of Object.values(providers)) if (isRecord(pRow)) {
				const bUrl = pRow.baseURL;
				if (typeof bUrl === "string" && bUrl.includes("opencode.ai")) {
					readProviderRow(pRow, result);
					break;
				}
			}
		}
		const { id, name } = options;
		if (typeof targetProvider === "string" && targetProvider.length > 0 && (id === targetProvider || name === targetProvider)) {
			readProviderRow(config, result);
			continue;
		}
		if (targetProvider === void 0 && (id === "opencode-go" || id === "opencode" || name === "dsh-opencode-go" || name === "dsh-opencode")) readProviderRow(config, result);
	}
	return result;
};
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
const toGoBaseURL = (url) => {
	if (url.includes("opencode.ai/inference")) return DEFAULT_USAGE_BASE_URL;
	if (url.includes("opencode.ai/zen/v1")) return url.replace("opencode.ai/zen/v1", "opencode.ai/zen/go/v1");
	return url;
};
/**
* Base URL for Go quota requests: an explicit non-default config wins,
* otherwise a discovered gateway URL, otherwise the configured default.
*
* @param ctx - the plugin context used for discovery.
* @param configured - the row's `usageBaseURL` setting.
* @param targetProvider - optional specific provider route id to prioritize.
*/
const resolveGoBaseURL = (ctx, configured, targetProvider) => {
	if (configured.length > 0 && configured !== "https://opencode.ai/zen/go/v1") return configured;
	const discovered = discoverGoConfig(ctx, targetProvider);
	if (discovered.baseURL !== void 0 && discovered.baseURL.length > 0) return toGoBaseURL(discovered.baseURL);
	return configured;
};
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
const effectiveGoKeyRef = (discovered) => discovered.keyEnv ?? "OPENCODE_GO_API_KEY";
/**
* The lookup order each policy imposes — the only thing the user is choosing
* between.
*
* `auto` reproduces the original precedence exactly, so the default is not a
* behaviour change: composition first, then a captured key in the right tier,
* then credentials/env, then any captured key. `request` promotes both captured
* steps above the declared sources; `configured` does the reverse.
*
* Tier safety is orthogonal and applies to all three: a step that returns a key
* for the wrong tier is never consulted, because the Go endpoint rejects a Zen
* key outright.
*
* The store is appended to all three, and to none of them in the middle: the
* policy orders the sources the user declared, and the installation's store is
* never one of those.
*/
const KEY_SOURCE_ORDER = {
	auto: [
		"literal",
		"captured",
		"configured",
		"capturedAny",
		"opencodeStore"
	],
	configured: [
		"literal",
		"configured",
		"captured",
		"capturedAny",
		"opencodeStore"
	],
	request: [
		"captured",
		"capturedAny",
		"literal",
		"configured",
		"opencodeStore"
	]
};
/** First non-empty result from a policy's steps, or `undefined`. */
const firstResolved = async (order, steps) => {
	for (const step of order) {
		const value = await steps[step]();
		if (typeof value === "string" && value.length > 0) return value;
	}
};
/**
* The database path the installation itself would use.
*
* Resolved per call rather than cached, because the two facts it depends on —
* the ambient environment and the home directory — belong to the process at
* request time.
*
* @returns the path the store readers take, which may be `:memory:`.
*/
const opencodeStorePath = () => opencodeDatabasePath({
	channel: process.env.OPENCODE_CHANNEL,
	env: process.env,
	home: os.homedir()
}, os.tmpdir());
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
const resolveOpencodeStoreKey = (plane, enabled) => {
	if (!enabled || plane.length === 0) return;
	return readOpencodeCredentials(opencodeStorePath())?.find((entry) => entry.integrationId === plane)?.value;
};
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
const resolveGoApiKey = (ctx, targetProvider, policy = "auto", readOpencodeStore = false) => {
	const discovered = discoverGoConfig(ctx, targetProvider);
	return firstResolved(KEY_SOURCE_ORDER[policy], {
		captured: () => getCapturedApiKey(targetProvider, "go"),
		capturedAny: () => getCapturedApiKey(void 0, "go"),
		configured: () => resolveGoKeyForRef(ctx, effectiveGoKeyRef(discovered)),
		literal: () => discovered.literalKey,
		opencodeStore: () => resolveOpencodeStoreKey("opencode-go", readOpencodeStore)
	});
};
/**
* Resolve one credential reference through the credentials service, then the
* environment.
*
* Never throws: a failing credentials service degrades to the env path.
*
* @param ctx - the plugin context used for credentials.
* @param ref - credential reference to look up.
*/
const resolveRef = async (ctx, ref) => {
	const resolve = readCredentialsResolver(ctx);
	if (resolve !== void 0) try {
		const hit = await resolve(ref);
		if (hit?.value !== void 0 && hit.value.length > 0) return hit.value;
	} catch {}
	const fromEnv = process.env[ref];
	return fromEnv !== void 0 && fromEnv.length > 0 ? fromEnv : void 0;
};
/**
* Whether a resolved value is a usable credential for the Go quota endpoint.
*
* There is no prefix test here any more, and the reason is measured rather than
* argued. This used to reject `oc_sk_…` on the belief that "Zen keys lack the
* OpenCode Go subscription entitlement and will 403 when sent to the Go quota
* endpoint". Probed live on 2026-10-08: an `oc_sk_…` key stored as
* `OPENCODE_GO_API_KEY` answers `/zen/go/v1/usage` with **HTTP 200 and real
* windows** — OpenCode issues that prefix for Go credentials too, so the prefix
* does not name a tier.
*
* The cost of the old guard was not a wasted request; it was the ONE credential
* that worked being thrown away, after which the meter fell through to
* `capturedAny` (or to no key at all) and drew an overflow card with no quota
* anywhere on it. `usage.ts`'s `403 EntitlementError` branch is what handles a
* credential that genuinely lacks Go entitlement — the endpoint's own answer,
* rather than a guess about a string.
*/
const isUsableGoKey = (value) => value !== void 0 && value.length > 0 && !isPlaceholderApiKey(value);
/**
* Look one credential reference up for the Go quota endpoint.
*
* Zen keys (`OPENCODE_API_KEY` / `oc_sk_…`) are excluded because Zen keys lack
* the OpenCode Go subscription entitlement and will 403 when sent to the Go
* quota endpoint. That exclusion is why this is not just {@link resolveRef}: the
* routed-provider lookup below must accept a Zen key, because there the Zen tier
* is the target rather than a mistake.
*
* @param ctx - the plugin context used for credentials.
* @param ref - effective credential reference from {@link effectiveGoKeyRef}.
*/
const resolveGoKeyForRef = async (ctx, ref) => {
	const candidates = ref === "OPENCODE_API_KEY" || ref === "OPENCODE_GO_API_KEY" ? [DEFAULT_USAGE_KEY_ENV] : [ref, DEFAULT_USAGE_KEY_ENV];
	const resolve = readCredentialsResolver(ctx);
	if (resolve !== void 0) {
		const results = await Promise.allSettled(candidates.map((candidate) => resolve(candidate)));
		for (const result of results) {
			if (result.status !== "fulfilled") continue;
			const value = result.value?.value;
			if (isUsableGoKey(value)) return value;
		}
	}
	for (const candidate of candidates) {
		const value = process.env[candidate];
		if (isUsableGoKey(value)) return value;
	}
};
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
const resolveZenCreditInfo = async (ctx) => {
	const capturedZen = getCapturedApiKey("opencode", "zen");
	if (capturedZen !== void 0 && capturedZen.length > 0) return { isConfigured: true };
	return { isConfigured: await resolveRef(ctx, "OPENCODE_API_KEY") !== void 0 };
};
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
const resolveRoutedKey = async (ctx, provider, policy = "auto", readOpencodeStore = false) => {
	const discovered = discoverGoConfig(ctx, provider);
	const isGoRoute = provider === "opencode-go";
	const configuredRef = discovered.keyEnv ?? (isGoRoute ? "OPENCODE_GO_API_KEY" : "OPENCODE_API_KEY");
	const key = await firstResolved(KEY_SOURCE_ORDER[policy], {
		captured: () => getCapturedApiKey(provider, isGoRoute ? "go" : void 0),
		capturedAny: () => getCapturedApiKey(void 0, isGoRoute ? "go" : "zen"),
		configured: () => resolveRef(ctx, configuredRef),
		literal: () => discovered.literalKey,
		opencodeStore: () => resolveOpencodeStoreKey(isGoRoute ? "opencode-go" : "opencode", readOpencodeStore)
	});
	let tier = "unknown";
	if (isGoRoute || key !== void 0 && key.startsWith("sk-")) tier = "go";
	else if (provider === "opencode" || key !== void 0 && key.startsWith("oc_sk_")) tier = "zen";
	return {
		key,
		keyPrefix: key !== void 0 && key.length >= 10 ? key.slice(0, 10) : void 0,
		provider,
		tier
	};
};
/**
* The models a provider row DECLARES, read from the loader's configuration.
*
* **Credential-free, which is the point.** `ctx.llm.listModels(route)` resolves
* the route's credential first and answers `[]` when it cannot, so at boot — the
* ordinary case — a route that declares nineteen models reads as declaring none.
* Measured consequences, both from the same cause:
*
*   - no internal route was mounted for the plane;
*   - the composer's picker offered none of that route's models at all.
*
* The declaration itself needs no credential: it is the `models:` array the
* operator wrote, in the loader entry's config — the same shape
* {@link discoverGoConfig} already walks.
*
* `ctx.get` first, because `ctx.loader` throws without the name in `inject`; the
* property is the guarded fallback for a context that serves only that.
*
* @param ctx - the host context.
* @param route - the provider route id (`opencode`, `opencode-go`, ...).
* @returns the declared entries, or `undefined` when the loader holds no row for
*   that route — "cannot read" and "declares nothing" must stay distinguishable.
*/
const declaredProviderModels = (ctx, route) => {
	if (!isRecord(ctx)) return;
	let loader;
	const { get } = ctx;
	if (typeof get === "function") try {
		loader = Reflect.apply(get, ctx, ["loader"]);
	} catch {
		loader = void 0;
	}
	if (loader === void 0) try {
		const { loader: viaProperty } = ctx;
		loader = viaProperty;
	} catch {
		return;
	}
	if (!isRecord(loader) || typeof loader.entries !== "function") return;
	let entries;
	try {
		entries = Reflect.apply(loader.entries, loader, []);
	} catch {
		return;
	}
	if (entries === null || typeof entries !== "object") return;
	if (typeof entries[Symbol.iterator] !== "function") return;
	const declared = [];
	let found = false;
	for (const entry of entries) {
		if (!isRecord(entry) || !isRecord(entry.options)) continue;
		const config = entry.options.config;
		if (!isRecord(config) || !isRecord(config.providers)) continue;
		const provider = config.providers[route];
		if (!isRecord(provider)) continue;
		found = true;
		const models = provider.models;
		if (!Array.isArray(models)) continue;
		for (const model of models) {
			if (!isRecord(model) || typeof model.id !== "string") continue;
			if (model.id.length === 0) continue;
			declared.push({
				id: model.id,
				...typeof model.name === "string" && model.name.length > 0 ? { name: model.name } : {}
			});
		}
	}
	return found ? declared : void 0;
};
//#endregion
//#region src/catalog-data.ts
/**
* The endpoint each plane's provider declares, read from the catalog rather than
* assumed - the field the client itself consumes (`models-dev.ts:107`), so the
* mount can read this instead of hard-coding a family.
*/
const OPENCODE_PLANE_API = {
	go: "https://opencode.ai/inference/go/openai/v1",
	zen: "https://opencode.ai/inference/openai/v1"
};
/**
* The endpoint each wire family declares, per plane, keyed by the SDK package the
* catalog names for that family (`""` is the provider's own default).
*
* GENERATED by `scripts/regenerate-catalog-shim.ts` — never hand-edit. The
* provider-level `OPENCODE_PLANE_API` above is the default family's address only;
* anthropic and google are served at their own paths, and this is where that is
* recorded.
*/
const OPENCODE_FAMILY_API = {
	go: {
		"": "https://opencode.ai/inference/go/openai/v1",
		"@ai-sdk/anthropic": "https://opencode.ai/inference/go/anthropic/v1",
		"@ai-sdk/google": "https://opencode.ai/inference/go/google/v1beta",
		"@ai-sdk/openai": "https://opencode.ai/inference/go/openai/v1"
	},
	zen: {
		"": "https://opencode.ai/inference/openai/v1",
		"@ai-sdk/anthropic": "https://opencode.ai/inference/anthropic/v1",
		"@ai-sdk/google": "https://opencode.ai/inference/google/v1beta",
		"@ai-sdk/mistral": "https://opencode.ai/inference/openai/v1",
		"@ai-sdk/openai": "https://opencode.ai/inference/openai/v1"
	}
};
const OPENCODE_GO_CATALOG = [
	{
		context_window: 1048576,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "beam-free",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 131072,
		name: "Beam Free",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .01,
			cache_write: .125,
			input: .1,
			output: .5
		},
		id: "claude-haiku-5-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Haiku 5.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .022,
			input: .66,
			output: 1.98
		},
		id: "deepseek-v4-pro",
		input_modalities: ["text"],
		max_output_tokens: 384e3,
		name: "DeepSeek V4 Pro (New)",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["high", "max"]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .003,
			input: .15,
			output: .6
		},
		id: "deepseek-v4.1-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 384e3,
		name: "DeepSeek V4.1 Flash",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .2,
			input: 4,
			output: 20
		},
		id: "gemini-4-argon-contributor",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 4 Argon Contributor",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .26,
			input: 1.4,
			output: 4.4
		},
		id: "glm-5.2",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5.2",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["high", "max"]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .26,
			input: 1.4,
			output: 4.4
		},
		id: "glm-5.3",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5.3",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .03,
			input: .15,
			output: .5
		},
		id: "glm-5.3-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "GLM-5.3-Flash",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .02,
			cache_write: .25,
			input: .2,
			output: 1.2
		},
		id: "gpt-5.6-luna",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.6 Luna",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .01,
			cache_write: .125,
			input: .1,
			output: .5
		},
		id: "gpt-6-luna",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-6 Luna",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 5e5,
		cost: {
			cache_read: .5,
			input: 2,
			output: 6
		},
		id: "grok-4.7",
		input_modalities: ["text", "image"],
		max_output_tokens: 5e5,
		name: "Grok 4.7",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 256e3,
		cost: {
			cache_read: .035,
			input: .14,
			output: .58
		},
		id: "hy3",
		input_modalities: ["text"],
		max_output_tokens: 128e3,
		name: "Hy3",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"high"
			]
		}]
	},
	{
		context_window: 1024e3,
		cost: {
			cache_read: .042,
			input: .834,
			output: 2.501
		},
		id: "hy4-preview",
		input_modalities: ["text"],
		max_output_tokens: 64e3,
		name: "Hy4 preview",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["none", "high"]
		}]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .19,
			input: .95,
			output: 4
		},
		id: "kimi-k2.7-code",
		input_modalities: ["text", "image"],
		max_output_tokens: 262144,
		name: "Kimi K2.7 Code",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .3,
			input: 3,
			output: 15
		},
		id: "kimi-k3",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Kimi K3",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["max"]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .006,
			input: .3,
			output: 1.2
		},
		id: "longcat-2.0",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "LongCat-2.0",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .0028,
			input: .14,
			output: .28
		},
		id: "mimo-v2.5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "MiMo V2.5",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .003625,
			input: .435,
			output: .87
		},
		id: "mimo-v2.5-pro",
		input_modalities: ["text"],
		max_output_tokens: 128e3,
		name: "MiMo V2.5 Pro",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .0028,
			input: .14,
			output: .28
		},
		id: "mimo-v2.6-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "MiMo-V2.6-Flash",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .003625,
			input: .435,
			output: .87
		},
		id: "mimo-v2.6-pro",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "MiMo-V2.6-Pro",
		reasoning: true
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .06,
			input: .3,
			output: 1.2
		},
		id: "minimax-m3",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "MiniMax-M3",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .015,
			input: .15,
			output: .6
		},
		id: "minimax-m3.1-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 512e3,
		name: "MiniMax M3.1 Flash",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .002,
			input: .1,
			output: .2
		},
		id: "muse-spark-1.2-contributor",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Muse Spark 1.2 Contributor",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .002,
			input: .1,
			output: .2
		},
		id: "muse-spark-1.3-contributor",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Muse Spark 1.3 Contributor",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .04,
			cache_write: .5,
			input: .4,
			output: 1.6
		},
		id: "qwen3.7-plus",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Qwen3.7 Plus",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, { type: "budget_tokens" }]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .016,
			cache_write: .2,
			input: .15,
			output: .47
		},
		id: "qwen3.8-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Qwen3.8 Flash",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [
			{ type: "toggle" },
			{
				type: "effort",
				values: [
					"low",
					"medium",
					"xhigh"
				]
			},
			{ type: "budget_tokens" }
		]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .25,
			cache_write: 2.5,
			input: 2,
			output: 6
		},
		id: "qwen3.8-max",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Qwen3.8 Max",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [
			{ type: "toggle" },
			{
				type: "effort",
				values: [
					"low",
					"medium",
					"xhigh"
				]
			},
			{ type: "budget_tokens" }
		]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .1,
			input: 1,
			output: 2.7
		},
		id: "step-5-preview",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Step 5 Preview",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	}
];
/** Complete catalog of OpenCode Zen models (free tier & flagships) from models.dev. */
const OPENCODE_ZEN_CATALOG = [
	{
		context_window: 1048576,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "beam-free",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 131072,
		name: "Beam Free",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: 0,
			cache_write: 0,
			input: 0,
			output: 0
		},
		id: "big-pickle",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 32e3,
		name: "Big Pickle",
		reasoning: true
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: 1,
			cache_write: 12.5,
			input: 10,
			output: 50
		},
		id: "claude-fable-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Fable 5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .25,
			cache_write: 12.5,
			input: 10,
			output: 50
		},
		id: "claude-fable-5-1",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Fable 5.1",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: .1,
			cache_write: 1.25,
			input: 1,
			output: 5
		},
		id: "claude-haiku-4-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 64e3,
		name: "Claude Haiku 4.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			min: 1024,
			type: "budget_tokens"
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .01,
			cache_write: .125,
			input: .1,
			output: .5
		},
		id: "claude-haiku-5-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Haiku 5.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: .5,
			cache_write: 6.25,
			input: 5,
			output: 25
		},
		id: "claude-opus-4-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 64e3,
		name: "Claude Opus 4.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}, {
			min: 1024,
			type: "budget_tokens"
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .5,
			cache_write: 6.25,
			input: 5,
			output: 25
		},
		id: "claude-opus-4-6",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Opus 4.6",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"max"
			]
		}, {
			min: 1024,
			type: "budget_tokens"
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .5,
			cache_write: 6.25,
			input: 5,
			output: 25
		},
		id: "claude-opus-4-7",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Opus 4.7",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .5,
			cache_write: 6.25,
			input: 5,
			output: 25
		},
		id: "claude-opus-4-8",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Opus 4.8",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .5,
			cache_write: 6.25,
			input: 5,
			output: 25
		},
		id: "claude-opus-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Opus 5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .2,
			cache_write: 5,
			input: 4,
			output: 20
		},
		id: "claude-opus-5-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Opus 5.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .3,
			cache_write: 3.75,
			input: 3,
			output: 15
		},
		id: "claude-sonnet-4-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 64e3,
		name: "Claude Sonnet 4.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			min: 1024,
			type: "budget_tokens"
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .3,
			cache_write: 3.75,
			input: 3,
			output: 15
		},
		id: "claude-sonnet-4-6",
		input_modalities: ["text", "image"],
		max_output_tokens: 64e3,
		name: "Claude Sonnet 4.6",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"max"
			]
		}, {
			min: 1024,
			type: "budget_tokens"
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .2,
			cache_write: 2.5,
			input: 2,
			output: 10
		},
		id: "claude-sonnet-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Sonnet 5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .2,
			cache_write: 2.5,
			input: 2,
			output: 10
		},
		id: "claude-sonnet-5-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "Claude Sonnet 5.5",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .028,
			input: .14,
			output: .28
		},
		id: "deepseek-v4-flash",
		input_modalities: ["text"],
		max_output_tokens: 384e3,
		name: "DeepSeek V4 Flash",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .145,
			input: 1.74,
			output: 3.48
		},
		id: "deepseek-v4-pro",
		input_modalities: ["text"],
		max_output_tokens: 384e3,
		name: "DeepSeek V4 Pro",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: ["high", "max"]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .006,
			input: .3,
			output: 1.2
		},
		id: "deepseek-v4.1-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 384e3,
		name: "DeepSeek V4.1 Flash",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "deepseek-v4.1-flash-free",
		input_modalities: ["text", "image"],
		is_free: true,
		max_output_tokens: 32e3,
		name: "DeepSeek V4.1 Flash Free",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "flint-40b-free",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 65536,
		name: "Flint 40B Free",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .05,
			input: .5,
			output: 3
		},
		id: "gemini-3-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3 Flash",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .2,
			input: 2,
			output: 12
		},
		id: "gemini-3.1-pro",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.1 Pro Preview",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.5,
			output: 9
		},
		id: "gemini-3.5-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.5 Flash",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .03,
			input: .3,
			output: 2.5
		},
		id: "gemini-3.5-flash-lite",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.5 Flash Lite",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.5,
			output: 7.5
		},
		id: "gemini-3.6-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.6 Flash",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.5,
			output: 7.5
		},
		id: "gemini-3.7-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.7 Flash",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.5,
			output: 7.5
		},
		id: "gemini-3.8-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 3.8 Flash",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .1,
			input: 2,
			output: 10
		},
		id: "gemini-4-argon",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Gemini 4 Argon",
		provider_npm: "@ai-sdk/google",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 204800,
		cost: {
			cache_read: .2,
			input: 1,
			output: 3.2
		},
		id: "glm-5",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 204800,
		cost: {
			cache_read: .26,
			input: 1.4,
			output: 4.4
		},
		id: "glm-5.1",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5.1",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .26,
			input: 1.4,
			output: 4.4
		},
		id: "glm-5.2",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5.2",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["high", "max"]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .26,
			input: 1.4,
			output: 4.4
		},
		id: "glm-5.3",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "GLM-5.3",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .03,
			input: .15,
			output: .5
		},
		id: "glm-5.3-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "GLM-5.3-Flash",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "glm-5.3-flash-free",
		input_modalities: ["text", "image"],
		is_free: true,
		max_output_tokens: 32e3,
		name: "GLM-5.3-Flash Free",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .107,
			input: 1.07,
			output: 8.5
		},
		id: "gpt-5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .107,
			input: 1.07,
			output: 8.5
		},
		id: "gpt-5-codex",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5 Codex",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .005,
			input: .05,
			output: .4
		},
		id: "gpt-5-nano",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5 Nano",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .107,
			input: 1.07,
			output: 8.5
		},
		id: "gpt-5.1",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.1",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .107,
			input: 1.07,
			output: 8.5
		},
		id: "gpt-5.1-codex",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.1 Codex",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .125,
			input: 1.25,
			output: 10
		},
		id: "gpt-5.1-codex-max",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.1 Codex Max",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .025,
			input: .25,
			output: 2
		},
		id: "gpt-5.1-codex-mini",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.1 Codex Mini",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .175,
			input: 1.75,
			output: 14
		},
		id: "gpt-5.2",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.2",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .175,
			input: 1.75,
			output: 14
		},
		id: "gpt-5.2-codex",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.2 Codex",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .175,
			input: 1.75,
			output: 14
		},
		id: "gpt-5.3-codex",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.3 Codex",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 128e3,
		cost: {
			cache_read: .175,
			input: 1.75,
			output: 14
		},
		id: "gpt-5.3-codex-spark",
		input_modalities: ["text"],
		max_output_tokens: 128e3,
		name: "GPT-5.3 Codex Spark",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .25,
			input: 2.5,
			output: 15
		},
		id: "gpt-5.4",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.4",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .075,
			input: .75,
			output: 4.5
		},
		id: "gpt-5.4-mini",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.4 Mini",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 4e5,
		cost: {
			cache_read: .02,
			input: .2,
			output: 1.25
		},
		id: "gpt-5.4-nano",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.4 Nano",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: 30,
			input: 30,
			output: 180
		},
		id: "gpt-5.4-pro",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.4 Pro",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .5,
			input: 5,
			output: 30
		},
		id: "gpt-5.5",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.5",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: 30,
			input: 30,
			output: 180
		},
		id: "gpt-5.5-pro",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.5 Pro",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .02,
			cache_write: .25,
			input: .2,
			output: 1.2
		},
		id: "gpt-5.6-luna",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.6 Luna",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .4,
			cache_write: 5,
			input: 4,
			output: 20
		},
		id: "gpt-5.6-sol",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.6 Sol",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .2,
			cache_write: 2.5,
			input: 2,
			output: 12
		},
		id: "gpt-5.6-terra",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-5.6 Terra",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: 1,
			cache_write: 12.5,
			input: 10,
			output: 50
		},
		id: "gpt-6-astra",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-6 Astra",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .01,
			cache_write: .125,
			input: .1,
			output: .5
		},
		id: "gpt-6-luna",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-6 Luna",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .2,
			cache_write: 2.5,
			input: 2,
			output: 10
		},
		id: "gpt-6-sol",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-6 Sol",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 105e4,
		cost: {
			cache_read: .1,
			cache_write: 2.5,
			input: 2,
			output: 10
		},
		id: "gpt-6.1-sol",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "GPT-6.1 Sol",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 5e5,
		cost: {
			cache_read: .3,
			input: 2,
			output: 6
		},
		id: "grok-4.5",
		input_modalities: ["text", "image"],
		max_output_tokens: 5e5,
		name: "Grok 4.5",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high"
			]
		}]
	},
	{
		context_window: 5e5,
		cost: {
			cache_read: .5,
			input: 2,
			output: 6
		},
		id: "grok-4.6",
		input_modalities: ["text", "image"],
		max_output_tokens: 5e5,
		name: "Grok 4.6",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 5e5,
		cost: {
			cache_read: .5,
			input: 2,
			output: 6
		},
		id: "grok-4.7",
		input_modalities: ["text", "image"],
		max_output_tokens: 5e5,
		name: "Grok 4.7",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 256e3,
		cost: {
			cache_read: .2,
			input: 1,
			output: 2
		},
		id: "grok-build-0.1",
		input_modalities: ["text", "image"],
		max_output_tokens: 256e3,
		name: "Grok Build 0.1",
		provider_npm: "@ai-sdk/openai",
		reasoning: true
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .1,
			input: .6,
			output: 3
		},
		id: "kimi-k2.5",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Kimi K2.5",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .16,
			input: .95,
			output: 4
		},
		id: "kimi-k2.6",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Kimi K2.6",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .19,
			input: .95,
			output: 4
		},
		id: "kimi-k2.7-code",
		input_modalities: ["text", "image"],
		max_output_tokens: 262144,
		name: "Kimi K2.7 Code",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .3,
			input: 3,
			output: 15
		},
		id: "kimi-k3",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Kimi K3",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, {
			type: "effort",
			values: [
				"low",
				"high",
				"max"
			]
		}]
	},
	{
		context_window: 2e5,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "mimo-v2.6-flash-free",
		input_modalities: ["text", "image"],
		is_free: true,
		max_output_tokens: 32e3,
		name: "MiMo-V2.6-Flash Free",
		reasoning: true
	},
	{
		context_window: 204800,
		cost: {
			cache_read: .06,
			input: .3,
			output: 1.2
		},
		id: "minimax-m2.5",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "MiniMax-M2.5",
		reasoning: true
	},
	{
		context_window: 204800,
		cost: {
			cache_read: .06,
			input: .3,
			output: 1.2
		},
		id: "minimax-m2.7",
		input_modalities: ["text"],
		max_output_tokens: 131072,
		name: "MiniMax-M2.7",
		reasoning: true
	},
	{
		context_window: 512e3,
		cost: {
			cache_read: .06,
			input: .3,
			output: 1.2
		},
		id: "minimax-m3",
		input_modalities: ["text", "image"],
		max_output_tokens: 128e3,
		name: "MiniMax-M3",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }]
	},
	{
		context_window: 524288,
		cost: {
			cache_read: .07,
			input: .68,
			output: 2.09
		},
		id: "mistral-large-4",
		input_modalities: ["text", "image"],
		max_output_tokens: 262144,
		name: "Mistral Large 4",
		provider_npm: "@ai-sdk/mistral",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: ["none", "high"]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.25,
			output: 4.25
		},
		id: "muse-spark-1.2",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Muse Spark 1.2",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .15,
			input: 1.25,
			output: 4.25
		},
		id: "muse-spark-1.3",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Muse Spark 1.3",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: .2,
			input: 4,
			output: 20
		},
		id: "muse-wonder-1.0",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Muse Wonder",
		provider_npm: "@ai-sdk/openai",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh",
				"max"
			]
		}]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "nemotron-3-ultra-free",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 128e3,
		name: "Nemotron 3 Ultra Free",
		reasoning: true
	},
	{
		context_window: 262144,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "nemotron-3.5-lightning-free",
		input_modalities: ["text"],
		is_free: true,
		max_output_tokens: 262144,
		name: "Nemotron 3.5 Lightning Free",
		reasoning: true
	},
	{
		context_window: 1048576,
		cost: {
			cache_read: 0,
			input: 0,
			output: 0
		},
		id: "nemotron-3.5-super-vl-free",
		input_modalities: ["text", "image"],
		is_free: true,
		max_output_tokens: 131072,
		name: "Nemotron 3.5 Super VL Free",
		reasoning: true,
		reasoning_options: [{
			type: "effort",
			values: [
				"none",
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh"
			]
		}]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .02,
			cache_write: .25,
			input: .2,
			output: 1.2
		},
		id: "qwen3.5-plus",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Qwen3.5 Plus",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, { type: "budget_tokens" }]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .05,
			cache_write: .625,
			input: .5,
			output: 3
		},
		id: "qwen3.6-plus",
		input_modalities: ["text", "image"],
		max_output_tokens: 65536,
		name: "Qwen3.6 Plus",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [{ type: "toggle" }, { type: "budget_tokens" }]
	},
	{
		context_window: 1e6,
		cost: {
			cache_read: .016,
			cache_write: .2,
			input: .15,
			output: .47
		},
		id: "qwen3.8-flash",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Qwen3.8 Flash",
		provider_npm: "@ai-sdk/anthropic",
		reasoning: true,
		reasoning_options: [
			{ type: "toggle" },
			{
				type: "effort",
				values: [
					"low",
					"medium",
					"xhigh"
				]
			},
			{ type: "budget_tokens" }
		]
	},
	{
		context_window: 262144,
		cost: {
			cache_read: .25,
			cache_write: 2.5,
			input: 2,
			output: 6
		},
		id: "qwen3.8-max",
		input_modalities: ["text", "image"],
		max_output_tokens: 131072,
		name: "Qwen3.8 Max",
		reasoning: true,
		reasoning_options: [
			{ type: "toggle" },
			{
				type: "effort",
				values: [
					"low",
					"medium",
					"xhigh"
				]
			},
			{
				min: 1024,
				type: "budget_tokens"
			}
		]
	}
];
//#endregion
//#region src/models-catalog.ts
/**
* Authoritative OpenCode Go & Zen model catalog and gateway model list enrichment.
*
* The raw OpenCode Go `/models` gateway endpoint frequently returns an incomplete
* or truncated list of model IDs without display names, context windows, max
* tokens, or input modalities.
*
* This module maintains the canonical catalog (sourced from
* `models.opencode.ai/api.json`) and intercepts `GET .../models` gateway
* responses to ensure that all models are present, fully described, and
* available for DSH model discovery.
*
* @module dsh-opencode-patch/models-catalog
*/
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
const MODELS_OPENCODE_URL = "https://models.opencode.ai/api.json";
/**
* The same registry under its public name, `models.dev`.
*
* Exported for callers that want the human-facing URL (documentation links, a
* health probe). It is NOT what {@link refreshCatalog} fetches, and it need not
* stay in step with {@link MODELS_OPENCODE_URL}: if the two ever diverge, the
* OpenCode host wins, because that is the one the plugin reads.
*/
const MODELS_DEV_URL = "https://models.dev/api.json";
/**
* Modalities supported by DeepSeek Harness model configuration schemas.
* DSH strictly accepts ("text" | "image")[], rejecting "video", "audio", "pdf".
*/
const DSH_SUPPORTED_MODALITIES = /* @__PURE__ */ new Set(["text", "image"]);
/**
* Sanitize an input modalities list to match the DSH schema ("text" | "image").
* Drops "video", "audio", "pdf", and defaults to ["text"] if empty.
*/
const sanitizeModalities = (modalities) => {
	if (!Array.isArray(modalities)) return ["text"];
	const filtered = modalities.filter((m) => typeof m === "string" && DSH_SUPPORTED_MODALITIES.has(m));
	return filtered.length > 0 ? filtered : ["text"];
};
/** TTL for cached models before triggering a background revalidation (60 minutes). */
const CATALOG_REVALIDATION_TTL_MS = 36e5;
/**
* What an enriched row falls back to when neither the live row nor the catalog
* describes the model. Matches the shim's own defaults, so a model that reaches
* the picker before either source knows it is still fully described.
*/
const FALLBACK_CONTEXT_WINDOW = 1e6;
/** @see FALLBACK_CONTEXT_WINDOW */
const FALLBACK_MAX_OUTPUT_TOKENS = 131072;
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
const MODELS_DEV_TIMEOUT_MS = 3e4;
let activeGoCatalog = new Map(OPENCODE_GO_CATALOG.map((m) => [m.id, m]));
let activeZenCatalog = new Map(OPENCODE_ZEN_CATALOG.map((m) => [m.id, m]));
/**
* Ids the most recent parse saw as `status: "deprecated"`, per plane.
*
* Kept beside the active maps because the ADAPTER's own discovery needs it:
* `mergeDiscoveredModels` merges adapter rows before catalog rows, and pi's
* installed snapshot still carries ids the live catalog has retired. Dropping
* them from our catalog alone is not enough — the merge puts them back.
*/
const deprecatedGoIds = /* @__PURE__ */ new Set();
const deprecatedZenIds = /* @__PURE__ */ new Set();
let lastRefreshedAt = 0;
/**
* Whether the MOST RECENT refresh attempt read a usable payload.
*
* Distinct from {@link lastRefreshedAt}, which only advances on success and so
* answers "has this process ever refreshed?" — a question that stays `true` for
* hours after a failure. A caller that must know whether THIS attempt landed
* (the purge, which reports "nothing was deprecated" versus "the catalog could
* not be read") needs this one.
*/
let lastRefreshSucceeded = false;
let refreshPromise;
/** The endpoint a provider entry declares, or `""` when it declares none. */
const providerApiFor = (entry) => isRecord(entry) && typeof entry.api === "string" ? entry.api : "";
/**
* Each wire family's endpoint, keyed by the SDK package that names it.
*
* A model's own `provider.api` wins; otherwise it inherits the provider's. The
* first value seen for a package is kept — the vendor declares one endpoint per
* family, and a second value would mean the assumption is wrong rather than that
* the first should be replaced.
*
* **The keys come out SORTED, and that is load-bearing.** The map is built from
* the order the vendor's JSON happens to list its models in, and that order is
* not stable: the catalog re-serializes on its own schedule, and the same data
* arrives with its models in a different sequence. The map is written verbatim
* into the generated shim, so an unstable order means the nightly freshness job
* finds a diff that contains no change at all — which is how a pull request
* arrived whose entire content was three lines of key order.
*
* Sorting here fixes it at the source: the parser, the shim and the runtime
* refresh all read the same map, so one rule governs all three. The values are
* untouched; only the order is decided rather than inherited.
*
* @param entry - one provider entry from the catalog.
* @returns the family map, empty when the entry carries no models.
*/
const familyApiFor = (entry) => {
	const found = /* @__PURE__ */ new Map();
	if (!isRecord(entry) || !isRecord(entry.models)) return {};
	const providerApi = providerApiFor(entry);
	for (const rawModel of Object.values(entry.models)) {
		if (!isRecord(rawModel)) continue;
		const provider = isRecord(rawModel.provider) ? rawModel.provider : {};
		const npm = typeof provider.npm === "string" ? provider.npm : "";
		const api = typeof provider.api === "string" ? provider.api : providerApi;
		if (api.length > 0 && !found.has(npm)) found.set(npm, api);
	}
	const out = {};
	for (const key of [...found.keys()].toSorted()) out[key] = found.get(key) ?? "";
	return out;
};
/**
* The thinking options a model declares, with unknown shapes dropped.
*
* A `type` is required because the options are discriminated by it; `values` and
* `min` are optional and only carried when they are the right kind. An entry
* that is not an object, or has no string `type`, is skipped rather than
* repaired.
*
* @param raw - `models.dev`'s `reasoning_options`.
* @returns the options, or `undefined` when there are none to carry.
*/
const sanitizeReasoningOptions = (raw) => {
	if (!Array.isArray(raw)) return;
	const out = [];
	for (const entry of raw) {
		if (!isRecord(entry) || typeof entry.type !== "string") continue;
		const values = Array.isArray(entry.values) ? entry.values.filter((v) => typeof v === "string") : void 0;
		const min = typeof entry.min === "number" ? entry.min : void 0;
		out.push({
			...min === void 0 ? {} : { min },
			type: entry.type,
			...values === void 0 ? {} : { values }
		});
	}
	return out.length === 0 ? void 0 : out;
};
const extractSpecs = (modelsObj, defaultContext = 1e6, deprecated) => {
	const results = [];
	for (const [id, rawModel] of Object.entries(modelsObj)) {
		if (!isRecord(rawModel)) continue;
		if (rawModel.status === "deprecated") {
			deprecated?.add(id);
			continue;
		}
		const name = typeof rawModel.name === "string" && rawModel.name.length > 0 ? rawModel.name : id;
		const limit = isRecord(rawModel.limit) ? rawModel.limit : void 0;
		const context_window = typeof limit?.context === "number" && limit.context > 0 ? limit.context : defaultContext;
		const max_output_tokens = typeof limit?.output === "number" && limit.output > 0 ? limit.output : 131072;
		const modalities = isRecord(rawModel.modalities) ? rawModel.modalities : void 0;
		const input_modalities = sanitizeModalities(modalities?.input);
		const costRaw = isRecord(rawModel.cost) ? rawModel.cost : void 0;
		let cost;
		if (costRaw !== void 0) {
			const input = typeof costRaw.input === "number" ? costRaw.input : 0;
			const output = typeof costRaw.output === "number" ? costRaw.output : 0;
			const cache_read = typeof costRaw.cache_read === "number" ? costRaw.cache_read : void 0;
			const cache_write = typeof costRaw.cache_write === "number" ? costRaw.cache_write : void 0;
			cost = {
				input,
				output,
				...cache_read === void 0 ? {} : { cache_read },
				...cache_write === void 0 ? {} : { cache_write }
			};
		}
		const is_free = id.includes("free") || cost?.input === 0 && cost?.output === 0;
		const reasoning = typeof rawModel.reasoning === "boolean" ? rawModel.reasoning : void 0;
		const reasoning_options = sanitizeReasoningOptions(rawModel.reasoning_options);
		const provider = isRecord(rawModel.provider) ? rawModel.provider : void 0;
		const provider_npm = typeof provider?.npm === "string" && provider.npm.length > 0 ? provider.npm : void 0;
		results.push({
			context_window,
			...cost === void 0 ? {} : { cost },
			id,
			input_modalities: input_modalities.length > 0 ? input_modalities : ["text"],
			...is_free ? { is_free: true } : {},
			max_output_tokens,
			name,
			...provider_npm === void 0 ? {} : { provider_npm },
			...reasoning === void 0 ? {} : { reasoning },
			...reasoning_options === void 0 ? {} : { reasoning_options }
		});
	}
	return results;
};
/**
* The plane a route's models come from.
*
* `opencode-go` is the subscription plane; everything else this plugin knows
* about (`opencode`, and the internal routes derived from it) is Zen.
*/
const catalogPlaneForRoute = (route) => route === "opencode-go" || typeof route === "string" && route.startsWith("opencode-go-") ? "go" : "zen";
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
const findModelSpecOn = (plane, modelId) => plane === "go" ? activeGoCatalog.get(modelId) : activeZenCatalog.get(modelId);
/**
* Look up model specifications and pricing rates by model ID, preferring the Go
* plane.
*
* Correct for "does either plane know this model" — pricing and limits, which
* agree across the planes for every shared id. **Not** correct for routing: see
* {@link findModelSpecOn}. Anywhere the answer decides which ENDPOINT serves a
* model, the plane has to come from the route in play.
*/
const findModelSpec = (modelId) => activeGoCatalog.get(modelId) ?? activeZenCatalog.get(modelId);
/**
* Safely parse raw models.dev JSON data for both opencode-go and opencode providers.
*
* @param data - raw parsed JSON from `https://models.dev/api.json`
* @returns extracted model specifications for both Go and Zen
*/
const parseModelsDevCatalog = (data) => {
	if (!isRecord(data)) return {
		api: {
			go: "",
			zen: ""
		},
		familyApi: {
			go: {},
			zen: {}
		},
		go: [],
		zen: []
	};
	const goObj = isRecord(data["opencode-go"]) && isRecord(data["opencode-go"].models) ? data["opencode-go"].models : {};
	const zenObj = isRecord(data.opencode) && isRecord(data.opencode.models) ? data.opencode.models : {};
	deprecatedGoIds.clear();
	deprecatedZenIds.clear();
	return {
		api: {
			go: providerApiFor(data["opencode-go"]),
			zen: providerApiFor(data.opencode)
		},
		familyApi: {
			go: familyApiFor(data["opencode-go"]),
			zen: familyApiFor(data.opencode)
		},
		go: extractSpecs(goObj, 1e6, deprecatedGoIds),
		zen: extractSpecs(zenObj, 1e6, deprecatedZenIds)
	};
};
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
const isDeprecatedModelOn = (plane, id) => (plane === "go" ? deprecatedGoIds : deprecatedZenIds).has(id);
/**
* Whether the most recent refresh attempt actually read the registry.
*
* Set to `false` when an attempt starts and only `true` by a payload that
* parsed, so a caller can distinguish "the catalog says none are deprecated"
* from "the catalog could not be read" — the two produce the same empty result
* and must not produce the same sentence.
*
* `refreshCatalog` never rejects, so its promise resolving says nothing about
* whether the read landed; this is the only way to tell.
*
* @returns whether the last attempt read a usable payload.
*/
const didCatalogRefreshSucceed = () => lastRefreshSucceeded;
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
const refreshCatalog = (fetchFn = globalThis.fetch, force = false) => {
	if (!force && lastRefreshedAt > 0 && Date.now() - lastRefreshedAt < 36e5) return Promise.resolve({
		go: [...activeGoCatalog.values()],
		zen: [...activeZenCatalog.values()]
	});
	if (!force && refreshPromise !== void 0) return refreshPromise;
	refreshPromise = (async () => {
		lastRefreshSucceeded = false;
		try {
			const response = await fetchFn(MODELS_OPENCODE_URL, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS)
			});
			if (response.ok) {
				const json = await response.json();
				const parsed = parseModelsDevCatalog(json);
				if (parsed.go.length > 0) {
					const nextGo = new Map(activeGoCatalog);
					for (const model of parsed.go) nextGo.set(model.id, model);
					activeGoCatalog = nextGo;
				}
				if (parsed.zen.length > 0) {
					const nextZen = new Map(activeZenCatalog);
					for (const model of parsed.zen) nextZen.set(model.id, model);
					activeZenCatalog = nextZen;
				}
				if (parsed.go.length > 0 || parsed.zen.length > 0) {
					lastRefreshedAt = Date.now();
					lastRefreshSucceeded = true;
				}
			}
		} catch {} finally {
			refreshPromise = void 0;
		}
		return {
			go: [...activeGoCatalog.values()],
			zen: [...activeZenCatalog.values()]
		};
	})();
	return refreshPromise;
};
const triggerBackgroundRefresh = async (fetchFn) => {
	try {
		await refreshCatalog(fetchFn);
	} catch {}
};
/**
* Serve one catalog map immediately (non-blocking), kicking off a background
* SWR revalidation when it is stale.
*
* Both providers share a single freshness clock: `lastRefreshedAt` is only
* advanced by a refresh that returned something for at least one provider, so
* an offline start keeps retrying on every read until the first success.
*
* @param catalog - the active map to snapshot.
* @param fetchFn - fetch implementation used for the background refresh.
*/
const readLiveCatalog = (catalog, fetchFn) => {
	if (lastRefreshedAt === 0 || Date.now() - lastRefreshedAt >= 36e5) triggerBackgroundRefresh(fetchFn);
	return [...catalog.values()];
};
/**
* Return the current Go catalog immediately, triggering SWR revalidation if stale.
*
* @param fetchFn - fetch implementation to use for background refresh
*/
const getLiveGoCatalog = (fetchFn = globalThis.fetch) => readLiveCatalog(activeGoCatalog, fetchFn);
/**
* Return the current Zen catalog immediately, triggering SWR revalidation if stale.
*
* @param fetchFn - fetch implementation to use for background refresh
*/
const getLiveZenCatalog = (fetchFn = globalThis.fetch) => readLiveCatalog(activeZenCatalog, fetchFn);
/** Legacy alias for getLiveGoCatalog. */
const getLiveCatalog = getLiveGoCatalog;
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
const isModelsListingUrl = (url, gatewayUrls = DEFAULT_GATEWAY_URLS) => {
	if (!gatewayUrls.some((marker) => marker.length > 0 && url.includes(marker))) return false;
	return url.endsWith("/models") || url.includes("/models?");
};
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
const isGoModelsListingUrl = (url, gatewayUrls) => isModelsListingUrl(url, gatewayUrls) && isGoPlaneUrl(url);
/**
* Merge and enrich a gateway `/models` response with the complete OpenCode Go or Zen catalog.
*
* @param url - the request URL
* @param response - the upstream fetch Response
* @param fetchFn - optional fetch implementation for SWR background refresh
* @returns an enriched Response with all models and complete metadata
*/
const enrichModelsResponse = async (url, response, fetchFn = globalThis.fetch) => {
	let existingData = [];
	try {
		const raw = await response.clone().json();
		if (isRecord(raw) && Array.isArray(raw.data)) existingData = raw.data.filter(isRecord);
	} catch {}
	const catalog = isGoModelsListingUrl(url) ? getLiveGoCatalog(fetchFn) : getLiveZenCatalog(fetchFn);
	const catalogById = new Map(catalog.map((m) => [m.id, m]));
	const merged = /* @__PURE__ */ new Map();
	for (const spec of catalog) {
		const input_modalities = sanitizeModalities(spec.input_modalities);
		merged.set(spec.id, {
			context_window: spec.context_window,
			created: 1727740800,
			id: spec.id,
			input: input_modalities,
			input_modalities,
			inputModalities: input_modalities,
			max_output_tokens: spec.max_output_tokens,
			name: spec.name,
			object: "model",
			owned_by: "opencode"
		});
	}
	for (const item of existingData) {
		const id = typeof item.id === "string" ? item.id : "";
		if (id.length === 0) continue;
		const spec = catalogById.get(id);
		const rawModalities = item.input_modalities ?? item.inputModalities ?? item.input ?? spec?.input_modalities;
		const input_modalities = sanitizeModalities(rawModalities);
		const enriched = {
			...item,
			context_window: item.context_window ?? item.contextWindow ?? spec?.context_window ?? FALLBACK_CONTEXT_WINDOW,
			id,
			input: input_modalities,
			input_modalities,
			inputModalities: input_modalities,
			max_output_tokens: item.max_output_tokens ?? item.maxTokens ?? spec?.max_output_tokens ?? FALLBACK_MAX_OUTPUT_TOKENS,
			name: item.name ?? item.displayName ?? spec?.name ?? id,
			object: "model",
			owned_by: item.owned_by ?? "opencode"
		};
		merged.set(id, enriched);
	}
	const enrichedPayload = {
		data: [...merged.values()],
		object: "list"
	};
	const bodyStr = JSON.stringify(enrichedPayload);
	const newHeaders = new Headers(response.headers);
	newHeaders.set("content-type", "application/json; charset=utf-8");
	newHeaders.set("content-length", Buffer.byteLength(bodyStr).toString());
	return new Response(bodyStr, {
		headers: newHeaders,
		status: 200,
		statusText: "OK"
	});
};
//#endregion
//#region src/utils/session-id.ts
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
const SESSION_HEADER = "x-opencode-session";
/** Generic proxy session affinity header used by gateways and connection pools. */
const SESSION_AFFINITY_HEADER = "x-session-affinity";
/**
* The fourth session header, and the one this plugin never sent.
*
* Captured from OpenCode 2.0.28 talking to a local server: it sends
* `x-opencode-session`, `x-opencode-session-id`, `x-session-affinity` AND
* `x-session-id`, all four carrying the same value on every request. This plugin
* has always sent three of them.
*/
const SESSION_ID_HEADER = "x-session-id";
/** Header carrying the derived OpenCode parent session id for subagents. */
const PARENT_SESSION_HEADER = "x-opencode-parent-session-id";
/** Generic parent session header used by third-party proxies. */
const PARENT_SESSION_ALT_HEADER = "x-parent-session-id";
/**
* The vendor's own base62 alphabet, character for character (`randomBase62` in
* `packages/opencode/src/id/id.ts`): digits, then uppercase, then lowercase.
* The ORDER does not matter for validity, only the set does — matching theirs
* keeps our suffix indistinguishable from one they minted.
*/
const BASE62$1 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/**
* Characters of the id that carry a TIMESTAMP: six bytes of
* `milliseconds * 0x1000 + counter`, hex-encoded.
*/
const TIME_HEX_LENGTH$1 = 12;
/** Characters of the random suffix the vendor appends. */
const RANDOM_LENGTH$1 = 14;
/**
* Derive an OpenCode session id from a digest.
*
* **The vendor mints sessions DESCENDING, and nothing else needs doing.**
* `packages/opencode/src/id/id.ts` at v1.19.4:
*
*     now = BigInt(Date.now()) * 4096n + BigInt(++counter)   // per-millisecond
*     now = direction === "descending" ? ~now : now
*     6 bytes of `now` big-endian + 14 base62  →  `ses_<12hex><14base62>`
*
* We mint exactly ONE id per session, so the counter is 1 — the vendor's own
* value for the first id inside a millisecond. There is no clamp here and no
* band arithmetic: inverting `(ms << 12) + 1` puts the low twelve bits at
* `0xFFE` on its own, which is where a real OpenCode session id sits.
*
* **The gateway's rule, measured** by replaying the vendor client's captured
* request body and changing nothing but this header: it admits low twelve bits
* in `0xFC0..0xFFE` and refuses anything else with `403 FreeTierError`
* (ascending `0xFFE` and `0xFC0` → 200; ascending `0x001` → 403). PR #35/#37
* found this band first, by clamping the counter into it; that clamp is no
* longer needed, because following the vendor's own construction lands in the
* band as a consequence rather than as an assertion about it.
*
* The timestamp is NOT checked for recency — measured on the live gateway: a
* 2009 value and a future 2030 value both answered 200 as long as the low
* twelve bits were in the band. Only the band is enforced. So a session with no
* recorded creation time takes a value DERIVED from the hash: stable across
* turns (which affinity needs) and indistinguishable from a real one.
*
* @param digest - the SHA-256 of the DSH session id.
* @param createdAt - the session's creation time in ms, when the host knows it.
* @returns the derived `ses_<12hex><14base62>` id.
*/
const deriveSessionId = (digest, createdAt) => {
	const counter = 1n;
	const anchor = createdAt !== void 0 && Number.isSafeInteger(createdAt) && createdAt >= 0 ? BigInt(createdAt) : BigInt(`0x${digest.hex.slice(4, 16)}`);
	const mask = 2n ** 48n;
	const time = (anchor * 4096n + counter) % mask;
	const descending = mask - 1n - time;
	let random = "";
	for (let i = 6; i < 20; i += 1) {
		const byte = digest.bytes[i];
		if (byte !== void 0) random += BASE62$1[byte % 62] ?? "0";
	}
	return `ses_${descending.toString(16).padStart(TIME_HEX_LENGTH$1, "0")}${random.slice(0, RANDOM_LENGTH$1)}`;
};
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
const isOpenCodeSessionId = (value) => typeof value === "string" && /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/u.test(value);
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
const isOpenCodeMessageId = (value) => typeof value === "string" && /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/u.test(value);
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
const pinnedSessionId = (pinned, digestOf) => isOpenCodeSessionId(pinned) ? pinned : deriveSessionId(digestOf("default"));
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
const sessionIdForRequest = (turnSessionId, pinnedHeader, pinnedEnv, digestOf) => {
	if (turnSessionId !== void 0 && turnSessionId.length > 0) return turnSessionId;
	if (isOpenCodeSessionId(pinnedHeader)) return pinnedHeader;
	return pinnedSessionId(pinnedEnv, digestOf);
};
//#endregion
//#region src/session.ts
/**
* Deterministic OpenCode session identity.
*
* The gateway rejects requests without a valid OpenCode session id, and it must
* stay stable for a DSH session or every turn looks like a new conversation to
* the prompt cache. Everything here is a pure derivation from the DSH session
* id and, when the Host knows it, the session's creation time — no table, no
* randomness, no state to lose on restart.
*
* One value breaks that rule on purpose: `newOpenCodeMessageId`, the message id
* a turn sends as `x-opencode-request`. It is identity for the gateway's own
* metrics and accounting, not affinity, and the vendor mints a fresh one per
* user message — so it does too.
*
* @module dsh-opencode-patch/session
*/
/** Canonical OpenCode CLI User-Agent the DSH LLM adapter strips. */
const OPENCODE_UA = OPENCODE_USER_AGENT;
/** The vendor's base62 alphabet, character for character. */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Characters carrying the timestamp. */
const TIME_HEX_LENGTH = 12;
/** Characters of the random suffix, for `randomBytes` below. */
const RANDOM_LENGTH = 14;
/** The digest a session id is derived from: the only crypto this module does. */
const digestOf = (sessionId) => {
	const bytes = createHash("sha256").update(sessionId).digest();
	return {
		bytes,
		hex: Buffer.from(bytes).toString("hex")
	};
};
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
const openCodeSessionIdFor = (sessionId, createdAt) => deriveSessionId(digestOf(String(sessionId)), createdAt);
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
const headerValueFor = (sessionId, createdAt) => {
	if (sessionId === void 0 || sessionId === null) return;
	const raw = String(sessionId);
	if (raw.length === 0) return;
	return openCodeSessionIdFor(raw, createdAt);
};
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
const fallbackSessionId = (envName) => {
	const name = envName !== void 0 && envName.length > 0 ? envName : void 0;
	return pinnedSessionId(name === void 0 ? void 0 : process.env[name], digestOf);
};
/** Counter disambiguating message ids minted within one millisecond. */
let messageCounter = 0;
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
const newOpenCodeMessageId = (now = Date.now()) => {
	const milliseconds = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
	const counter = messageCounter % 4096;
	messageCounter += 1;
	const time = (BigInt(milliseconds) * 4096n + BigInt(counter)) % 2n ** 48n;
	const bytes = randomBytes(RANDOM_LENGTH);
	let random = "";
	for (let index = 0; index < RANDOM_LENGTH; index += 1) {
		const byte = bytes[index];
		if (byte !== void 0) random += BASE62[byte % 62] ?? "0";
	}
	return `msg_${time.toString(16).padStart(TIME_HEX_LENGTH, "0")}${random}`;
};
//#endregion
//#region src/tool-fallback.ts
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
const RESPONSES_PATH = "/responses";
/** Placeholder `read` schema formatted for Anthropic-compatible /messages. */
const DUMMY_READ_TOOL_ANTHROPIC = {
	description: "Read a file or directory from the local filesystem.",
	input_schema: {
		properties: {
			filePath: {
				description: "The absolute path to the file or directory to read",
				type: "string"
			},
			offset: {
				description: "The line number to start reading from (1-indexed)",
				type: "number"
			},
			limit: {
				description: "The maximum number of lines to read (defaults to 2000)",
				type: "number"
			}
		},
		required: ["filePath"],
		type: "object"
	},
	name: "read"
};
/** Placeholder `bash` schema formatted for Anthropic-compatible /messages. */
const DUMMY_BASH_TOOL_ANTHROPIC = {
	description: "Execute a bash command.",
	input_schema: {
		properties: {
			command: {
				description: "The command to execute",
				type: "string"
			},
			workdir: {
				description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
				type: "string"
			},
			timeout: {
				description: "Optional timeout in milliseconds",
				type: "number"
			}
		},
		required: ["command"],
		type: "object"
	},
	name: "bash"
};
/** Placeholder `read` schema the gateway's validator accepts. */
const DUMMY_READ_TOOL = {
	description: "Read a file or directory from the local filesystem.",
	name: "read",
	parameters: {
		properties: {
			filePath: {
				description: "The absolute path to the file or directory to read",
				type: "string"
			},
			offset: {
				description: "The line number to start reading from (1-indexed)",
				type: "number"
			},
			limit: {
				description: "The maximum number of lines to read (defaults to 2000)",
				type: "number"
			}
		},
		required: ["filePath"],
		type: "object"
	},
	type: "function"
};
/** Placeholder `bash` schema the gateway's validator accepts. */
const DUMMY_BASH_TOOL = {
	description: "Execute a bash command.",
	name: "bash",
	parameters: {
		properties: {
			command: {
				description: "The command to execute",
				type: "string"
			},
			workdir: {
				description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
				type: "string"
			},
			timeout: {
				description: "Optional timeout in milliseconds",
				type: "number"
			}
		},
		required: ["command"],
		type: "object"
	},
	type: "function"
};
/** Placeholder `read` schema formatted for OpenAI-compatible /chat/completions. */
const DUMMY_READ_TOOL_FUNCTION = {
	type: "function",
	function: {
		description: "Read a file or directory from the local filesystem.",
		name: "read",
		parameters: {
			properties: {
				filePath: {
					description: "The absolute path to the file or directory to read",
					type: "string"
				},
				offset: {
					description: "The line number to start reading from (1-indexed)",
					type: "number"
				},
				limit: {
					description: "The maximum number of lines to read (defaults to 2000)",
					type: "number"
				}
			},
			required: ["filePath"],
			type: "object"
		}
	}
};
/** Placeholder `bash` schema formatted for OpenAI-compatible /chat/completions. */
const DUMMY_BASH_TOOL_FUNCTION = {
	type: "function",
	function: {
		description: "Execute a bash command.",
		name: "bash",
		parameters: {
			properties: {
				command: {
					description: "The command to execute",
					type: "string"
				},
				workdir: {
					description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
					type: "string"
				},
				timeout: {
					description: "Optional timeout in milliseconds",
					type: "number"
				}
			},
			required: ["command"],
			type: "object"
		}
	}
};
const toolNames = (tools) => {
	let hasBash = false;
	let hasRead = false;
	let isOpenAiFormat = false;
	for (const tool of tools) {
		if (!isRecord(tool)) continue;
		let toolName = tool.name;
		if (typeof toolName !== "string" && isRecord(tool.function)) {
			toolName = tool.function.name;
			isOpenAiFormat = true;
		}
		if (toolName === "read") hasRead = true;
		if (toolName === "bash") hasBash = true;
	}
	return {
		hasBash,
		hasRead,
		isOpenAiFormat
	};
};
/** Whether `modelId` is in scope for the core-tool fallback. */
const isCoreToolModel = (modelId, marker) => {
	if (findModelSpec(modelId)?.is_free === true) return true;
	if (marker === "*") return true;
	if (marker.length === 0) return false;
	return modelId.includes(marker);
};
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
const maybeInjectCoreTools = (url, body, headers, options) => {
	if (!options.enabled) return body;
	const isResponses = url.includes(RESPONSES_PATH);
	const isCompletions = url.includes("/chat/completions") || url.includes("/completions");
	if (!isResponses && !isCompletions) return body;
	if (body === void 0 || body === null) return body;
	let bodyStr;
	if (typeof body === "string") bodyStr = body;
	else if (Buffer.isBuffer(body)) bodyStr = body.toString("utf-8");
	else return body;
	if (bodyStr.length === 0) return body;
	let parsed;
	try {
		parsed = JSON.parse(bodyStr);
	} catch {
		return body;
	}
	if (!isRecord(parsed)) return body;
	const modelProp = parsed.model;
	if (typeof modelProp !== "string") return body;
	if (!isCoreToolModel(modelProp, options.modelMarker)) return body;
	const toolsProp = parsed.tools;
	let tools;
	if (toolsProp === void 0) tools = [];
	else if (isUnknownArray(toolsProp)) tools = [...toolsProp];
	else tools = [];
	const { hasBash, hasRead, isOpenAiFormat } = toolNames(tools);
	const isAnthropic = url.includes("/messages");
	const useOpenAi = isOpenAiFormat || url.includes("/chat/completions") || url.includes("/completions");
	const getReadTool = () => {
		if (isAnthropic) return DUMMY_READ_TOOL_ANTHROPIC;
		if (useOpenAi) return DUMMY_READ_TOOL_FUNCTION;
		return DUMMY_READ_TOOL;
	};
	const getBashTool = () => {
		if (isAnthropic) return DUMMY_BASH_TOOL_ANTHROPIC;
		if (useOpenAi) return DUMMY_BASH_TOOL_FUNCTION;
		return DUMMY_BASH_TOOL;
	};
	if (!hasRead) tools.push(getReadTool());
	if (!hasBash) tools.push(getBashTool());
	parsed.tools = tools;
	const newBodyStr = JSON.stringify(parsed);
	headers.set("content-length", Buffer.byteLength(newBodyStr).toString());
	return newBodyStr;
};
//#endregion
//#region src/fetch-patch.ts
/**
* Whether the model a body names is one the gateway admits with no key.
*
* The gateway's free-tier rule is per-model, not per-plane: `allowAnonymous` on
* the model entry admits a request with no key at all, or with the literal
* `public`, and the proxy strips it before forwarding
* (`packages/console/app/src/lib/inference-proxy.ts`, identical in 1.19 and 2.x;
* `docs/upstream-findings.md` §1.5). So "no credential resolved" is only a fault
* for a model that NEEDS one, and reporting it for a free model sends the reader
* to set a key they do not need.
*
* The body is read rather than assumed, because the model is the only thing that
* decides. A plane-level check would be wrong in both directions: the Zen plane
* offers free models, and so does Go, which serves them by subscription key.
*
* @param body - the request body, when there is one to read.
* @returns whether the model it names is flagged free.
*/
const isFreeModelBody = (body) => {
	if (typeof body !== "string" || body.length === 0) return false;
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed !== "object" || parsed === null) return false;
		const model = parsed.model;
		if (typeof model !== "string" || model.length === 0) return false;
		return findModelSpec(model)?.is_free === true;
	} catch {
		return false;
	}
};
const hasSessionHeader = (input, init) => {
	const source = headerSourceOf(input, init);
	if (source === void 0) return false;
	try {
		return new Headers(source).has(SESSION_HEADER);
	} catch {
		return false;
	}
};
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
const isOpenCodeRequest = (url, state, providers, gatewayUrls = DEFAULT_GATEWAY_URLS) => {
	for (const marker of gatewayUrls) if (marker.length > 0 && url.includes(marker)) return true;
	if (state !== void 0 && providers.has(state.provider)) return true;
	return false;
};
const patchFetch = (original, als, config, hooks = {}) => {
	const warnedNoCredential = /* @__PURE__ */ new Set();
	return async function patchedFetch(input, init) {
		const state = als.getStore();
		const url = requestUrlOf(input);
		if (!isOpenCodeRequest(url, state, config.providers, config.gatewayUrls)) return original.call(this, input, init);
		const headers = new Headers(headerSourceOf(input, init));
		const extracted = extractApiKeyFromHeaders(headers);
		const requestKey = extracted === void 0 || isPlaceholderApiKey(extracted) ? void 0 : extracted;
		if (requestKey !== void 0) recordCapturedApiKey(requestKey, state?.provider, url);
		const plane = gatewayPlaneFor(url);
		const wireHeader = authHeaderFor(url);
		if (wireHeader === "x-api-key" && !headers.has("anthropic-version")) headers.set("anthropic-version", ANTHROPIC_VERSION);
		const wireKey = headers.get(wireHeader)?.replace(/^Bearer\s+/iu, "").trim();
		if (wireKey === void 0 || wireKey.length === 0 || isPlaceholderApiKey(wireKey)) {
			const tier = tierForRequest(url, state?.provider);
			const captured = config.keySource === "configured" ? void 0 : getCapturedApiKey(state?.provider, tier === "unknown" ? void 0 : tier);
			// shortcut: 上游只读 process.env，而 key 常存在 WB 凭据库里（本机即是），
			// 于是请求拿不到 key、网关拒答。改走 resolveRef（凭据库优先、env 兜底）。
			const declaredRef = config.apiKeyEnv !== void 0 && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : (plane === "opencode-go" || plane.length === 0 && state?.provider === "opencode-go" ? "OPENCODE_GO_API_KEY" : "OPENCODE_API_KEY");
			const fromConfig = typeof config.apiKey === "string" && config.apiKey.trim().length > 0 && !isPlaceholderApiKey(config.apiKey.trim()) ? config.apiKey.trim() : void 0;
			const declared = fromConfig ?? (hooks.resolveDeclaredKey === void 0 ? process.env[declaredRef] : await hooks.resolveDeclaredKey(declaredRef));
			const fallbackKey = requestKey ?? captured ?? (declared === void 0 || declared.length === 0 || isPlaceholderApiKey(declared) ? void 0 : declared) ?? resolveOpencodeStoreKey(plane, config.readOpencodeStore);
			if (typeof fallbackKey === "string" && fallbackKey.length > 0) headers.set(wireHeader, wireHeader === "authorization" ? `Bearer ${fallbackKey}` : fallbackKey);
			else if (plane.length > 0 && !warnedNoCredential.has(plane) && !isFreeModelBody(init?.body)) {
				warnedNoCredential.add(plane);
				const sources = [
					`a key on the request: ${requestKey === void 0 ? "none" : "present"}`,
					`a key captured from a live request (policy ${config.keySource}): ${captured === void 0 ? "none" : "present"}`,
					`${plane === "opencode-go" ? "OPENCODE_GO_API_KEY" : "OPENCODE_API_KEY"}: ${declared === void 0 || declared.length === 0 ? "unset" : "set"}`,
					`the installation's own store: ${config.readOpencodeStore ? "read" : "not enabled"}`
				];
				console.warn(`[dsh-opencode-patch] no credential resolved for ${plane}; sending the adapter's placeholder, which the gateway answers with 401. Consulted: ${sources.join("; ")}.`, "set a key on the route or its env var, or sign in through the settings card");
			}
		}
		const envName = config.sessionIdEnv !== void 0 && config.sessionIdEnv.length > 0 ? config.sessionIdEnv : void 0;
		const sessionVal = sessionIdForRequest(state?.value, headers.get(SESSION_HEADER), envName === void 0 ? void 0 : process.env[envName], digestOf);
		headers.set("x-opencode-session-id", sessionVal);
		headers.set(SESSION_HEADER, sessionVal);
		if (!(state?.provider ?? "").startsWith("opencode")) {
			headers.set(SESSION_AFFINITY_HEADER, sessionVal);
			headers.set(SESSION_ID_HEADER, sessionVal);
		}
		if (state?.parentValue !== void 0) {
			headers.set(PARENT_SESSION_HEADER, state.parentValue);
			headers.set(PARENT_SESSION_ALT_HEADER, state.parentValue);
		}
		if (config.injectUserAgent) headers.set("User-Agent", config.userAgent ?? OPENCODE_UA);
		const org = config.credentialOrg ?? hooks.resolveOrg?.(gatewayPlaneFor(url));
		if (org !== void 0 && org.length > 0) headers.set("x-opencode-org-id", org);
		if (config.injectOriginHeaders) {
			headers.set("x-opencode-client", config.originClient);
			const requestValue = state?.requestValue;
			if (requestValue !== void 0 && isOpenCodeMessageId(requestValue)) headers.set("x-opencode-request", requestValue);
			if (config.injectProject) {
				const project = state?.project !== void 0 && state.project.length > 0 ? state.project : "global";
				// shortcut: HTTP 头只能是 Latin-1 字节，中文目录名（如「默认工作区D」）会让
				// undici 抛 TypeError，表现为 Connection error。非 ASCII 一律百分号编码。上游修复后可删。
				headers.set("x-opencode-project", /^[\x20-\x7e]*$/.test(project) ? project : encodeURIComponent(project));
			}
		}
		const newInit = {
			...init,
			headers
		};
		let requestToSend = input;
		let bodySource = "none";
		let bodyToPatch = init?.body;
		if (bodyToPatch !== void 0) bodySource = "init";
		else if (input instanceof Request) try {
			bodyToPatch = await input.clone().text();
			bodySource = "request";
		} catch {
			bodyToPatch = void 0;
		}
		let finalBody = bodyToPatch;
		if (bodyToPatch !== void 0) {
			const newBody = maybeInjectCoreTools(url, bodyToPatch, headers, {
				enabled: config.injectCoreTools,
				modelMarker: config.freeModelMarker
			});
			if (newBody !== bodyToPatch) {
				finalBody = newBody;
				if (bodySource === "request" && input instanceof Request) requestToSend = new Request(input, {
					body: newBody,
					method: input.method
				});
				else newInit.body = newBody;
			}
		}
		// shortcut: 上游只在成功后才写 debug，异常时整条请求在日志里消失，无法定位。
		// 这里补一条失败记录（含 cause 的 code），仅用于诊断。上游修复后可删。
		let response;
		try {
			response = await original.call(this, requestToSend, newInit);
		} catch (error) {
			hooks.debug?.({
				error: error?.message ?? String(error),
				errorCause: error?.cause ? String(error.cause.code ?? error.cause.message ?? error.cause) : null,
				errorName: error?.name ?? null,
				plane: gatewayPlaneFor(url),
				session: headers.get("x-opencode-session") ?? null,
				status: null,
				url,
				userAgent: headers.get("User-Agent") ?? null
			});
			throw error;
		}
		hooks.debug?.({
			auth: extractApiKeyFromHeaders(headers) !== void 0,
			bodySource,
			claimed: true,
			org: headers.get("x-opencode-org-id") ?? null,
			plane: gatewayPlaneFor(url),
			request: headers.get("x-opencode-request") ?? null,
			session: headers.get("x-opencode-session") ?? null,
			sessionFormat: isOpenCodeSessionId(headers.get(SESSION_HEADER)),
			status: response.status,
			toolNames: toolNamesOf(finalBody),
			url,
			userAgent: headers.get("User-Agent") ?? null
		});
		const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
		if (config.enrichModels && method === "GET" && isModelsListingUrl(url, config.gatewayUrls)) return enrichModelsResponse(url, response);
		return response;
	};
};
//#endregion
//#region src/responses-routes.ts
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
const RESPONSES_SDK = "@ai-sdk/openai";
/** The SDK whose presence means "this model is served on the Messages API". */
const ANTHROPIC_SDK = "@ai-sdk/anthropic";
/** The SDK whose models speak pi's `google-generative-ai` protocol. */
const GOOGLE_SDK = "@ai-sdk/google";
/** The SDK whose models speak pi's `mistral-conversations` protocol. */
const MISTRAL_SDK = "@ai-sdk/mistral";
/** The SDK whose presence means "this model is served on Mistral's API". */
/** Route serving the gateway's Responses-API models. */
const RESPONSES_ROUTE = "opencode-responses";
/** Route serving the gateway's Messages-API models. */
const ANTHROPIC_ROUTE = "opencode-anthropic";
/** Route serving the gateway's Mistral-API models. */
/** Route serving the Go plane's Responses-API models. */
const GO_RESPONSES_ROUTE = "opencode-go-responses";
/** Route serving the Go plane's Messages-API models. */
const GO_ANTHROPIC_ROUTE = "opencode-go-anthropic";
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
const GOOGLE_INTERNAL_ROUTE = "opencode-google";
/** Google native protocol on the Go subscription. */
const GO_GOOGLE_INTERNAL_ROUTE = "opencode-go-google";
/**
* The gateway planes: one base URL, one catalog and one credential each.
*
* A plane is a property of the ACCOUNT and the base URL, never of a model — the
* same model id can exist on both planes and be served on a different shape in
* each. Routes are keyed by (plane, protocol) for exactly that reason: an SDK
* says which shape a model needs, never which plane it belongs to.
*/
const PLANES = {
	opencode: "https://opencode.ai/zen/v1",
	"opencode-go": "https://opencode.ai/zen/go/v1"
};
/**
* The route that serves each (plane, protocol) pair.
*
* The plane's own base route (`opencode`, `opencode-go`) is implicit: it is the
* one a model naming no SDK stays on, and it is not in this table because it is
* never a redirect target — a model already there has nowhere to go.
*/
const ROUTE_FOR_PLANE_PROTOCOL = {
	opencode: {
		baseURL: PLANES.opencode,
		routes: {
			"openai-responses": RESPONSES_ROUTE,
			"anthropic-messages": ANTHROPIC_ROUTE,
			"google-generative-ai": GOOGLE_INTERNAL_ROUTE
		}
	},
	"opencode-go": {
		baseURL: PLANES["opencode-go"],
		routes: {
			"openai-responses": GO_RESPONSES_ROUTE,
			"anthropic-messages": GO_ANTHROPIC_ROUTE,
			"google-generative-ai": GO_GOOGLE_INTERNAL_ROUTE
		}
	}
};
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
const PROTOCOL_FOR_SDK = {
	[RESPONSES_SDK]: "openai-responses",
	[ANTHROPIC_SDK]: "anthropic-messages",
	[GOOGLE_SDK]: "google-generative-ai"
};
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
const UNSERVED_SDKS = /* @__PURE__ */ new Set([MISTRAL_SDK]);
/** Reserved for protocol/plane combinations without an adapter. */
const UNSERVED_PLANE_SDKS = /* @__PURE__ */ new Set();
/**
* Routes this plugin registers through its own adapter rather than the
* wrapper's mount, because the wrapper's hand-declared table refuses their
* protocol. `registerResponsesProvider` skips these when building the wrapper's
* providers dict and mounts each one itself.
*/
const SELF_MOUNTED_ROUTES = /* @__PURE__ */ new Set([GOOGLE_INTERNAL_ROUTE, GO_GOOGLE_INTERNAL_ROUTE]);
/** The route each non-default protocol is served from. */
/** The Zen plane's rows of {@link ROUTE_FOR_PLANE_PROTOCOL}. */
const ROUTE_FOR_PROTOCOL = {
	"openai-responses": RESPONSES_ROUTE,
	"anthropic-messages": ANTHROPIC_ROUTE,
	"google-generative-ai": GOOGLE_INTERNAL_ROUTE
};
/** Every route this plugin registers for itself. */
const INTERNAL_ROUTES = Object.values(ROUTE_FOR_PLANE_PROTOCOL).flatMap((plane) => Object.values(plane.routes));
/**
* Whether a route id is one this plugin owns and keeps out of the UI.
*
* @param id - the route id to test.
* @returns true when the plugin registered it for a non-default protocol.
*/
const isInternalRoute = (id) => typeof id === "string" && INTERNAL_ROUTES.includes(id);
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
const isServableSdk = (providerNpm) => providerNpm === void 0 || typeof providerNpm === "string" && PROTOCOL_FOR_SDK[providerNpm] !== void 0;
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
const internalRouteFor = (provider, model, providerNpm, overrideProtocol) => {
	if (typeof provider !== "string" || typeof model !== "string") return;
	let planeKey = provider;
	if (planeKey === "opencode" && findModelSpecOn("zen", model) === void 0 && findModelSpecOn("go", model) !== void 0) planeKey = "opencode-go";
	const plane = ROUTE_FOR_PLANE_PROTOCOL[planeKey];
	if (plane === void 0) return;
	if (overrideProtocol !== void 0) return plane.routes[overrideProtocol];
	if (providerNpm !== void 0) {
		if (typeof providerNpm !== "string") return;
		const protocol = PROTOCOL_FOR_SDK[providerNpm];
		return protocol === void 0 ? void 0 : plane.routes[protocol];
	}
	const byId = protocolFromModelId(model);
	return byId === void 0 ? void 0 : plane.routes[byId];
};
/**
* The protocol a model id names, for models no catalog describes.
*
* Only the two families whose protocol the vendor fixes by name: a `gemini-*`
* model is served on the Generative AI path and a `claude-*` one on Messages, and
* neither is ever served as a chat completion. Measured against the live gateway:
* both answer 400 on the completions endpoint and 200 on their own.
*
* Shared by the router and the listing filter on purpose - one rule, so a model
* cannot be routed somewhere the listing said it could not go, or the other way
* round.
*
* @param model - the model id.
* @returns the protocol, or undefined when the id names no family with a fixed one.
*/
const protocolFromModelId = (model) => {
	if (model.startsWith("gemini-")) return "google-generative-ai";
	if (model.startsWith("claude-")) return "anthropic-messages";
	if (model.startsWith("muse-") || model.startsWith("gpt-")) return "openai-responses";
};
//#endregion
//#region src/pi-provider.ts
/**
* The base URL each protocol uses on each plane.
*
* Read from pi-ai's own `opencode` and `opencode-go` providers rather than
* inferred: the Anthropic entry is deliberately one level shorter because that
* SDK appends `/v1/messages` itself.
*/
/**
* The endpoint each protocol's requests go to, per plane.
*
* The base comes from the catalog - the field the client itself consumes
* (`models-dev.ts:107` lifts the provider's `api` into `settings.baseURL`), and
* which the shim now carries as `OPENCODE_PLANE_API`. It was hard-coded here
* instead, and when the vendor moved `models.dev`'s provider entry to
* `…/inference/v1` the constant was left on `…/zen/v1`: a deployment would have
* kept using the older endpoint while its own catalog named the newer one.
*
* The Anthropic path differs from the others by design (`/messages` not `/chat/
* completions`), so only the suffix changes, and the suffix is per protocol
* rather than per model.
*/
const PLANE_BASE = {
	opencode: OPENCODE_PLANE_API.zen,
	"opencode-go": OPENCODE_PLANE_API.go
};
/**
* The older endpoint each plane's requests used to go to.
*
* Still served — measured — and the reason an endpoint choice exists at all:
* the catalog moved to `…/inference/v1`, but a deployment whose account is only
* entitled on the older family needs `/zen/v1` and no catalog change will say
* so. `responses-routes.ts`'s `PLANES` is this table, kept as the declared name
* so the two cannot drift.
*/
const LEGACY_PLANE_API = {
	opencode: "https://opencode.ai/zen/v1",
	"opencode-go": "https://opencode.ai/zen/go/v1"
};
/**
* The base URL one plane's requests go to under one endpoint family.
*
* `auto` is the catalog's own value, so following the vendor costs nothing here;
* `legacy` and `modern` pin the family explicitly. The two families are
* independently entitled, which is why a user can choose rather than being
* carried along by whatever the catalog happens to name.
*
* @param plane - the gateway plane.
* @param family - the endpoint family to resolve.
* @returns that plane's base URL.
*/
const planeBaseFor = (plane, family) => {
	if (family === "legacy") return LEGACY_PLANE_API[plane];
	return family === "modern" ? OPENCODE_PLANE_API[plane === "opencode-go" ? "go" : "zen"] : PLANE_BASE[plane];
};
/**
* The protocol's path on its family's base, or `null` when the SDK wants the base
* without its version segment.
*
* A family's `api` is the base INCLUDING the version segment - `…/openai/v1`,
* `…/anthropic/v1`, `…/google/v1beta` - so the versioned protocols are the base
* with nothing added, and the Anthropic endpoint (`/messages`) is the base
* without that segment: pi-ai's SDK appends `/v1/messages` itself.
*/
const PROTOCOL_SUFFIX = {
	"anthropic-messages": null,
	"google-generative-ai": "",
	"openai-completions": "",
	"openai-responses": ""
};
const FAMILY_OF_PROTOCOL = {
	"anthropic-messages": "anthropic",
	"google-generative-ai": "google",
	"openai-completions": "openai",
	"openai-responses": "openai"
};
/**
* The inference family's base, per plane and per wire family — the FALLBACK.
*
* **Measured from the vendor's own `GET /console/api/config`, not derived.** The
* gateway does not serve one base per plane with the protocol appended: each
* family lives at its own path, and the vendor's client hands the SDK exactly
* the `api` its config reports for that model.
*
* Deriving these by stripping `/v1` off one plane URL - which is what this
* module used to do - sent every Anthropic model to `…/inference/openai` and
* every Google model to `…/inference/openai/v1`. Measured on the live config:
* `opencode` declares `…/inference/anthropic/v1` for 18 models and
* `…/inference/google/v1beta` for 8; `opencode-go` declares the `go/` variants
* for 5 and 1. Thirty-two models, reachable only through their own family.
*
* The legacy (`…/zen/v1`) family genuinely IS one base for every protocol, which
* is why it keeps the old derivation.
*/
/**
* The SDK package each wire family is named by in the catalog.
*
* `""` is the provider default — the completions family names no package at all,
* so it is looked up under the empty key first and under `@ai-sdk/openai` (the
* same endpoint, declared for the Responses models) second.
*/
const FAMILY_PACKAGES = {
	anthropic: ["@ai-sdk/anthropic"],
	google: ["@ai-sdk/google"],
	openai: ["", "@ai-sdk/openai"]
};
/**
* A family's endpoint as the CATALOG declares it, or `undefined` when the
* generated map does not name that package yet.
*
* @param plane - the gateway plane.
* @param family - the wire family.
* @returns the declared endpoint, when there is one.
*/
const declaredFamilyBase = (plane, family) => {
	const declared = OPENCODE_FAMILY_API[plane === "opencode-go" ? "go" : "zen"];
	for (const pkg of FAMILY_PACKAGES[family]) {
		const api = declared[pkg];
		if (typeof api === "string" && api.length > 0) return api;
	}
};
const INFERENCE_BASE = {
	opencode: {
		anthropic: "https://opencode.ai/inference/anthropic/v1",
		google: "https://opencode.ai/inference/google/v1beta",
		openai: "https://opencode.ai/inference/openai/v1"
	},
	"opencode-go": {
		anthropic: "https://opencode.ai/inference/go/anthropic/v1",
		google: "https://opencode.ai/inference/go/google/v1beta",
		openai: "https://opencode.ai/inference/go/openai/v1"
	}
};
/**
* Every protocol on one plane under one endpoint family, sharing the base.
*
* Memoised per family: the table is rebuilt at most once per family per process,
* and the map keys are exactly the accepted {@link EndpointFamily} values, so an
* unknown family falls through to the catalog's own answer rather than to
* `undefined`.
*/
const BASES_BY_FAMILY = /* @__PURE__ */ new Map();
const basesFor = (family) => {
	const cached = BASES_BY_FAMILY.get(family);
	if (cached !== void 0) return cached;
	const table = {
		opencode: withPlaneBase("opencode", family),
		"opencode-go": withPlaneBase("opencode-go", family)
	};
	BASES_BY_FAMILY.set(family, table);
	return table;
};
/**
* Every protocol on one plane and family, each on its own family's base.
*
* Legacy is one base for all four protocols; the inference family is not, and
* pretending otherwise is the bug this encodes against.
*/
function withPlaneBase(plane, family) {
	const out = {};
	for (const [protocol, suffix] of Object.entries(PROTOCOL_SUFFIX)) {
		const wire = FAMILY_OF_PROTOCOL[protocol] ?? "openai";
		const base = family === "legacy" ? planeBaseFor(plane, "legacy") : declaredFamilyBase(plane, wire) ?? INFERENCE_BASE[plane][wire];
		out[protocol] = suffix === null ? base.replace(/\/v1$/, "") : `${base}${suffix}`;
	}
	return out;
}
basesFor("auto");
/**
* The protocol each SDK names, for a provider built here.
*
* Deliberately NOT `PROTOCOL_FOR_SDK`: that table is the wrapper's, and it
* lists only the protocols a hand-declared route may name. Building the
* provider ourselves lifts that limit, so this table carries every protocol pi
* implements that the gateway is measured to serve - which is four, and one
* more than a route could ever name.
*
* `@ai-sdk/mistral` is absent on purpose. pi implements
* `mistral-conversations`, but driving it at the gateway produces a request
* whose URL this harness could not even observe, and the account has no
* entitlement to test it against. It stays unserved until that is measured,
* rather than being wired on the strength of a protocol existing.
*/
const GATEWAY_PROTOCOL_FOR_SDK = {
	[RESPONSES_SDK]: "openai-responses",
	[ANTHROPIC_SDK]: "anthropic-messages",
	[GOOGLE_SDK]: "google-generative-ai"
};
/** The protocol a model speaks, or undefined when its SDK has no mapping. */
const protocolFor = (spec) => spec.provider_npm === void 0 ? "openai-completions" : GATEWAY_PROTOCOL_FOR_SDK[spec.provider_npm];
/** Whether a string names a plane this table carries. */
const isPlane = (value) => value === "opencode" || value === "opencode-go";
/**
* The base URL one protocol of one plane is served from.
*
* The table is keyed by {@link Plane} so a missing plane is a type error where
* the table is written. Callers walk a route table whose key is a plain string,
* so they come through here: a plane the table does not carry has no base, and
* saying so is better than indexing past the end of a record.
*
* @param plane - the gateway plane.
* @param protocol - the protocol the request speaks.
* @param family - the endpoint family; the catalog's own endpoint by default.
* @returns the base URL, or undefined when the table does not carry that plane.
*/
const baseForProtocol = (plane, protocol, family = "auto") => isPlane(plane) ? basesFor(family)[plane]?.[protocol] : void 0;
/**
* The pi model object for one catalogued model.
*
* pi reads `api` to pick a protocol implementation and `baseUrl` to know where
* to send it, so both have to be right per model. The cost field is pi's own
* vocabulary: camelCase where the catalog is snake_case, and its rates are per
* million tokens, which is what the catalog already carries.
*
* **The installed catalog entry is the floor, never the whole object.** Building
* these models field by field drops everything pi knows that this module does
* not model — the compatibility switches a Claude or Grok request needs, the
* `reasoning` flag, the `thinkingLevelMap` that maps a thinking level onto the
* wire's own spelling, the `inputLimits` that bound an image. The wrapper's own
* model materialization spreads the catalog entry for the same reason, and says
* so: enumerating would silently drop every field the package does not model.
*
* So the entry is spread first and only then overlaid, which also makes the
* precedence deliberate: our catalog is fresher than the installed one for the
* fields we set, and the installed one is the only source for the fields we do
* not know about.
*
* @param plane - the gateway plane this model is served on.
* @param spec - the catalogued model.
* @param protocol - the protocol it speaks, from {@link protocolFor}.
* @param base - pi's installed catalog entry for this id, when it has one.
* @returns the model object pi's provider dispatches on.
*/
/**
* The thinking levels a model accepts, as pi's map.
*
* pi's `ThinkingLevelMap` is `Partial<Record<ModelThinkingLevel, string | null>>`
* — each of pi's levels mapped onto the spelling the model's own wire uses, with
* `null` marking a level it does not take. The catalog says which levels a model
* has and says nothing about the wire's spelling, so the mapping is the identity
* where the two agree, and every level the catalog does not list is `null` rather
* than absent: absent means "use the provider default", which would offer a level
* the model refuses.
*
* Only the shapes the catalog actually uses are handled — `effort` with a value
* list, and `toggle` for on/off. `budget_tokens` carries a minimum rather than a
* list of levels, so it contributes no map: pi's token-budget field is a separate
* mechanism and guessing one here would be worse than offering none.
*
* @param spec - the catalogued model.
* @returns the map, or `undefined` when the model declares no levels.
*/
const thinkingLevelMapFor = (spec) => {
	if (spec.reasoning !== true) return;
	const options = spec.reasoning_options ?? [];
	const levels = options.find((option) => option.type === "effort" && (option.values?.length ?? 0) > 0)?.values;
	if (levels !== void 0) {
		const map = { off: null };
		for (const level of ALL_THINKING_LEVELS$1) map[level] = levels.includes(level) ? level : null;
		return map;
	}
	if (options.some((option) => option.type === "toggle")) {
		const map = { off: null };
		for (const level of ALL_THINKING_LEVELS$1) map[level] = "on";
		return map;
	}
	const map = { off: null };
	for (const level of ALL_THINKING_LEVELS$1) map[level] = [
		"low",
		"medium",
		"high"
	].includes(level) ? level : null;
	return map;
};
/** pi's levels, in its own order, so the map is complete rather than partial. */
const ALL_THINKING_LEVELS$1 = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The pi model object for one catalogued model.
*
* pi reads `api` to pick a protocol implementation and `baseUrl` to know where
* to send it, so both have to be right per model.
*
* @param plane - the gateway plane this model is served on.
* @param spec - the catalogued model.
* @param protocol - the protocol it speaks, from {@link protocolFor}.
* @param base - pi's installed catalog entry for this id, when it has one.
* @param family - the endpoint family to send it to; the catalog's own endpoint
*   by default.
* @returns the model object pi's provider dispatches on.
*/
const piModelFor = (plane, spec, protocol, base, family = "auto") => ({
	...base,
	api: protocol,
	baseUrl: baseForProtocol(plane, protocol, family),
	contextWindow: spec.context_window,
	cost: {
		cacheRead: spec.cost?.cache_read ?? 0,
		cacheWrite: spec.cost?.cache_write ?? 0,
		input: spec.cost?.input ?? 0,
		output: spec.cost?.output ?? 0
	},
	id: spec.id,
	input: spec.input_modalities,
	maxTokens: spec.max_output_tokens,
	name: spec.name,
	provider: plane,
	reasoning: spec.reasoning === true,
	...thinkingLevelMapFor(spec) === void 0 ? {} : { thinkingLevelMap: thinkingLevelMapFor(spec) }
});
//#endregion
//#region src/models-discovery.ts
/** Whether a discovery result has the shape this decorator can preserve. */
const isDiscoveryCandidate = (value) => {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || value.id.length === 0) return false;
	const { contextWindow, inputModalities, maxTokens, name } = value;
	if (name !== void 0 && (typeof name !== "string" || name.length === 0)) return false;
	if (contextWindow !== void 0 && typeof contextWindow !== "number") return false;
	if (maxTokens !== void 0 && typeof maxTokens !== "number") return false;
	if (inputModalities !== void 0 && (!Array.isArray(inputModalities) || inputModalities.some((modality) => typeof modality !== "string"))) return false;
	return true;
};
/**
* Decide which canonical catalog, if any, may supplement one discovery answer.
*
* Exact claimed route IDs win. A configured custom route or an unstored draft
* falls back to the gateway URL only when the request names an OpenCode
* gateway; anything else is left to its owning adapter.
*/
const resolveDiscoveryProvider = (request, config) => {
	const provider = isRecord(request) && typeof request.provider === "string" && request.provider.length > 0 && config.providers.has(request.provider) ? request.provider : void 0;
	const baseURL = isRecord(request) && typeof request.baseURL === "string" ? request.baseURL : void 0;
	const normalizedBaseURL = baseURL?.toLowerCase() ?? "";
	const isGateway = config.gatewayUrls.some((marker) => marker.length > 0 && normalizedBaseURL.includes(marker.toLowerCase()));
	if (provider === "opencode-go") return "go";
	if (provider === "opencode") return "zen";
	if (!isGateway || baseURL === void 0) return;
	return isGoPlaneUrl(baseURL) ? "go" : "zen";
};
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
const mergeDiscoveredModels = (discovered, provider) => {
	const seen = /* @__PURE__ */ new Set();
	const merged = [];
	if (Array.isArray(discovered)) for (const candidate of discovered) {
		if (!isDiscoveryCandidate(candidate) || seen.has(candidate.id)) continue;
		if (isDeprecatedModelOn(provider, candidate.id)) continue;
		seen.add(candidate.id);
		const spec = findModelSpecOn(provider, candidate.id);
		merged.push({
			...candidate,
			contextWindow: candidate.contextWindow ?? spec?.context_window,
			inputModalities: sanitizeModalities(candidate.inputModalities ?? spec?.input_modalities),
			maxTokens: candidate.maxTokens ?? spec?.max_output_tokens
		});
	}
	return merged;
};
/**
* The Host's UNFILTERED provider listing, captured when the hiding patch is
* installed. The re-dispatch must consult this one: the patched listing
* deliberately omits the route, so checking the patched method would make the
* redirect never fire.
*/
/**
* Kept WITH its receiver. A method read off the service and called detached
* runs with `this === undefined`, and the LLM registry reads its own state
* through `this` — so the detached call surfaces as
* "Cannot read properties of undefined (reading 'adapters')", which names the
* registry's internals rather than the call that broke the receiver.
*/
let registeredRoutes;
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
const isRouteRegistered = (routeId) => {
	if (registeredRoutes === void 0) return false;
	const { receiver } = registeredRoutes;
	if (isRecord(receiver) && "adapters" in receiver && receiver.adapters instanceof Map && receiver.adapters.has(routeId)) return true;
	const routes = Reflect.apply(registeredRoutes.list, registeredRoutes.receiver, []);
	return Array.isArray(routes) && routes.some((route) => isRecord(route) && route.id === routeId);
};
/** Drop every internal route from a Host listing, leaving other entries alone. */
const withoutRoute = (value, key) => Array.isArray(value) ? value.filter((entry) => !(isRecord(entry) && isInternalRoute(entry[key]))) : value;
/**
* Whether a model can be served, judged by the SDK the PLANE IN HAND declares.
*
* The plane matters: `qwen3.8-max`, `minimax-m2.7` and `minimax-m3` are
* `@ai-sdk/anthropic` on Go and the default (completions) on Zen, so a Go-first
* lookup filters a Zen listing by a Go fact. Same seam as the redirect's — see
* `findModelSpecOn`.
*/
/**
* Whether a model may be offered on a route.
*
* Exported for its own test: it is the one place I1's second clause lives, and the
* interesting case is a model no catalog describes.
*/
const isServableModel = (id, route) => {
	if (typeof id !== "string") return true;
	const plane = catalogPlaneForRoute(route);
	const sdk = findModelSpecOn(plane, id)?.provider_npm;
	if (sdk !== void 0) {
		if (UNSERVED_PLANE_SDKS.has(`${route} + ${sdk}`)) return false;
		return isServableSdk(sdk);
	}
	return protocolFromModelId(id) === void 0 || internalRouteFor(route, id) !== void 0;
};
/** The two routes this plugin owns; a deployment's own relay is not one. */
const isPlaneRoute = (provider) => provider === "opencode" || provider === "opencode-go";
/**
* Whether the catalog prices this model above zero, on its own plane.
*
* The official client's keyless rule is exactly this test
* (`packages/opencode/src/provider/provider.ts:231-237`: delete every model whose
* `cost.input` is not 0 when no credential is present), so a keyless deployment
* is offered the free ids and nothing it cannot pay for.
*
* @param plane - the catalog plane the route belongs to.
* @param id - the model id.
* @returns whether the model costs anything to call.
*/
const costsMoney = (plane, id) => {
	const cost = findModelSpecOn(plane, id)?.cost;
	return cost !== void 0 && cost.input > 0;
};
const hideResponsesRoute = (ctx, config, options = {}) => {
	const { llm } = ctx;
	if (llm === void 0) return;
	const { listConfigurableProviders: originalListConfigurableProviders, listModels: originalListModels, listProviders: originalListProviders } = llm;
	if (typeof originalListProviders !== "function" && typeof originalListConfigurableProviders !== "function" && typeof originalListModels !== "function") return;
	if (typeof originalListProviders === "function") registeredRoutes = {
		list: originalListProviders,
		receiver: llm
	};
	const patched = {};
	if (typeof originalListProviders === "function") patched.listProviders = function listProviders() {
		return withoutRoute(Reflect.apply(originalListProviders, this, []), "id");
	};
	if (typeof originalListConfigurableProviders === "function") patched.listConfigurableProviders = function listConfigurableProviders() {
		return withoutRoute(Reflect.apply(originalListConfigurableProviders, this, []), "provider");
	};
	if (typeof originalListModels === "function") patched.listModels = async function listModels(provider) {
		if (isInternalRoute(provider)) return [];
		const models = await Reflect.apply(originalListModels, this, [provider]);
		if (!Array.isArray(models)) return models;
		if (models.length === 0 && isPlaneRoute(provider)) {
			const declared = declaredProviderModels(ctx, provider);
			if (declared !== void 0 && declared.length > 0) return declared.map((entry) => ({
				id: entry.id,
				name: entry.name ?? entry.id,
				provider
			}));
		}
		const servable = models.filter((model) => !isRecord(model) || isServableModel(model.id, provider));
		if (options.hasCredential === void 0 || !isPlaneRoute(provider)) return servable;
		if (await options.hasCredential(provider)) return servable;
		const plane = catalogPlaneForRoute(provider);
		return servable.filter((model) => {
			if (!isRecord(model)) return true;
			const { id } = model;
			return typeof id !== "string" || !costsMoney(plane, id);
		});
	};
	const installed = [];
	const restoreFrom = {
		listConfigurableProviders: originalListConfigurableProviders,
		listModels: originalListModels,
		listProviders: originalListProviders
	};
	try {
		for (const [key, value] of Object.entries(patched)) {
			Reflect.set(llm, key, value);
			installed.push(key);
		}
	} catch {
		for (const key of installed) Reflect.set(llm, key, restoreFrom[key]);
		return;
	}
	return () => {
		for (const key of installed) if (Reflect.get(llm, key) === patched[key]) Reflect.set(llm, key, restoreFrom[key]);
	};
};
/**
* Wrap the Host’s model-discovery method so “fetch available models” answers
* for claimed OpenCode routes include the canonical catalog’s missing rows
* and omit its provider-scoped retired rows.
*
* The original method keeps ownership of errors, cancellation, and every
* unclaimed route. The returned disposer restores it.
*/
const decorateModelDiscovery = (ctx, config) => {
	if (!config.enrichModels) return;
	const { llm } = ctx;
	if (llm === void 0 || typeof llm.discoverModels !== "function") return;
	const discover = llm.discoverModels;
	const decorated = async (settingsNs, request, signal) => {
		const discovered = await Reflect.apply(discover, llm, [
			settingsNs,
			request,
			signal
		]);
		const provider = resolveDiscoveryProvider(request, config);
		if (provider === void 0) return discovered;
		return mergeDiscoveredModels(discovered, provider);
	};
	try {
		llm.discoverModels = decorated;
	} catch {
		return;
	}
	return () => {
		if (llm.discoverModels === decorated) llm.discoverModels = discover;
	};
};
/** Every pi thinking level, in escalation order, `off` first. */
const PI_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The reasoning efforts DSH renders for one model, read off the SAME
* thinking-level map the routes dispatch on.
*
* One rule, so a level the composer offers is a level the model answers: a
* level the map pins to `null` is not offered, and every other level is. The
* wire spelling is NOT carried — an adapter's effort `id` is the pi level, and
* `resolveReasoningLevel` matches it by that name before the adapter translates
* it, so re-spelling it here would make the composer offer an effort the
* resolver refuses.
*
* @param map - the model's `thinkingLevelMap`.
* @returns the efforts, in escalation order.
*/
const effortsFromLevelMap = (map) => PI_THINKING_LEVELS.filter((level) => map[level] !== null).map((level) => ({
	id: level,
	name: level === "off" ? "Off" : `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}));
/**
* The vendor's retired plane bases, as they appear in pi's installed catalog and
* in profiles written before the per-family move.
*
* Only these are rewritten. Matching a path rather than an origin keeps a
* deployment's own proxy out of it: `https://gateway.internal/zen/v1` is not this
* vendor's endpoint and is none of our business.
*
* The list is DERIVED from {@link LEGACY_PLANE_API}, not written out here. It was
* written out here, and it carried only the Zen plane — so a profile declaring
* `…/zen/v1` was repaired to the inference family while one declaring
* `…/zen/go/v1`, the older address of the *other* plane, was left alone. Under
* `endpoint: auto` both are "follow the catalog", and the second plane's old
* address was quietly exempt: measured, both families answer 200 on Go, so the
* only thing the omission bought was one plane drifting behind the other.
*
* The bare `…/zen` entry is the alias pi's own installed catalog still ships,
* which the plane table writes with its version segment.
*/
const LEGACY_PLANE_BASES = /* @__PURE__ */ new Set(["https://opencode.ai/zen", ...Object.values(LEGACY_PLANE_API)]);
/** Whether a value is a usable token count. */
const usableWindow = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
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
const resolveEffectiveContextWindow = (requestedWindow, maxCeiling) => {
	const base = usableWindow(requestedWindow) ? requestedWindow : 0;
	return usableWindow(maxCeiling) ? Math.min(base, maxCeiling) : base;
};
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
const decoratePlaneAdapters = (llm, config) => {
	const { adapters } = llm ?? {};
	if (!(adapters instanceof Map)) return;
	const restored = [];
	for (const [route, registration] of adapters) {
		const adapter = registration?.adapter;
		if (adapter === void 0 || adapter === null) continue;
		if (!(route in PLANES)) continue;
		const plane = catalogPlaneForRoute(route);
		for (const method of ["resolveModel", "prepareCall"]) {
			const original = adapter[method];
			if (typeof original !== "function") continue;
			const wrapped = async (provider, model, signal) => {
				if (provider === "opencode-go" && internalRouteFor(provider, model, findModelSpecOn("go", model)?.provider_npm, config.modelRoutes[model]?.api) === "opencode-go-google") {
					const target = adapters.get(GO_GOOGLE_INTERNAL_ROUTE)?.adapter;
					const resolve = target?.[method];
					if (target !== void 0 && typeof resolve === "function") {
						const prepared = await Reflect.apply(resolve, target, [
							GO_GOOGLE_INTERNAL_ROUTE,
							model,
							signal
						]);
						if (isRecord(prepared)) return method === "prepareCall" && isRecord(prepared.model) ? {
							...prepared,
							model: {
								...prepared.model,
								provider
							}
						} : {
							...prepared,
							provider
						};
						return prepared;
					}
				}
				const answered = await Reflect.apply(original, adapter, [
					provider,
					model,
					signal
				]);
				const spec = findModelSpecOn(plane, model);
				if (spec === void 0) return answered;
				const override = config.modelOverrides[model];
				const record = isRecord(answered) ? answered : {};
				const existingContext = isRecord(record.context) ? record.context : {};
				const declaredWindow = override?.contextWindow ?? (typeof existingContext.contextWindow === "number" ? existingContext.contextWindow : void 0) ?? spec.context_window;
				const effectiveWindow = declaredWindow > 0 ? resolveEffectiveContextWindow(declaredWindow, config.maxContextWindow) : void 0;
				const modelName = override?.name ?? (typeof record.name === "string" ? record.name : spec.name);
				const { defaultMaxTokens: recordMaxTokens } = record;
				let inputModalities = sanitizeModalities(spec.input_modalities);
				if (override?.inputModalities !== void 0) inputModalities = [...override.inputModalities];
				else if (Array.isArray(record.inputModalities)) inputModalities = sanitizeModalities(record.inputModalities);
				let defaultMaxTokens;
				if (override?.maxTokens !== void 0) defaultMaxTokens = override.maxTokens;
				else if (typeof recordMaxTokens === "number") defaultMaxTokens = recordMaxTokens;
				else if (spec.max_output_tokens > 0) defaultMaxTokens = spec.max_output_tokens;
				let supports;
				if (override?.reasoningEfforts !== void 0) supports = override.reasoningEfforts.map((id) => ({
					id,
					name: id === "off" ? "Off" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`
				}));
				else if (record.reasoning === void 0) {
					const map = thinkingLevelMapFor(spec);
					if (map !== void 0) supports = effortsFromLevelMap(map);
				}
				const outRecord = {
					...record,
					inputModalities,
					name: modelName
				};
				if (record.provider === void 0) outRecord.provider = provider;
				if (record.id === void 0) outRecord.id = model;
				if (effectiveWindow !== void 0) outRecord.context = {
					...existingContext,
					contextWindow: effectiveWindow
				};
				if (defaultMaxTokens !== void 0) outRecord.defaultMaxTokens = defaultMaxTokens;
				if (supports !== void 0 && supports.length > 0) outRecord.reasoning = { efforts: supports };
				const declaredRoute = config.modelRoutes[model];
				const protocol = declaredRoute?.api ?? protocolFor(spec);
				if (protocol !== void 0) outRecord.api = protocol;
				const existingBase = typeof record.baseUrl === "string" ? record.baseUrl.trim().replace(/\/+$/u, "") : void 0;
				const legacyBase = existingBase !== void 0 && LEGACY_PLANE_BASES.has(existingBase);
				const keepExisting = existingBase !== void 0 && !legacyBase && protocol !== void 0;
				const measured = protocol === void 0 ? void 0 : baseForProtocol(route, protocol, config.endpoint);
				const baseURL = declaredRoute?.baseURL ?? (keepExisting ? existingBase : measured);
				if (baseURL !== void 0) outRecord.baseUrl = baseURL;
				return outRecord;
			};
			adapter[method] = wrapped;
			restored.push(() => {
				adapter[method] = original;
			});
		}
		const originalModelOf = adapter.modelOf;
		if (typeof originalModelOf === "function") {
			const wrappedModelOf = (snapshot, provider, model) => {
				const answered = Reflect.apply(originalModelOf, adapter, [
					snapshot,
					provider,
					model
				]);
				if (!isRecord(answered)) return answered;
				const spec = findModelSpecOn(plane, model);
				if (spec === void 0) return answered;
				const override = config.modelOverrides[model];
				const levels = override?.reasoningEfforts === void 0 ? thinkingLevelMapFor(spec) : Object.fromEntries(override.reasoningEfforts.map((id) => [id, id]));
				if (levels === void 0 || Object.keys(levels).length === 0) return answered;
				const declared = isRecord(answered.thinkingLevelMap) ? answered.thinkingLevelMap : {};
				const taken = (level) => {
					if (answered.reasoning !== true) return false;
					const entry = declared[level];
					if (entry === null) return false;
					return level === "xhigh" || level === "max" ? entry !== void 0 : true;
				};
				const merged = { ...declared };
				let filled = false;
				for (const [level, wire] of Object.entries(levels)) {
					if (wire === null || taken(level)) continue;
					merged[level] = wire;
					filled = true;
				}
				if (!filled) return answered;
				return {
					...answered,
					reasoning: true,
					thinkingLevelMap: merged
				};
			};
			adapter.modelOf = wrappedModelOf;
			restored.push(() => {
				adapter.modelOf = originalModelOf;
			});
		}
	}
	if (restored.length === 0) return;
	return () => {
		for (const undo of restored.toReversed()) undo();
	};
};
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
const decorateModelInfo = (ctx, config) => {
	if (!config.enrichModels) return;
	const { llm } = ctx;
	if (llm === void 0 || typeof llm.resolveModelInfo !== "function") return;
	const original = llm.resolveModelInfo;
	const decorated = async (provider, model, signal) => {
		let resolved;
		try {
			resolved = await Reflect.apply(original, llm, [
				provider,
				model,
				signal
			]);
		} catch (error) {
			const spec = findModelSpecOn(catalogPlaneForRoute(provider), model);
			if (isInternalRoute(provider) || spec === void 0) throw error;
			resolved = {};
		}
		if (isInternalRoute(provider)) return resolved;
		const spec = findModelSpecOn(catalogPlaneForRoute(provider), model);
		if (spec === void 0) return resolved;
		const out = isRecord(resolved) ? { ...resolved } : {};
		const override = config.modelOverrides[model];
		const existingContext = isRecord(out.context) ? out.context : {};
		const requestedWindow = override?.contextWindow;
		if (typeof spec.context_window === "number" && spec.context_window > 0) {
			const effectiveWindow = resolveEffectiveContextWindow(requestedWindow ?? spec.context_window, config.maxContextWindow);
			out.context = {
				...existingContext,
				contextWindow: effectiveWindow
			};
		}
		if (override?.maxTokens !== void 0) out.defaultMaxTokens = override.maxTokens;
		else if (typeof spec.max_output_tokens === "number" && spec.max_output_tokens > 0) out.defaultMaxTokens = spec.max_output_tokens;
		if (override?.name !== void 0) out.name = override.name;
		if (override?.inputModalities !== void 0) out.inputModalities = [...override.inputModalities];
		if (override?.reasoningEfforts === void 0) {
			const map = thinkingLevelMapFor(spec);
			const efforts = map === void 0 ? [] : effortsFromLevelMap(map);
			if (efforts.length > 0) out.reasoning = { efforts };
			else delete out.reasoning;
		} else out.reasoning = { efforts: override.reasoningEfforts.map((id) => ({
			id,
			name: id === "off" ? "Off" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`
		})) };
		return out;
	};
	try {
		llm.resolveModelInfo = decorated;
	} catch {
		return;
	}
	return () => {
		if (llm.resolveModelInfo === decorated) llm.resolveModelInfo = original;
	};
};
//#endregion
//#region src/opencode-store-contract.ts
/**
* Contract for inspecting a local OpenCode installation's credentials.
*
* Pure data types, no I/O, no context, safely imported by host and client.
*
* @module dsh-opencode-patch/opencode-store-contract
*/
const STORE_NAMESPACE = "opencodeStore";
//#endregion
//#region src/opencode-store-service.ts
/**
* Remote service for inspecting a local OpenCode installation.
*
* Answers the settings card's "check this machine" question: is there an OpenCode
* credential store here, which account does it belong to, and is it still valid?
*
* Two rules shape it, and both are about what must NOT leave the host:
*
* 1. **No secret ever crosses the seam.** The answer is a sanitized summary —
*    email, org, credential kind, expiry — and never the token. The reader it
*    calls ({@link inspectOpencodeStore}) is built the same way, so there is no
*    intermediate value to leak.
* 2. **No machine layout either.** The database path is rewritten to `~`-relative
*    before it is returned: the card shows WHERE it looked, which is useful, but
*    a home directory is a fact about this machine and not about the plugin.
*
* @module dsh-opencode-patch/opencode-store-service
*/
var OpencodeStoreService = class extends TypertRemoteService {
	constructor(ctx, options) {
		if (!isRecord(ctx)) throw new TypeError("OpencodeStoreService requires a Cordis context object");
		super(ctx, STORE_NAMESPACE);
		const { resolveStorePath } = isRecord(options) ? options : {};
		this.resolveStorePath = typeof resolveStorePath === "function" ? resolveStorePath : defaultStorePath;
	}
	/**
	* Where the installation's database lives, as a function rather than a value:
	* it depends on the ambient home and environment, which belong to the process
	* at call time. Injectable so a test can point it at a fixture database
	* without an OpenCode installation.
	*/
	resolveStorePath;
	/** Summarize the installation's stored credential, without the credential. */
	inspect() {
		const result = inspectOpencodeStore(this.resolveStorePath());
		return Promise.resolve({
			...result,
			path: shownPath(result.path)
		});
	}
};
/**
* The store path, made safe to show.
*
* The card may say WHERE it looked — that is what turns a not-found answer into
* something the reader can act on — but a home directory is a fact about this
* machine and not about the plugin. So a path under the home directory becomes
* `~`-relative, and one anywhere else keeps only its basename: `$OPENCODE_DB`
* can point outside the home tree, and that case must not leak the rest of it.
*
* @param path - the absolute path the reader opened, when it reported one.
* @returns the displayable path, or `undefined` when there was none.
*/
const shownPath = (path) => {
	if (path === void 0) return;
	const home = os.homedir();
	if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
};
/** The database path the local installation itself would use. */
const defaultStorePath = () => opencodeDatabasePath({
	channel: process.env.OPENCODE_CHANNEL,
	env: process.env,
	home: os.homedir()
}, os.tmpdir());
/**
* Declare `inspect` as a Remote method. See `usage.ts` for why the decorator
* cannot be used in this build: the oxc/rolldown transform rejects TC39 decorator
* syntax outright, and the marker it would write is a plain property.
*/
Object.defineProperty(OpencodeStoreService.prototype, "@deepseek-ai/dsh-typert-protocol/remote-methods", {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze([{
			method: "inspect",
			invocation: { kind: "direct" }
		}])
	})
});
//#endregion
//#region src/purge-contract.ts
/** The one failure a purge reports: the profile cannot be rewritten here. */
const PURGE_UNAVAILABLE = "opencode/purge-unavailable";
//#endregion
//#region src/purge-service.ts
/**
* Host-side "purge deprecated models": rewrites the deployment's own provider
* declaration, deleting the model entries the live catalog has retired.
*
* **Why it edits the profile instead of filtering at read time.** A filter keeps
* a second list of "what the user really means", and that list is invisible: the
* configuration still declares the model, the log still reports it, and the only
* way to learn why a row is missing is to find the filter. Deleting the entry
* leaves one source of truth — the profile — and the model is gone from every
* surface because it is no longer declared anywhere.
*
* The write goes through `configEditor`, the same service the settings UI uses:
* it validates the next config, persists it atomically under the profile's file
* lock, and lets the Loader reconcile the change. Nothing here writes YAML.
*
* @module dsh-opencode-patch/purge-service
*/
/** A provider route the plugin knows how to read a plane from. */
const PLANES$1 = [{
	route: "opencode",
	plane: "zen"
}, {
	route: "opencode-go",
	plane: "go"
}];
const asEditor = (value) => {
	if (!isRecord(value)) return;
	const { entries, edit } = value;
	if (typeof entries !== "function" || typeof edit !== "function") return;
	return value;
};
/** The models a provider block declares, whatever shape the row uses. */
const modelsOf = (provider) => {
	if (!isRecord(provider)) return;
	const { models } = provider;
	return Array.isArray(models) ? models : void 0;
};
/** One model row's id, when it is a row rather than a bare string. */
const idOf = (model) => {
	if (typeof model === "string") return model;
	if (isRecord(model) && typeof model.id === "string") return model.id;
};
/**
* Whether `id` is retired on a route this plugin owns.
*
* A route this plugin does not own answers `false`: another vendor's model ids
* are not ours to retire, and guessing would delete references we cannot check.
*
* @param route - the provider route, as the profile spells it.
* @param id - the model id.
* @returns whether our catalog has retired it.
*/
const isRetiredOnOwnedRoute = (route, id) => {
	const plane = PLANES$1.find((candidate) => candidate.route === route)?.plane;
	return plane !== void 0 && isDeprecatedModelOn(plane, id);
};
/**
* Remove every reference to a retired model from one entry's config.
*
* PURE, and exported because this is the half that used to be missing: `purge()`
* rewrote `providers.<route>.models` and nothing else, so a retired id could
* disappear from the picker while remaining the compaction summariser — the
* button said "3 models removed" and left a session-breaking reference behind.
*
* Two reference shapes exist in a DSH profile:
*
* 1. `allowedModels: [{ provider, model }]` — the subagent tool's selection.
* 2. `summarizationProvider` / `summarizationModel` — compaction's summariser,
*    which is a PAIR: removing the model and leaving the provider would ask for a
*    default model on a named route, so both keys go and the entry falls back to
*    its own defaults.
*
* @param config - the entry's config, verbatim.
* @param isRetired - whether this plugin's catalog has retired `id` on `provider`.
* @returns the config to write (unchanged when nothing matched), and what went.
*/
const stripRetiredReferences = (config, isRetired) => {
	const removed = [];
	let next = config;
	const { allowedModels } = config;
	if (Array.isArray(allowedModels)) {
		const kept = allowedModels.filter((row) => {
			if (!isRecord(row)) return true;
			const { model, provider } = row;
			if (typeof model !== "string" || typeof provider !== "string") return true;
			if (!isRetired(provider, model)) return true;
			removed.push({
				id: model,
				provider,
				site: "subagent"
			});
			return false;
		});
		if (kept.length !== allowedModels.length) next = {
			...next,
			allowedModels: kept
		};
	}
	const provider = config.summarizationProvider;
	const model = config.summarizationModel;
	if (typeof provider === "string" && typeof model === "string" && isRetired(provider, model)) {
		const { summarizationModel: _model, summarizationProvider: _provider, ...rest } = next;
		removed.push({
			id: model,
			provider,
			site: "summarizer"
		});
		next = rest;
	}
	return {
		next,
		removed
	};
};
var ModelPurgeService = class extends TypertRemoteService {
	constructor(ctx) {
		if (!isRecord(ctx)) throw new TypeError("ModelPurgeService requires a Cordis context object");
		super(ctx, "opencodeModelPurge");
	}
	/**
	* Delete every declared model the live catalog marks `deprecated`.
	*
	* One network read first, forced: the shipped shim cannot answer this
	* question, because a retired model is dropped from the active catalog rather
	* than kept with a flag. `catalogRead` reports whether that read landed, so the
	* card can say "the catalog reports none" instead of implying it when the
	* refresh failed.
	*/
	async purge() {
		const editor = asEditor(this.ctx.get?.("configEditor"));
		if (editor === void 0) throw new RemoteError(PURGE_UNAVAILABLE, "This composition has no config editor, so the profile cannot be rewritten", {
			configured: false,
			retainPrevious: false,
			retryable: false
		});
		await refreshCatalog(void 0, true);
		const catalogRead = didCatalogRefreshSucceed();
		const entries = editor.entries().filter((entry) => {
			const config = isRecord(entry) ? entry.options : void 0;
			const options = isRecord(config) ? config : void 0;
			const raw = isRecord(options?.config) ? options.config : void 0;
			const providers = isRecord(raw?.providers) ? raw.providers : void 0;
			return providers !== void 0 && PLANES$1.some(({ route }) => isRecord(providers[route]));
		});
		if (entries.length === 0) throw new RemoteError(PURGE_UNAVAILABLE, "No profile entry declares an opencode provider, so there is nothing to purge", {
			configured: false,
			retainPrevious: false,
			retryable: false
		});
		const removed = [];
		for (const entry of entries) {
			const entryRemoved = [];
			await editor.edit(entry, (current) => {
				const providers = isRecord(current.providers) ? { ...current.providers } : {};
				for (const { route, plane } of PLANES$1) {
					const declared = modelsOf(providers[route]);
					if (declared === void 0) continue;
					const kept = declared.filter((model) => {
						const id = idOf(model);
						if (id === void 0 || !isDeprecatedModelOn(plane, id)) return true;
						entryRemoved.push({
							provider: route,
							id
						});
						return false;
					});
					if (kept.length !== declared.length) providers[route] = {
						...providers[route],
						models: kept
					};
				}
				return {
					...current,
					providers
				};
			});
			removed.push(...entryRemoved);
		}
		for (const entry of editor.entries()) {
			const options = isRecord(entry) ? entry.options : void 0;
			const config = isRecord(options) ? options.config : void 0;
			if (!isRecord(config)) continue;
			if (stripRetiredReferences(config, isRetiredOnOwnedRoute).removed.length === 0) continue;
			const entryRemoved = [];
			await editor.edit(entry, (current) => {
				const { next, removed: gone } = stripRetiredReferences(current, isRetiredOnOwnedRoute);
				entryRemoved.push(...gone);
				return next;
			});
			removed.push(...entryRemoved);
		}
		return {
			removed,
			catalogRead
		};
	}
};
/**
* Declare `purge` as a Remote method. See `usage.ts` for why the decorator
* cannot be used in this build.
*/
Object.defineProperty(ModelPurgeService.prototype, "@deepseek-ai/dsh-typert-protocol/remote-methods", {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze([{
			method: "purge",
			invocation: { kind: "direct" }
		}])
	})
});
//#endregion
//#region src/attachment-services.ts
/** Capture an optional service through a real Cordis child scope. */
const optionalService = (ctx, name) => {
	let current;
	let subscription;
	if (isRecord(ctx) && isFunctionLike(ctx.inject)) subscription = Reflect.apply(ctx.inject, ctx, [[name], (scope) => {
		if (!isRecord(scope) || !isFunctionLike(scope.get)) return;
		const service = Reflect.apply(scope.get, scope, [name]);
		current = service;
		if (isFunctionLike(scope.effect)) Reflect.apply(scope.effect, scope, [() => () => {
			if (current === service) current = void 0;
		}, "google bridge: optional attachment service"]);
	}]);
	return {
		get: () => current,
		dispose: () => {
			current = void 0;
			if (isRecord(subscription) && isFunctionLike(subscription.dispose)) Reflect.apply(subscription.dispose, subscription, []);
		}
	};
};
/** Match the host adapter's durable-image hooks without requiring images for text calls. */
const attachmentResolvers = (ctx) => {
	const attachments = optionalService(ctx, "attachments");
	const filesystem = optionalService(ctx, "fs");
	return {
		resolveAttachments: attachments.get,
		resolveImageAccess: (store, ref) => {
			const fs = filesystem.get();
			if (!isRecord(store) || !isFunctionLike(store.imageHostPath) || !isRecord(fs) || !isFunctionLike(fs.processPathFromHostPath)) return void 0;
			const hostPath = Reflect.apply(store.imageHostPath, store, [ref]);
			if (typeof hostPath !== "string") return void 0;
			const readonlyPath = Reflect.apply(fs.processPathFromHostPath, fs, [hostPath]);
			return typeof readonlyPath === "string" ? { readonlyPath } : void 0;
		},
		dispose: () => {
			attachments.dispose();
			filesystem.dispose();
		}
	};
};
//#endregion
//#region src/google-bridge.ts
/**
* The bridge: a route this plugin registers through its own adapter, for a
* protocol the wrapper's hand-declared table refuses to name.
*
* Why this module exists is a chain of closed doors, each one measured:
*
* - A hand-declared route may only name a protocol in the wrapper's table, and
*   that table does not carry `google-generative-ai`. Its own comment calls the
*   omission "for want of a consumer rather than a blocker" — one line, once a
*   deployment needs it — but this plugin cannot add that line: the table is a
*   module-private constant, unreachable from outside.
* - A catalog route reaches every protocol, but only under the catalog
*   provider's own name, and `opencode` is taken by whatever the deployment
*   declared. Reusing pi's `google` catalog provider would work — measured,
*   end to end — but registering the name `google` would take it away from a
*   deployment that wants the real Google AI Studio under it. That trade is
*   not ours to make, which is why this route is `opencode-google` and stays
*   internal: the picker lists its models under the plane route, and the
*   stream hook dispatches the call here.
* - Handing the route back (`handle.replace`) needs the registration handle of
*   whoever owns `opencode`, and a plugin that loads after the wrapper never
*   sees that handle.
*
* So the route is served by an adapter this plugin builds and registers on the
* real `llm` service — but the adapter is the wrapper's own class
* (`PiAiAdapter`, reached through the loader), and the wire protocol is pi's
* own implementation, so nothing about the request shape is reinvented here.
*
* The one runtime pi import in this entire plugin is resolved HERE, at runtime,
* and deliberately not declared as a dependency.
*
* **Why not a dependency.** The harness wrapper (`dsh-llm-pi-ai`) already
* depends on `@earendil-works/pi-ai` with a RANGE (`^1.1.0`), so the host
* installs exactly the pi its own release was tested against — 1.3.0 for
* `0.2.1-alpha.5`, whatever the next harness line moves it to. Declaring the
* same package as an exact dependency here puts a SECOND pi in the tree and
* turns every harness bump into a version-skew bug: the worst measured shape is
* a degraded Google route whose error names the model rather than the version.
*
* So the rule is the user's own: *use whatever the harness provides*. The
* lookup below asks the harness which pi that is, from the wrapper's own
* location (its `package.json` declares the range; node's lookup from there
* finds the installed copy), so the bridge always wires the same implementation
* the wrapper mounts — one instance, one version, no pin to chase.
*
* The plugin's own copy stays in `devDependencies`, for the unit tests and for
* this repo's own development, and is never what a deployment loads.
*
* pi's `exports` map declares `types` and `import` only — no `require` — so this
* resolves by walking node's own pnpm/node_modules layout rather than with
* `createRequire`, which would only ever see the `require` condition and miss.
*
* The same construction would serve `@ai-sdk/mistral`: pi implements
* `mistral-conversations`, and a bridge on this pattern is one lazy import
* away. It is not built, because that dialect at the gateway is unmeasured and
* no entitled key exists to measure it — the decision lives in
* `UNSERVED_SDKS`, with this module as the record of how it would be served.
*
* @module dsh-opencode-patch/google-bridge
*/
/** The wrapper whose own dependency tree names the pi the host installed. */
const WRAPPER_PACKAGE = "@deepseek-ai/dsh-llm-pi-ai";
/** The two module paths the bridge needs, relative to a pi package root. */
const PI_GOOGLE_API = "dist/api/google-generative-ai.lazy.js";
const PI_PROVIDERS_ALL = "dist/providers/all.js";
/**
* Where the installed pi lives, found by walking node's lookup from the
* WRAPPER's own directory.
*
* The wrapper declares pi as a dependency, so the copy node would hand IT is
* the copy every other consumer in that tree gets — which is the whole point.
* The walk is explicit because pnpm's layout is not a plain `node_modules`
* beside the package: the wrapper's dependencies live in the `.pnpm` hosting
* directory above it (or in a hoisted store beside it), and under a `link:` or
* `file:` install they live somewhere else again. Walking the parent chain and
* testing for the package is the one rule that covers all of them without
* encoding a package-manager layout.
*
* @returns the pi package ROOT, or `undefined` when the wrapper cannot be
*   located or carries no pi.
*/
const installedPiRoot = () => {
	let wrapperEntry;
	try {
		wrapperEntry = import.meta.resolve(WRAPPER_PACKAGE);
	} catch {
		wrapperEntry = void 0;
	}
	if (wrapperEntry === void 0) return;
	let dir = path.dirname(realpathSync(fileURLToPath(wrapperEntry)));
	for (let depth = 0; depth < 8; depth += 1) {
		const candidate = path.join(dir, "node_modules", "@earendil-works", "pi-ai");
		if (existsSync(path.join(candidate, "package.json"))) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
};
/**
* The pi the HOST installed, loaded once.
*
* Everything the bridge needs from pi comes through this record, so a harness
* that bumps pi changes the wire implementation the route speaks and nothing
* else about the bridge: the adapter, the profile and the models are this
* plugin's own objects, and pi reads fields off them rather than checking
* identity.
*
* @returns the runtime, or `undefined` when the host's pi is not reachable —
*   in which case the bridge simply does not mount, and says so on the console.
*/
const loadHostPi = async () => {
	const root = installedPiRoot();
	if (root === void 0) return;
	try {
		const manifest = readFileSync(path.join(root, "package.json"), "utf-8");
		const [googleApi, providersAll] = await Promise.all([import(pathToFileURL(path.join(root, PI_GOOGLE_API)).href), import(pathToFileURL(path.join(root, PI_PROVIDERS_ALL)).href)]);
		const googleApiModule = googleApi;
		const providersModule = providersAll;
		if (!isRecord(googleApiModule) || !isRecord(providersModule)) return;
		const { googleGenerativeAIApi } = googleApiModule;
		const { getBuiltinModels } = providersModule;
		if (typeof googleGenerativeAIApi !== "function" || typeof getBuiltinModels !== "function") return;
		const manifestData = JSON.parse(manifest);
		return {
			getBuiltinModels,
			googleGenerativeAIApi: () => googleGenerativeAIApi(),
			version: isRecord(manifestData) && typeof manifestData.version === "string" ? manifestData.version : ""
		};
	} catch {
		return;
	}
};
/** Go's Google protocol has no endpoint on the legacy Zen API. */
const GO_GOOGLE_BASE_URL = "https://opencode.ai/inference/go/google/v1beta";
const googleRouteFor = (plane) => plane === "opencode-go" ? GO_GOOGLE_INTERNAL_ROUTE : GOOGLE_INTERNAL_ROUTE;
/** The host adapter's default: five minutes without a chunk. */
const STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* The request-level image budget a route defaults to, read from the wrapper's
* own constants: twenty MiB of base64 payload, 2048 by 2048 pixels, and one
* MiB as the per-image byte target after the quality ladder.
*/
const MAX_REQUEST_IMAGE_BYTES = 20971520;
const REQUEST_IMAGE_PIXEL_BUDGET = 4194304;
const REQUEST_IMAGE_MAX_BYTES = 1048576;
/**
* The retry policy a route carries when its deployment configured none, read
* from the harness's own defaults: five retries over `EMPTY_RESPONSE`,
* `RATE_LIMIT`, `SERVER`, `TIMEOUT` and `TRANSPORT`, backing off from half a
* second to ten with a tenth of jitter.
*/
const gatewayRetryPolicy = () => Object.freeze({
	mode: "normal",
	maxRetries: 5,
	retryableCodes: [
		"EMPTY_RESPONSE",
		"RATE_LIMIT",
		"SERVER",
		"TIMEOUT",
		"TRANSPORT"
	],
	initialDelayMs: 500,
	maxDelayMs: 1e4,
	jitterRatio: .1
});
const emptyCredentialStore = () => ({
	delete: () => Promise.resolve(),
	list: () => Promise.resolve([]),
	modify: (_providerId, fn) => fn(),
	read: () => Promise.resolve()
});
const ambientAuthContext = () => ({
	env: (name) => Promise.resolve(process.env[name]),
	fileExists: () => Promise.resolve(false)
});
/**
* pi's installed catalog entry for one model on one plane, or undefined when
* pi does not know it.
*
* The bridge builds its models by hand rather than reusing a catalog route, so
* this is where the entry the installed provider already carries comes back:
* the compatibility switches, the `reasoning` flag, the thinking-level map and
* the input limits are all things pi knows and this module does not, and a model
* built without them would serve requests with those behaviours silently off.
* Spreading that entry is what the wrapper's own materialization does.
*
* @param pi - the host's pi runtime.
* @param plane - the gateway plane, which is also pi's provider id.
* @param id - the model id.
* @returns the installed entry, or undefined when the catalog lacks it.
*/
const installedEntryFor = (pi, plane, id) => pi.getBuiltinModels(plane).find((model) => model.id === id);
/**
* The provider this route serves: pi's Google wire implementation carrying our
* catalog's Gemini models.
*
* Built by hand, the same way the wrapper's own `reuseCatalogProvider` builds
* one — a provider is a record pi dispatches through, not a class it
* instantiates. `getModels` returns the models of the Zen plane whose SDK is
* `@ai-sdk/google`, each carrying the base URL this protocol uses on that
* plane (`…/zen/v1`), so the request lands on
* `…/zen/v1/models/<id>:streamGenerateContent`.
*
* The streams are pi's raw implementation. The session, client, project and
* User-Agent headers are NOT added here: the fetch patch already restores all
* of them for every gateway-matched request, measured to override rather than
* append, so the bridge would only duplicate that work.
*
* @param specs - the catalogued models the route serves.
* @param family - the endpoint family to send them to; the catalog's own
*   address by default.
* @returns the provider the adapter's collection will hold.
*/
const googleProviderFor = (pi, specs, family = "auto", plane = "opencode") => {
	const route = googleRouteFor(plane);
	const api = pi.googleGenerativeAIApi();
	const models = specs.map((spec) => ({
		...piModelFor(plane, spec, "google-generative-ai", installedEntryFor(pi, plane, spec.id), family),
		...plane === "opencode-go" ? { baseUrl: GO_GOOGLE_BASE_URL } : {},
		provider: route
	}));
	return {
		auth: { apiKey: {
			name: "OpenCode API key",
			/**
			* Hand the key pi's auth resolver asks for back to the protocol.
			*
			* pi never reads the credential itself: it resolves the provider's
			* `auth.apiKey.resolve`, puts the `auth` this returns into the stream
			* options, and the Google implementation reads `options.apiKey` from
			* there. So a provider that declares only a name never authenticates —
			* every request fails with "API key auth failed for provider …: apiKey.
			* resolve is not a function" before a socket is opened, which is
			* exactly what the stream-path test caught.
			*
			* It returns the value rather than a promise for it: pi awaits the
			* result either way, and there is nothing here to wait for.
			*
			* The key arrives in the credential, because the adapter resolved it
			* through this plugin's own `resolveApiKey` — the credentials service
			* first, the launch environment second — and passed it as the request's
			* `apiKey` override. Returning that is the whole job. The empty case
			* throws rather than returning nothing: a silent `undefined` would send
			* an unauthenticated request and answer with a gateway error that says
			* the key is missing, rather than saying this plugin could not find one.
			*/
			resolve: (input) => {
				const key = input.credential?.key;
				if (key === void 0 || key.length === 0) throw new Error(`${route} reached pi's auth resolver without a key`);
				return {
					auth: { apiKey: key },
					source: "the plugin's resolved key"
				};
			}
		} },
		getModels: () => models,
		id: route,
		name: plane === "opencode-go" ? "OpenCode Go (Google)" : "OpenCode (Google)",
		stream: (model, context, options) => api.stream(model, context, options),
		streamSimple: (model, context, options) => api.streamSimple(model, context, options)
	};
};
/**
* Resolve one credential reference the way every route this plugin serves
* does: through the credentials service, with the launch environment as
* fallback, and a miss that fails loud.
*
* A miss must not return `undefined` for a named reference: pi treats a
* request-level `undefined` as "resolve ambient auth instead", which would
* pick up an unrelated key — `OPENAI_API_KEY` and friends — and bill another
* tenant for a request this route meant to authenticate differently.
*
* @param ctx - host context carrying the credentials service.
* @param ref - the credential reference, when the profile names one.
* @param route - the route asking, for the failure's message.
* @returns the resolved key, or `undefined` only when no reference was named.
* @throws {Error} when a named reference resolves to nothing.
*/
const resolveGatewayKey = async (ctx, ref, route) => {
	if (typeof ref !== "string" || ref.length === 0) return;
	const hit = (await readCredentialsResolver(ctx)?.(ref))?.value ?? process.env[ref];
	if (typeof hit === "string" && hit.length > 0) return hit;
	throw new Error(`[dsh-opencode-patch] no credential for provider route "${route}"; it resolves ${ref}, which is not set — store ${ref} through the credentials service or export it, and remove the reference only if this route should authenticate some other way (MISSING_CREDENTIAL)`);
};
/**
* Register the Google bridge route on the real `llm` service.
*
* Nothing about this depends on the wrapper's mount: the adapter is the
* wrapper's own class, but it comes from the loaded module, so a deployment
* that declares every protocol route in its profile still gets the Gemini
* models — they were the one protocol a declared route could never name.
*
* The resolution is the plugin's default: the inherited
* reference, resolved through the credentials service with the launch
* environment as fallback. A miss fails loud, because handing pi `undefined`
* for a named reference would let it pick up an unrelated ambient key and
* bill another tenant.
*
* @param inputs - the context, the service, the loaded wrapper, the models
*   and the credential reference.
* @returns the registration handle for the caller to withdraw, or `undefined`
*   when the bridge cannot mount here.
*/
const registerGoogleBridge = (inputs) => {
	const { ctx, host, llm, specs } = inputs;
	const plane = inputs.plane ?? "opencode";
	const routeId = googleRouteFor(plane);
	const adapter = host?.PiAiAdapter;
	if (typeof adapter !== "function" || specs.length === 0) return;
	const provider = googleProviderFor(inputs.pi, specs, inputs.endpoint, plane);
	const profile = {
		apiKeyEnv: inputs.apiKeyRef,
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		displayName: provider.name,
		maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
		modelErrors: /* @__PURE__ */ new Map(),
		piProvider: provider,
		provider: routeId,
		requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
		requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
		retryPolicy: gatewayRetryPolicy(),
		streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS
	};
	const profiles = /* @__PURE__ */ new Map([[routeId, profile]]);
	const resolveApiKey = (route, resolved) => {
		const named = resolved.apiKeyEnv;
		if (typeof named === "string" && named.length > 0) return resolveGatewayKey(ctx, named, String(route));
		return Promise.resolve(resolveOpencodeStoreKey(plane, inputs.readOpencodeStore === true));
	};
	const images = attachmentResolvers(ctx);
	try {
		const built = Reflect.construct(adapter, [{
			auth: {
				authContext: ambientAuthContext(),
				credentials: emptyCredentialStore()
			},
			profiles: () => profiles,
			resolveApiKey,
			resolveAttachments: images.resolveAttachments,
			resolveImageAccess: images.resolveImageAccess
		}]);
		const registration = llm.registerAdapter([routeId], built);
		return () => {
			try {
				if (isFunctionLike(registration)) Reflect.apply(registration, void 0, []);
			} finally {
				images.dispose();
			}
		};
	} catch (error) {
		images.dispose();
		throw error;
	}
};
//#endregion
//#region src/responses-provider.ts
/**
* Serve the gateway's non-default APIs from the plugin, so a model the user
* already picked simply works.
*
* The problem this solves: OpenCode Zen is one route whose models do not all
* speak one wire format. models.dev names a per-model SDK for exactly those that
* differ — 30 bundled Zen models name `@ai-sdk/openai` (Responses API) and 17
* name `@ai-sdk/anthropic` (Messages API), against a route declared as
* `openai-completions`. DSH cannot express "this model speaks a different
* format": `llm-pi-ai` carries one `api` per ROUTE, and `llm.registerAdapter`
* refuses a route that already has an adapter. So the format has to live on a
* route, and the model has to be dispatched to the route whose `api` names it.
*
* ## Why this mounts the host's own plugin instead of building an adapter
*
* `llm-pi-ai` is a plugin, not a library. Its package root exports the plugin
* contract (`apply`/`inject`/`name`) plus what a configuration surface needs;
* the pieces that turn a raw profile into a serviceable route are internal, and
* its published `exports` map advertises `"./src/*"` while `files` ships only
* `lib/` — so that path is dead in every installed copy. `apply` is the
* supported entry and resolves all of it itself, which is why nothing here
* reimplements a protocol or copies the host's resolver.
*
* ## The four collisions a second instance causes, and how each is handled
*
* | collision | why | handled by |
* | --- | --- | --- |
* | `DUPLICATE_FLOW` | `apply` registers one authorization flow per installed catalog provider | `isolate('authorization')`, so the `inject` never fires |
* | `DUPLICATE_DIRECTORY` | `apply` declares the WHOLE catalog, not just the routes being added | the facade answers `registerConfigurableProviders` locally |
* | `DUPLICATE_DISCOVERY` | discovery is keyed by settings namespace, and a nested entry inherits its parent's id | the facade answers `registerModelDiscovery` locally |
* | `providers.get expected object` | the registry keys its runtime by `apply` identity, so the FIRST instance's schema validates the second mount | the mount is handed RAW config, never a pre-validated `Config` |
*
* The facade is a local view for the mounted instance only. It forwards
* `registerAdapter` to the real service — so the child fiber still owns and
* releases the registration — and suppresses the two publishing calls.
*
* @module dsh-opencode-patch/responses-provider
*/
/** The host plugin whose `apply` this module mounts. */
const PI_AI_PACKAGE = "@deepseek-ai/dsh-llm-pi-ai";
/** Services hidden from the mounted instance; see the module header. */
const HIDDEN_SERVICES = ["authorization", "settings"];
/** The credential the README tells a user to store. */
const DEFAULT_CREDENTIAL_REF = "OPENCODE_API_KEY";
/** The gateway's endpoint. */
/**
* The sentinel that makes the stored credential resolvable at all: pi-ai's
* `getClientApiKey` throws when a route names neither a key nor an
* `authorization` header, before `fetch` — so the key the user already stored
* never gets a chance to be resolved without it. The fetch patch swaps it for
* the real one.
*/
const KEY_SENTINEL = "Bearer unused";
const ALL_THINKING_LEVELS = /* @__PURE__ */ new Set([
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
]);
/**
* Derive the `reasoningEfforts` dictionary that `dsh-llm-pi-ai` expects in
* a model profile, from the model's catalog specification.
*
* `dsh-llm-pi-ai` in `resolveModelReasoning` checks `entry.reasoningEfforts`.
* Without it, it falls back to pi's installed catalog entry — which has no
* knowledge of OpenCode models, setting `reasoning: false` and leaving the
* model with no thinking levels in the DSH composer.
*/
const reasoningEffortsFor = (spec) => {
	if (spec.reasoning !== true) return;
	const options = spec.reasoning_options ?? [];
	const effortOption = options.find((option) => option.type === "effort" && (option.values?.length ?? 0) > 0);
	if (effortOption?.values !== void 0) {
		const efforts = { off: null };
		for (const v of effortOption.values) if (v === "none" || v === "off") efforts.off = null;
		else if (ALL_THINKING_LEVELS.has(v)) efforts[v] = v;
		if (Object.keys(efforts).some((k) => k !== "off")) return efforts;
	}
	if (options.some((option) => option.type === "toggle")) return {
		off: null,
		low: "low",
		medium: "medium",
		high: "high"
	};
	return {
		off: null,
		low: "low",
		medium: "medium",
		high: "high"
	};
};
/**
* Read a value that may be an array or any iterable as an array.
*
* The loader's `entries()` is a generator, so it is not an array; a mock or a
* future version may hand over either.
*
* @param value - the candidate.
* @returns the items, or `[]` when the value is not iterable.
*/
const toArray = (value) => {
	if (Array.isArray(value)) return value;
	if (value === null || typeof value !== "object") return [];
	if (typeof Reflect.get(value, Symbol.iterator) !== "function") return [];
	const items = [];
	for (const item of value) items.push(item);
	return items;
};
/**
* The loader service, off the context or through the service registry.
*
* `ctx.loader` is the accessor cordis installs for the service; `ctx.get` is the
* untyped escape hatch, kept because a context that exposes only the latter is
* still a context this plugin can work in.
*
* @param ctx - the host context.
* @returns the loader, or `undefined` when the host serves none.
*/
const loaderOf = (ctx) => {
	if (!isRecord(ctx)) return;
	try {
		const { loader: direct } = ctx;
		if (isRecord(direct) && isFunctionLike(direct.entries)) return direct;
	} catch {}
	if (!isFunctionLike(ctx.get)) return;
	let viaGet;
	try {
		viaGet = Reflect.apply(ctx.get, ctx, ["loader"]);
	} catch {
		return;
	}
	return isRecord(viaGet) && isFunctionLike(viaGet.entries) ? viaGet : void 0;
};
/** Every entry the host's loader holds, or `[]` when there is no loader. */
const loaderEntries = (ctx) => {
	const loader = loaderOf(ctx);
	if (loader === void 0) return [];
	const { entries } = loader;
	if (typeof entries !== "function") return [];
	try {
		return toArray(Reflect.apply(entries, loader, []));
	} catch {
		return [];
	}
};
/**
* The plugin behind a loader entry that never kept the import result.
*
* One loader generation stores the raw module on the entry (`moduleNamespace`);
* the other hands the import result straight to the registry and keeps only the
* fiber, so the two pieces needed to mount it again are read off that fiber:
* the registry's resolved callback on the fiber's runtime, and the
* registry-normalized `inject`. `Inject.resolve` maps an already-normalized
* `{ service: null }` onto itself, so the synthesized record mounts exactly as
* the module namespace would.
*
* The `inject` is required, not cosmetic: it is what lets the plugin's first
* `ctx.<service>` property access resolve at all, so an entry whose fiber
* carries none is reported as unusable rather than mounted into a crash.
*
* @param entry - the loader entry whose `options.name` matched the package.
* @returns the mountable record, or `undefined` when the fiber carries none.
*/
const pluginFromFiber = (entry) => {
	const { fiber } = entry;
	if (!isRecord(fiber)) return;
	const { runtime } = fiber;
	if (!isRecord(runtime) || !isFunctionLike(runtime.callback)) return;
	if (!isRecord(fiber.inject)) return;
	return {
		apply: runtime.callback,
		inject: fiber.inject
	};
};
/**
* The loader entry the composition loaded the host plugin under.
*
* @param ctx - host context carrying the loader.
* @returns the entry, or `undefined` when no entry names the package.
*/
const piAiEntry = (ctx) => {
	const entry = loaderEntries(ctx).find((candidate) => isRecord(candidate) && isRecord(candidate.options) && candidate.options.name === PI_AI_PACKAGE);
	return isRecord(entry) ? entry : void 0;
};
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
const loadPiAi = (ctx) => {
	const loader = loaderOf(ctx);
	const entry = piAiEntry(ctx);
	if (entry === void 0) return;
	if (entry.moduleNamespace !== void 0) {
		const unwrapped = loader !== void 0 && isFunctionLike(loader.unwrapExports) ? Reflect.apply(loader.unwrapExports, loader, [entry.moduleNamespace]) : entry.moduleNamespace;
		return isRecord(unwrapped) && isFunctionLike(unwrapped.apply) ? unwrapped : void 0;
	}
	return pluginFromFiber(entry);
};
/**
* The raw module namespace, for the one thing a fiber cannot carry.
*
* The Google bridge constructs the wrapper's own `PiAiAdapter`, and the class
* lives on the module namespace — which one loader generation keeps on its
* entry and the other drops entirely ({@link pluginFromFiber} reads the rest
* off the fiber). The registry's runtime record does not keep it either: it
* holds `{ name, callback, fibers, Config }` and nothing else.
*
* The module is still reachable, because it is the SAME module: the loader
* resolved the entry's own name against the context's base URL, so resolving
* that name from the same base reaches the same file, and Node's module cache
* hands back the namespace the loader already executed. Nothing is imported
* twice and nothing is guessed from a package-manager layout.
*
* @param ctx - host context carrying the loader and its base URL.
* @returns the namespace, or `undefined` when no entry names the package or
*   the module cannot be resolved from the base URL.
*/
const loadPiAiModule = async (ctx) => {
	if (piAiEntry(ctx) === void 0) return;
	const base = isRecord(ctx) ? ctx.baseUrl : void 0;
	if (typeof base !== "string" || base.length === 0) return;
	try {
		const resolve = createRequire(new URL("noop.js", base));
		const namespace = await import(pathToFileURL(resolve.resolve(PI_AI_PACKAGE)).href);
		return isRecord(namespace) ? namespace : void 0;
	} catch {
		return;
	}
};
/**
* The host record the GOOGLE BRIDGE needs: one carrying `PiAiAdapter`.
*
* {@link loadPiAi} answers the MOUNT's question — a callback and an inject —
* and on the fiber-only loader generation that record carries no classes. The
* bridge builds its adapter from the module's own class, so when the entry
* kept no namespace the module is asked directly ({@link loadPiAiModule});
* when even that fails the mount's record is handed back, and the bridge
* stands down rather than inventing an adapter.
*
* @param ctx - host context carrying the loader.
* @returns the best available host record, or `undefined` when there is none.
*/
const loadPiAiAdapterHost = async (ctx) => {
	const host = loadPiAi(ctx);
	if (isRecord(host) && isFunctionLike(host.PiAiAdapter)) return host;
	return await loadPiAiModule(ctx) ?? host;
};
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
const inheritedCredentialRef = (ctx, plane = "opencode") => {
	for (const entry of loaderEntries(ctx)) {
		if (!isRecord(entry) || !isRecord(entry.options)) continue;
		const { options } = entry;
		const { config } = options;
		if (!isRecord(config) || !isRecord(config.providers)) continue;
		const source = config.providers[plane];
		if (!isRecord(source)) continue;
		const ref = source.apiKeyEnv;
		if (typeof ref === "string" && ref.length > 0) return ref;
	}
	return plane === "opencode-go" ? DEFAULT_USAGE_KEY_ENV : DEFAULT_CREDENTIAL_REF;
};
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
const modelsForSdk = (sdk, catalog = [...getLiveZenCatalog(), ...getLiveGoCatalog()]) => {
	const seen = /* @__PURE__ */ new Set();
	const profiles = [];
	for (const spec of catalog) {
		if (spec.provider_npm !== sdk || seen.has(spec.id)) continue;
		seen.add(spec.id);
		const reasoningEfforts = reasoningEffortsFor(spec);
		profiles.push({
			contextWindow: spec.context_window,
			id: spec.id,
			input: [...spec.input_modalities],
			maxTokens: spec.max_output_tokens,
			name: spec.name,
			...reasoningEfforts === void 0 ? {} : { reasoningEfforts }
		});
	}
	return profiles;
};
/**
* The provider profile for one route, in the shape the config schema takes.
*
* The mounted plugin resolves it — defaults, serviceable models and all —
* exactly as it would a profile the user wrote.
*
* @param protocol - the pi-ai protocol the route's `api` names.
* @param models - the models to serve.
* @param apiKeyEnv - the credential reference the composition already uses.
* @returns the profile, keyed by nothing yet (the caller keys it).
*/
const providerProfile = (protocol, models, apiKeyEnv, baseURL) => ({
	api: protocol,
	apiKeyEnv,
	baseURL,
	headers: { authorization: KEY_SENTINEL },
	models: [...models]
});
/** Every SDK that names one protocol — a protocol may be named by more than one. */
const sdksForProtocol = (protocol) => Object.keys(PROTOCOL_FOR_SDK).filter((sdk) => PROTOCOL_FOR_SDK[sdk] === protocol);
/**
* The catalog and credential of one plane.
*
* A route carries ONE plane: its base URL, its catalog and its credential all
* come from the same account. Mixing them resolves to "model not found" against
* the route's own endpoint, which is why the mount reads all three here rather
* than from a module constant.
*/
const planeSource = (plane, ctx) => plane === "opencode-go" ? {
	apiKeyEnv: inheritedCredentialRef(ctx, "opencode-go"),
	catalog: getLiveGoCatalog()
} : {
	apiKeyEnv: inheritedCredentialRef(ctx),
	catalog: getLiveZenCatalog()
};
/**
* The route names the registry actually holds, read from its raw map.
*
* The map, not `listProviders()`: that method is Remote-decorated, and the
* decorated view under-reports — measured, the map held `opencode-responses`
* while `listProviders()` did not list it, which is what let a mount try to
* register it a second time. A host that stops exposing the map falls back to
* the decorated list, which is still better than assuming nothing is declared.
*
* @param llm - the `llm` service.
* @returns the route names, or `undefined` when no raw map is readable.
*/
const adapterRoutes = (llm) => {
	if (!isRecord(llm)) return;
	const raw = llm.adapters;
	return raw instanceof Map ? new Set([...raw.keys()].map(String)) : void 0;
};
/** The routes the host already serves, so a declared one is never overridden. */
const declaredRoutes = (llm) => {
	const fromMap = adapterRoutes(llm);
	if (fromMap !== void 0) return fromMap;
	const listed = llm?.listProviders?.();
	return new Set(Array.isArray(listed) ? listed.flatMap((route) => isRecord(route) && typeof route.id === "string" ? [route.id] : []) : []);
};
/** Withdraw one registration, whichever handle shape the registry returned. */
const releaseRegistration = (handle) => {
	try {
		if (typeof handle === "function") {
			Reflect.apply(handle, void 0, []);
			return;
		}
		if (isRecord(handle) && typeof handle.dispose === "function") Reflect.apply(handle.dispose, handle, []);
	} catch {}
};
/**
* A handle-shaped no-op, for a forwarded registration reduced to nothing.
*
* The mounted wrapper stores whatever `registerAdapter` returns and may call
* `replace` on it later, so the shape has to match a real handle; withdrawal
* stays with the real handle's own disposer.
*/
const NOOP_HANDLE = Object.assign(() => {}, { replace: () => {} });
/**
* A view of the real `llm` service for the mounted instance.
*
* `registerAdapter` is forwarded — bound to the real service, so the child fiber
* owns what it registers — and every handle it returns is captured, which is
* what lets {@link registerResponsesProvider}'s disposer withdraw the routes
* deterministically rather than relying on the fiber's own unwind.
*
* The forward re-checks the routes against the raw adapter map first. The
* registry's registration is all-or-nothing — one already-registered route
* makes it throw before any of the others land — so a route something else
* serves is dropped here and the rest of the mount survives. That map is the
* same authority {@link declaredRoutes} reads, so the two views agree.
*
* The two publishing calls are answered locally, which is what keeps a second
* instance from colliding with the host's own directory and discovery
* registrations. Every other member passes through with the correct receiver.
*
* @param real - the real `llm` service.
* @param captured - collects the handles `registerAdapter` returns.
* @returns the facade, or `real` when it is not an object.
*/
const llmFacade = (real, captured) => {
	if (typeof real !== "object" || real === null) return real;
	return new Proxy(real, { get: (source, prop) => {
		if (prop === "registerAdapter") {
			const register = Reflect.get(source, prop, source);
			if (typeof register !== "function") return register;
			return (routes, adapter) => {
				const listed = adapterRoutes(source) ?? /* @__PURE__ */ new Set();
				const owned = routes.filter((route) => !listed.has(route));
				if (owned.length === 0) return NOOP_HANDLE;
				const handle = Reflect.apply(register, source, [owned, adapter]);
				captured.push(handle);
				return handle;
			};
		}
		if (prop === "registerConfigurableProviders") return () => ({
			dispose: () => {},
			replace: () => {}
		});
		if (prop === "registerModelDiscovery") return () => {};
		const value = Reflect.get(source, prop, source);
		if (typeof value !== "function") return value;
		const bound = (...args) => Reflect.apply(value, source, args);
		return bound;
	} });
};
/**
* The real `llm` service, read through the holder's own `get`.
*
* Read off `this` rather than captured, because the shadow is installed on a
* parent scope and every context below it resolves the service through its own
* isolation chain — a captured reference would pin the mount to whichever scope
* happened to build the facade.
*
* @param holder - the context the getter was reached through.
* @returns the service, or `undefined` when the holder cannot resolve it.
*/
const readLlmService = (holder) => {
	if (!isRecord(holder)) return;
	const { get } = holder;
	if (typeof get !== "function") return;
	try {
		return Reflect.apply(get, holder, ["llm"]);
	} catch {
		return;
	}
};
/**
* The scope the host plugin is mounted in, or `undefined` when unsupported.
*
* Both isolated services are load-bearing. `authorization` is what keeps the
* flows from colliding; `settings` is what keeps the mounted instance from
* writing a settings section nobody asked for, which is the seam a check of
* `authorization` alone would miss.
*
* @param ctx - the host context.
* @param captured - collects the handles `registerAdapter` returns.
* @returns the scope to mount into.
*/
const mountScope = (ctx, captured) => {
	let scope = ctx;
	for (const service of HIDDEN_SERVICES) {
		if (scope === void 0 || typeof scope.isolate !== "function") return;
		scope = scope.isolate(service);
	}
	if (scope === void 0 || typeof scope.extend !== "function") return;
	return scope.extend({ get llm() {
		return llmFacade(readLlmService(this), captured);
	} });
};
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
const unroutedDeclaredModels = (declaredByPlane, served) => {
	const gaps = [];
	for (const [plane, ids] of declaredByPlane) {
		const entry = ROUTE_FOR_PLANE_PROTOCOL[plane];
		if (entry === void 0) continue;
		const catalog = plane === "opencode-go" ? getLiveGoCatalog() : getLiveZenCatalog();
		const byId = new Map(catalog.map((spec) => [spec.id, spec]));
		for (const id of ids) {
			const spec = byId.get(id);
			const protocol = spec === void 0 ? void 0 : protocolFor(spec);
			if (protocol === void 0 || entry.routes[protocol] === void 0) continue;
			if (served.has(`${plane}:${protocol}`)) continue;
			gaps.push(`${id} (${plane} · ${protocol})`);
		}
	}
	return gaps.toSorted((a, b) => a.localeCompare(b));
};
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
const undescribedDeclaredModels = (declaredByPlane) => {
	const gaps = [];
	for (const [plane, ids] of declaredByPlane) {
		const catalog = plane === "opencode-go" ? getLiveGoCatalog() : getLiveZenCatalog();
		const known = new Set(catalog.map((spec) => spec.id));
		for (const id of ids) if (!known.has(id)) gaps.push(`${id} (${plane})`);
	}
	return gaps.toSorted((a, b) => a.localeCompare(b));
};
const narrowToDeclared = (models, declared) => declared === void 0 ? models : models.filter((m) => declared.has(m.id));
/**
* The model ids a provider row declares, from the loader's configuration.
*
* A thin projection of {@link declaredProviderModels}, which owns the reading
* itself — `ctx.get` for the loader (property access throws without `inject`),
* `entries()` as the generator it is, and the `models:` array the operator
* wrote. Both callers in this file want ids only; the shared reader answers
* rows because the picker needs their names, so the set is built here rather
* than duplicating the walk.
*
* @param ctx - the host context.
* @param route - the plane route (`opencode`, `opencode-go`).
* @returns the declared ids, or `undefined` when the loader holds no entry for
*   that route (a composition this plugin cannot read, not an empty declaration).
*/
const declaredIdsFromLoader = (ctx, route) => {
	const declared = declaredProviderModels(ctx, route);
	return declared === void 0 ? void 0 : new Set(declared.map((model) => model.id));
};
const declaredModelsFor = async (ctx, route) => {
	const declared = declaredIdsFromLoader(ctx, route);
	if (declared !== void 0) return declared;
	const listModels = ctx.llm?.listModels;
	if (typeof listModels !== "function") return /* @__PURE__ */ new Set();
	try {
		const listed = await Reflect.apply(listModels, ctx.llm, [route]);
		if (!Array.isArray(listed)) return /* @__PURE__ */ new Set();
		const ids = /* @__PURE__ */ new Set();
		for (const entry of listed) {
			const id = isRecord(entry) ? entry.id : void 0;
			if (typeof id === "string" && id.length > 0) ids.add(id);
		}
		return ids;
	} catch {
		return /* @__PURE__ */ new Set();
	}
};
const registerResponsesProvider = async (ctx, config) => {
	const { llm } = ctx;
	if (llm === void 0 || typeof llm.registerAdapter !== "function") return;
	const declared = declaredRoutes(llm);
	const declaredByPlane = new Map(await Promise.all(["opencode", "opencode-go"].map(async (plane) => [plane, await declaredModelsFor(ctx, plane)])));
	for (const [plane, ids] of declaredByPlane) if (ids.size === 0) console.info(`[dsh-opencode-patch] ${plane}: no models could be read for the route — it declares none, or its credential is not resolvable in this process — so no internal route is mounted for it`);
	const hostPi = await loadHostPi();
	if (!declared.has("opencode-google") && hostPi === void 0) console.info("[dsh-opencode-patch] the Google bridge did not mount: the harness's @earendil-works/pi-ai could not be resolved from dsh-llm-pi-ai — the Gemini models will not be offered (every other route is unaffected)");
	const bridgeHandles = [];
	const bridgeHost = await loadPiAiAdapterHost(ctx);
	try {
		for (const plane of ["opencode", "opencode-go"]) {
			const route = plane === "opencode-go" ? GO_GOOGLE_INTERNAL_ROUTE : GOOGLE_INTERNAL_ROUTE;
			if (declared.has(route) || hostPi === void 0) continue;
			const source = planeSource(plane, ctx);
			const ids = declaredByPlane.get(plane);
			const handle = registerGoogleBridge({
				apiKeyRef: source.apiKeyEnv,
				plane,
				readOpencodeStore: config?.readOpencodeStore === true,
				endpoint: config?.endpoint,
				ctx,
				host: bridgeHost,
				pi: hostPi,
				llm: { registerAdapter: llm.registerAdapter.bind(llm) },
				specs: source.catalog.filter((spec) => spec.provider_npm === "@ai-sdk/google" && ids?.has(spec.id) === true)
			});
			if (handle !== void 0) {
				bridgeHandles.push(handle);
				ctx.logger?.info?.("[dsh-opencode-patch] bridged the Gemini models to %s (own adapter)", route);
			}
		}
	} catch (error) {
		for (const handle of bridgeHandles) releaseRegistration(handle);
		throw error;
	}
	const bridgeDispose = bridgeHandles.length === 0 ? void 0 : () => {
		for (const handle of bridgeHandles) releaseRegistration(handle);
	};
	const undescribed = undescribedDeclaredModels(declaredByPlane);
	if (undescribed.length > 0) console.info(`[dsh-opencode-patch] ${undescribed.length} declared model(s) are not described by the catalog (newer than it, or deprecated): ${undescribed.join(", ")} — they are served from the deployment's configuration, without catalog metadata`);
	/** Protocols some route in this composition serves, as `plane:protocol`. */
	const served = /* @__PURE__ */ new Set();
	const reportGaps = () => {
		const gaps = unroutedDeclaredModels(declaredByPlane, served);
		if (gaps.length === 0) return;
		console.warn(`[dsh-opencode-patch] ${gaps.length} declared model(s) speak a protocol no route serves: ${gaps.join(", ")} — declare provider routes for them (see modelRoutes), or set internalRoutes: true`);
	};
	for (const [plane, entry] of Object.entries(ROUTE_FOR_PLANE_PROTOCOL)) for (const [protocol, route] of Object.entries(entry.routes)) if (declared.has(route)) served.add(`${plane}:${protocol}`);
	if (config?.internalRoutes === false) {
		ctx.logger?.info?.("[dsh-opencode-patch] internal routes are off (internalRoutes: false); a declared provider must serve each protocol");
		reportGaps();
		return;
	}
	const wanted = Object.entries(ROUTE_FOR_PLANE_PROTOCOL).flatMap(([plane, entry]) => Object.entries(entry.routes).filter(([, route]) => !declared.has(route) && !SELF_MOUNTED_ROUTES.has(route)).map(([protocol, route]) => ({
		plane,
		protocol,
		route,
		baseURL: baseForProtocol(plane, protocol, config?.endpoint) ?? entry.baseURL
	})));
	if (wanted.length === 0) {
		console.info("[dsh-opencode-patch] every internal route is already declared; leaving them alone");
		reportGaps();
		return;
	}
	const host = loadPiAi(ctx);
	if (host === void 0) {
		console.info("[dsh-opencode-patch] no loaded llm-pi-ai in this composition; internal routes stay unregistered");
		reportGaps();
		return;
	}
	const providers = {};
	const mounted = [];
	for (const { plane, protocol, route, baseURL } of wanted) {
		const source = planeSource(plane, ctx);
		const declaredIds = declaredByPlane.get(plane);
		const models = narrowToDeclared(sdksForProtocol(protocol).flatMap((sdk) => modelsForSdk(sdk, source.catalog)), declaredIds);
		if (models.length === 0) {
			console.info(`[dsh-opencode-patch] ${route} not mounted: no declared model speaks ${protocol}`);
			continue;
		}
		providers[route] = providerProfile(protocol, models, source.apiKeyEnv, baseURL);
		served.add(`${plane}:${protocol}`);
		mounted.push(`${route} (${plane} · ${protocol}) with ${models.length} model(s)`);
	}
	if (mounted.length === 0) {
		ctx.logger?.info?.("[dsh-opencode-patch] no model needs an internal route; nothing to mount");
		return bridgeDispose;
	}
	const captured = [];
	const scope = mountScope(ctx, captured);
	if (scope === void 0 || typeof scope.plugin !== "function") {
		ctx.logger?.info?.("[dsh-opencode-patch] this host exposes no isolate/plugin scope; internal routes stay unregistered");
		return bridgeDispose;
	}
	try {
		const fiber = scope.plugin(host, { providers });
		const settle = fiber?.await;
		await Promise.resolve(typeof settle === "function" ? fiber?.await?.() : fiber);
		if (captured.length === 0) {
			ctx.logger?.info?.("[dsh-opencode-patch] the mount registered no route; internal routes stay unregistered");
			return bridgeDispose;
		}
		console.info(`[dsh-opencode-patch] mounted ${mounted.length === 0 ? "no internal route" : mounted.join("; ")}`);
		return () => {
			bridgeDispose?.();
			for (const handle of captured) releaseRegistration(handle);
			captured.length = 0;
			(async () => {
				try {
					await fiber?.dispose?.();
				} catch {}
			})();
		};
	} catch (error) {
		ctx.logger?.info?.("[dsh-opencode-patch] internal routes stay unregistered (%s); routes declared in the profile are unaffected", error instanceof Error ? error.message : String(error));
		return bridgeDispose;
	}
};
//#endregion
//#region src/session-cost.ts
const sessionStore = /* @__PURE__ */ new Map();
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
const formatUsd = (usd) => `$${usd.toFixed(2)}`;
/** Format model rate per 1M tokens. */
const formatModelRate = (cost, isFree = false) => {
	if (cost === void 0) {
		if (isFree) return "Free";
		return "—";
	}
	if (isFree || cost !== void 0 && cost.input === 0 && cost.output === 0) return "Free";
	return `$${cost.input} / $${cost.output} per 1M`;
};
/** Calculate the cost of a turn given tokens and pricing rates (prices per 1M tokens). */
const calculateTurnCost = (tokens, cost, isFree = false) => {
	if (isFree || cost === void 0) return 0;
	const inputCost = (tokens.inputTokens ?? 0) * cost.input / 1e6;
	const outputCost = (tokens.outputTokens ?? 0) * cost.output / 1e6;
	const cacheCost = (tokens.cacheReadTokens ?? 0) * (cost.cache_read ?? 0) / 1e6;
	return inputCost + outputCost + cacheCost;
};
/** Project the mutable accumulator into the wire snapshot. */
const toSnapshot = (val) => {
	const { activeModel } = val;
	return {
		...activeModel === void 0 ? {} : { activeModel },
		...activeModel === void 0 ? {} : { activeRateFormatted: formatModelRate(val.activeRate, val.activeIsFree === true) },
		cacheReadTokens: val.cacheReadTokens,
		/** Spend attributed to each billing plane; every turn knows its own. */
		costByPlane: {
			go: val.costGo,
			zen: val.costZen
		},
		costFormatted: formatUsd(val.costUsd),
		costUsd: val.costUsd,
		...val.activeIsFree === true ? { freeModel: true } : {},
		inputTokens: val.inputTokens,
		modelsUsed: [...val.modelsUsed],
		outputTokens: val.outputTokens,
		totalTokens: val.totalTokens,
		turns: val.turns
	};
};
/**
* Record a completed turn's token usage into the session accumulator.
*
* `plane` is which billing plane served the turn — Go allowance or Zen balance —
* and it is what makes the split below possible. A session that switches planes
* midway (Go `mimo-v2.6-pro`, then Zen `mimo-v2.6-flash-free`) used to fold BOTH
* planes' spend into one total, so the Zen panel billed the session with money
* the Go allowance had paid. Each turn is attributed where it was served.
*/
const recordTurnUsage = (sessionId, tokens, cost, model = "unknown", isFree = false, plane = "zen") => {
	const existing = sessionStore.get(sessionId) ?? {
		cacheReadTokens: 0,
		costGo: 0,
		costUsd: 0,
		costZen: 0,
		history: [],
		inputTokens: 0,
		modelsUsed: /* @__PURE__ */ new Set(),
		outputTokens: 0,
		totalTokens: 0,
		turns: 0
	};
	const turnCost = calculateTurnCost(tokens, cost, isFree);
	const total = tokens.totalTokens ?? (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0);
	const turnRecord = {
		costFormatted: formatUsd(turnCost),
		costUsd: turnCost,
		inputTokens: tokens.inputTokens ?? 0,
		...isFree ? { isFree: true } : {},
		model,
		outputTokens: tokens.outputTokens ?? 0,
		plane,
		timestamp: Date.now(),
		totalTokens: total
	};
	const modelsUsed = new Set(existing.modelsUsed);
	const named = model.length > 0 && model !== "unknown";
	if (named) modelsUsed.add(model);
	const updated = {
		...existing.activeModel === void 0 ? {} : { activeModel: existing.activeModel },
		...existing.activeRate === void 0 ? {} : { activeRate: existing.activeRate },
		...existing.activeIsFree === void 0 ? {} : { activeIsFree: existing.activeIsFree },
		...named ? {
			activeIsFree: isFree,
			activeModel: model,
			...cost === void 0 ? {} : { activeRate: cost }
		} : {},
		cacheReadTokens: existing.cacheReadTokens + (tokens.cacheReadTokens ?? 0),
		costGo: existing.costGo + (plane === "go" ? turnCost : 0),
		costZen: existing.costZen + (plane === "zen" ? turnCost : 0),
		costUsd: existing.costUsd + turnCost,
		history: [...existing.history, turnRecord],
		inputTokens: existing.inputTokens + (tokens.inputTokens ?? 0),
		modelsUsed,
		outputTokens: existing.outputTokens + (tokens.outputTokens ?? 0),
		totalTokens: existing.totalTokens + total,
		turns: existing.turns + 1
	};
	sessionStore.set(sessionId, updated);
	return toSnapshot(updated);
};
/** Read accumulated token and dollar usage for a session (or the latest active session). */
const getSessionUsage = (sessionId) => {
	const found = sessionId === void 0 ? void 0 : sessionStore.get(sessionId);
	if (found !== void 0) return toSnapshot(found);
	const latest = [...sessionStore.values()].at(-1);
	return latest === void 0 ? void 0 : toSnapshot(latest);
};
/**
* Re-describe a snapshot for a DIFFERENT model, without touching the spend.
*
* The accumulator prices each turn at the model that ran it, so its `active*`
* fields name the last one. The panel's rate is prospective — what the next turn
* costs — so when the caller knows which model is selected now and it differs,
* this swaps the identity and re-derives the rate from the catalog entry the Host
* holds. The spend total is deliberately untouched: it is history.
*/
const describeModel = (snapshot, model, rate, isFree, displayName) => {
	const { activeModelName: _wasNamed, freeModel: _wasFree, ...rest } = snapshot;
	return {
		...rest,
		activeModel: model,
		...displayName === void 0 ? {} : { activeModelName: displayName },
		activeRateFormatted: formatModelRate(rate, isFree),
		...isFree ? { freeModel: true } : {}
	};
};
/** Clear session usage (primarily for tests). */
const clearSessionUsageStore = () => {
	sessionStore.clear();
};
//#endregion
//#region src/turn-store.ts
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
const withStore = (iterable, store, als) => {
	const iterator = getAsyncIterator(iterable);
	if (iterator === void 0) return iterable;
	const asyncIteratorObj = {
		next: () => als.run(store, () => iterator.next()),
		return: (value) => {
			if (typeof iterator.return === "function") return iterator.return(value).catch(() => ({
				done: true,
				value
			}));
			return Promise.resolve({
				done: true,
				value
			});
		},
		throw: (error) => {
			if (typeof iterator.throw !== "function") {
				const err = error instanceof Error ? error : new Error(String(error));
				return Promise.reject(err);
			}
			const throwMethod = iterator.throw;
			return als.run(store, () => throwMethod.call(iterator, error));
		}
	};
	return { [Symbol.asyncIterator]() {
		return asyncIteratorObj;
	} };
};
//#endregion
//#region src/utils/google-replay.ts
/** Translate only adapter-owned Google replay identity across a route redirect. */
const googleReplayFor = (state, from, to) => {
	if (!isRecord(state) || !isRecord(state.response) || state.response.kind !== "pi-ai" || state.response.api !== "google-generative-ai" || state.response.provider !== from) return state;
	return {
		...state,
		response: {
			...state.response,
			provider: to
		}
	};
};
/** The agent stores the public provider; the native adapter needs its internal identity. */
const googleHistoryFor = (messages, from, to) => {
	if (!Array.isArray(messages)) return messages;
	return messages.map((message) => {
		if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.source) || message.source.provider !== from) return message;
		const replay = googleReplayFor(message.source.replayState, from, to);
		if (replay === message.source.replayState) return message;
		return {
			...message,
			source: {
				...message.source,
				provider: to,
				replayState: replay
			}
		};
	});
};
/**
* Keep persisted replay consistent with the public provider recorded by the agent.
* @yields {unknown} Stream chunks with public replay identity and no undefined fields added.
*/
async function* googleReplayStream(stream, from, to) {
	for await (const chunk of stream) if (isRecord(chunk) && chunk.type === "finish") {
		const replay = googleReplayFor(chunk.replayState, from, to);
		yield replay === chunk.replayState ? chunk : {
			...chunk,
			replayState: replay
		};
	} else yield chunk;
}
//#endregion
//#region src/stream-hook.ts
const isStreamOptions = (value) => typeof value === "object" && value !== null;
/**
* Build the `llm/stream` listener.
*
* @param ctx - plugin context (logging + debug file writes).
* @param config - resolved plugin configuration.
* @param als - turn store shared with the fetch patch.
*/
/**
* The workspace folder name for `x-opencode-project`, or `undefined` when the
* path names no folder.
*
* Splits on BOTH separators instead of calling `path.basename`, which is
* platform-specific (Node documents `/` and `\` on Windows, `/` alone on
* POSIX). A Windows-shaped `cwd` arriving on a POSIX host is therefore NOT
* split by it at all — `path.basename("C:\\Users\\you\\proj")` returns the whole
* string — so the full path, username included, would be sent as the project
* name. This header is for attribution, not for a filesystem layout.
*/
/**
* Models already reported as unservable, so the report happens once rather than on
* every request that names one.
*/
const warnedUnservable = /* @__PURE__ */ new Set();
/** Markers whose presence makes a directory a repository root, either kind. */
const VCS_MARKERS = [".git", ".hg"];
const projectNameFrom = (cwd) => {
	const trimmed = cwd.replace(/[\\/]+$/, "");
	const folder = trimmed.split(/[\\/]/).pop()?.trim();
	if (folder === void 0 || folder.length === 0 || folder === "." || folder === "..") return;
	const segments = trimmed.split(/[\\/]/);
	for (let index = segments.length; index > 0; index -= 1) {
		const candidate = segments.slice(0, index).join("/");
		if (VCS_MARKERS.some((marker) => existsSync(`${candidate}/${marker}`))) {
			const root = segments[index - 1]?.trim();
			if (root !== void 0 && root.length > 0) return root;
			break;
		}
	}
	return folder;
};
const createStreamHook = (ctx, config, als) => {
	const { debug, debugFile, providers } = config;
	return (options, next) => {
		if (!isStreamOptions(options)) return next();
		const providerProp = options.provider;
		if (typeof providerProp !== "string" && typeof providerProp !== "number") return next();
		const providerKey = String(providerProp);
		if (!providers.has(providerKey)) return next();
		if (typeof options.model === "string" && options.model.length > 0 && !isServableModel(options.model, providerKey) && !warnedUnservable.has(`${providerKey}/${options.model}`)) {
			warnedUnservable.add(`${providerKey}/${options.model}`);
			const plane = catalogPlaneForRoute(providerKey);
			const sdk = findModelSpecOn(plane, options.model)?.provider_npm;
			let why;
			if (sdk === void 0) why = "it names no SDK this plane has a route for";
			else if (UNSERVED_PLANE_SDKS.has(`${providerKey} + ${sdk}`)) why = `its catalog SDK \`${sdk}\` is not served on this plane`;
			else why = `its catalog SDK \`${sdk}\` names a protocol this plane has no route for`;
			console.warn(`[dsh-opencode-patch] ${providerKey}/${options.model} cannot be served: ${why}`, "the picker does not offer it for the same reason");
		}
		const redirect = internalRouteFor(providerKey, options.model, typeof options.model === "string" ? (findModelSpecOn(catalogPlaneForRoute(providerKey), options.model) ?? findModelSpec(options.model))?.provider_npm : void 0, typeof options.model === "string" ? config.modelRoutes[options.model]?.api : void 0);
		const isAvailable = (routeId) => {
			const llm = ctx.llm;
			if (isRecord(llm) && "adapters" in llm && llm.adapters instanceof Map && llm.adapters.has(routeId)) return true;
			return isRouteRegistered(routeId);
		};
		if (redirect !== void 0 && typeof ctx.llm?.stream === "function" && isAvailable(redirect)) {
			if (redirect === "opencode-go-google") {
				const stream = ctx.llm.stream({
					...options,
					prepared: void 0,
					provider: redirect,
					messages: googleHistoryFor(options.messages, providerKey, redirect)
				});
				return isAsyncIterableLike(stream) ? googleReplayStream(stream, redirect, providerKey) : stream;
			}
			return ctx.llm.stream({
				...options,
				provider: redirect
			});
		}
		const sessionProp = options.sessionId;
		const sessionMetaResolver = readSessionMetaResolver(ctx);
		const sessionMeta = typeof sessionProp === "string" && sessionMetaResolver !== void 0 ? sessionMetaResolver(sessionProp) : void 0;
		let rawSession;
		let value;
		if (typeof sessionProp === "string" && sessionProp.length > 0) {
			rawSession = sessionProp;
			value = headerValueFor(rawSession, sessionMeta?.createdAt) ?? fallbackSessionId(config.sessionIdEnv);
		} else if (typeof sessionProp === "number") {
			rawSession = String(sessionProp);
			value = headerValueFor(rawSession, sessionMeta?.createdAt) ?? fallbackSessionId(config.sessionIdEnv);
		} else {
			rawSession = fallbackSessionId(config.sessionIdEnv);
			value = rawSession;
		}
		const parentProp = options.parentSessionId ?? options.parentSession ?? options.parentId;
		let rawParent;
		if (typeof parentProp === "string" && parentProp.length > 0) rawParent = parentProp;
		else if (typeof parentProp === "number") rawParent = String(parentProp);
		else if (sessionMeta?.parentSession !== void 0) rawParent = sessionMeta.parentSession;
		const parentValue = rawParent === void 0 ? void 0 : headerValueFor(rawParent, sessionMetaResolver?.(rawParent)?.createdAt);
		let project;
		if (sessionMeta?.cwd !== void 0) {
			const folder = projectNameFrom(sessionMeta.cwd);
			if (folder !== void 0 && folder.length > 0) project = folder;
		}
		const downstream = next();
		if (!isAsyncIterableLike(downstream)) return downstream;
		if (debug || debugFile !== void 0) {
			const entry = {
				header: SESSION_HEADER,
				model: options.model,
				...parentValue === void 0 ? {} : { parentSession: parentValue },
				...project === void 0 ? {} : { project },
				provider: providerKey,
				session: rawSession,
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				value
			};
			if (debugFile !== void 0) recordDebug(ctx, debugFile, entry);
			if (debug) ctx.logger?.info?.("[dsh-opencode-patch] streaming provider \"%s\" with %s=%s", providerKey, SESSION_HEADER, value);
		}
		const modelProp = options.model;
		const modelName = typeof modelProp === "string" ? modelProp : "unknown";
		const spec = findModelSpec(modelName);
		return withStore(async function* wrappedStream() {
			for await (const chunk of downstream) {
				if (isRecord(chunk) && chunk.type === "usage" && isRecord(chunk.usage)) {
					const u = chunk.usage;
					const inputTokens = typeof u.inputTokens === "number" ? u.inputTokens : void 0;
					const outputTokens = typeof u.outputTokens === "number" ? u.outputTokens : void 0;
					const totalTokens = typeof u.totalTokens === "number" ? u.totalTokens : void 0;
					const cacheReadTokens = typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : void 0;
					recordTurnUsage(rawSession, {
						cacheReadTokens,
						inputTokens,
						outputTokens,
						totalTokens
					}, spec?.cost, modelName, spec?.is_free, catalogPlaneForRoute(providerKey));
				}
				yield chunk;
			}
		}(), {
			model: typeof modelProp === "string" ? modelProp : void 0,
			...parentValue === void 0 ? {} : { parentValue },
			...project === void 0 ? {} : { project },
			provider: providerKey,
			requestValue: newOpenCodeMessageId(),
			value
		}, als);
	};
};
//#endregion
//#region src/go-limits-data.ts
const GO_MODEL_LIMITS = {
	"claude-haiku-5-5": {
		go: 15,
		goPlus: 60,
		name: "Claude Haiku 5.5 (≤ 100K tokens)"
	},
	"deepseek-v4-pro": {
		go: 15,
		goPlus: 60,
		name: "DeepSeek V4 Pro (Off-Peak)"
	},
	"deepseek-v4.1-flash": {
		go: 80,
		goPlus: 160,
		name: "DeepSeek V4.1 Flash (Off-Peak)"
	},
	"gemini-4-argon-contributor": {
		go: NaN,
		goPlus: NaN,
		name: "Gemini 4 Argon Contributor"
	},
	"glm-5.2": {
		go: 60,
		goPlus: 180,
		name: "GLM-5.2"
	},
	"glm-5.3": {
		go: 15,
		goPlus: 120,
		name: "GLM-5.3"
	},
	"glm-5.3-flash": {
		go: 60,
		goPlus: 180,
		name: "GLM-5.3-Flash"
	},
	"gpt-5.6-luna": {
		go: 15,
		goPlus: 60,
		name: "GPT 5.6 Luna (≤ 272K tokens)"
	},
	"gpt-6-luna": {
		go: 15,
		goPlus: 60,
		name: "GPT 6 Luna (≤ 272K tokens)"
	},
	"grok-4.7": {
		go: 15,
		goPlus: 60,
		name: "Grok 4.7 (≤ 200K tokens)"
	},
	hy3: {
		go: 60,
		goPlus: 240,
		name: "Hy3"
	},
	"hy4-preview": {
		go: 30,
		goPlus: 120,
		name: "Hy4 preview"
	},
	"kimi-k2.7-code": {
		go: 60,
		goPlus: 180,
		name: "Kimi K2.7 Code"
	},
	"kimi-k3": {
		go: 15,
		goPlus: 60,
		name: "Kimi K3"
	},
	"longcat-2.0": {
		go: 60,
		goPlus: 240,
		name: "LongCat-2.0"
	},
	"mimo-v2.5": {
		go: 60,
		goPlus: 120,
		name: "MiMo-V2.5"
	},
	"mimo-v2.5-pro": {
		go: 15,
		goPlus: 60,
		name: "MiMo-V2.5-Pro"
	},
	"mimo-v2.6-flash": {
		go: 60,
		goPlus: 120,
		name: "MiMo-V2.6-Flash"
	},
	"mimo-v2.6-pro": {
		go: 15,
		goPlus: 60,
		name: "MiMo-V2.6-Pro"
	},
	"minimax-m3": {
		go: 60,
		goPlus: 180,
		name: "MiniMax M3"
	},
	"minimax-m3.1-flash": {
		go: 20,
		goPlus: 80,
		name: "MiniMax M3.1 Flash"
	},
	"muse-spark-1.2-contributor": {
		go: 60,
		goPlus: 120,
		name: "Muse Spark 1.2 Contributor"
	},
	"muse-spark-1.3-contributor": {
		go: 60,
		goPlus: 120,
		name: "Muse Spark 1.3 Contributor"
	},
	"qwen3.7-plus": {
		go: 60,
		goPlus: 180,
		name: "Qwen3.7 Plus (≤ 256K tokens)"
	},
	"qwen3.8-flash": {
		go: 30,
		goPlus: 90,
		name: "Qwen3.8 Flash"
	},
	"qwen3.8-max": {
		go: 15,
		goPlus: 60,
		name: "Qwen3.8 Max"
	},
	"step-5-preview": {
		go: 15,
		goPlus: 60,
		name: "Step 5 Preview"
	}
};
//#endregion
//#region src/go-limits.ts
/** `mimo-v2.6-flash` → its allowance, or `undefined` when the doc does not list it. */
const allowanceFor = (limits, model) => limits.get(model.trim().toLowerCase());
//#endregion
//#region src/usage-contract.ts
const parseWindow = (row, label) => {
	const { percent, resetsAt, status } = row;
	if (status !== "ok" && status !== "rate-limited") throw new TypeError(`Invalid OpenCode Go status for ${label}`);
	if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) throw new TypeError(`Invalid OpenCode Go percent for ${label}`);
	if (typeof resetsAt !== "string" || !Number.isFinite(Date.parse(resetsAt))) throw new TypeError(`Invalid OpenCode Go resetsAt for ${label}`);
	return {
		percent,
		resetsAt,
		status
	};
};
/**
* Validate and normalize OpenCode Go usage response.
*
* Accepts either `{ usage: { rolling, weekly, monthly } }` (the live API payload)
* or `{ rolling, weekly, monthly }` (unwrapped).
*/
const parseGoUsage = (value) => {
	if (!isRecord(value)) throw new TypeError("Invalid OpenCode Go usage response: expected an object");
	const root = value;
	const source = isRecord(root.usage) ? root.usage : root;
	const rollingRaw = source.rolling;
	const weeklyRaw = source.weekly;
	const monthlyRaw = source.monthly;
	if (!isRecord(rollingRaw) || !isRecord(weeklyRaw) || !isRecord(monthlyRaw)) throw new TypeError("Invalid OpenCode Go usage response: missing window");
	const rolling = parseWindow(rollingRaw, "rolling");
	const weekly = parseWindow(weeklyRaw, "weekly");
	const monthly = parseWindow(monthlyRaw, "monthly");
	const sourceId = typeof root.source === "string" && root.source.length > 0 && root.source.length <= 128 ? root.source : void 0;
	const { zenOverflow: rootOverflow } = root;
	const { zenOverflow: sourceOverflow } = source;
	let zenOverflow;
	if (typeof rootOverflow === "boolean") zenOverflow = rootOverflow;
	else if (typeof sourceOverflow === "boolean") zenOverflow = sourceOverflow;
	let session;
	const sessionRaw = isRecord(root.session) ? root.session : void 0;
	if (sessionRaw !== void 0 && typeof sessionRaw.costFormatted === "string" && typeof sessionRaw.totalTokens === "number") session = {
		...typeof sessionRaw.activeModel === "string" && sessionRaw.activeModel.length > 0 ? { activeModel: sessionRaw.activeModel } : {},
		...typeof sessionRaw.activeModelName === "string" && sessionRaw.activeModelName.length > 0 ? { activeModelName: sessionRaw.activeModelName } : {},
		...typeof sessionRaw.activeRateFormatted === "string" ? { activeRateFormatted: sessionRaw.activeRateFormatted } : {},
		cacheReadTokens: typeof sessionRaw.cacheReadTokens === "number" ? sessionRaw.cacheReadTokens : 0,
		costByPlane: parseCostByPlane(sessionRaw.costByPlane),
		costFormatted: sessionRaw.costFormatted,
		costUsd: typeof sessionRaw.costUsd === "number" ? sessionRaw.costUsd : 0,
		...sessionRaw.freeModel === true ? { freeModel: true } : {},
		inputTokens: typeof sessionRaw.inputTokens === "number" ? sessionRaw.inputTokens : 0,
		modelsUsed: Array.isArray(sessionRaw.modelsUsed) ? sessionRaw.modelsUsed.filter((m) => typeof m === "string") : [],
		outputTokens: typeof sessionRaw.outputTokens === "number" ? sessionRaw.outputTokens : 0,
		totalTokens: sessionRaw.totalTokens,
		turns: typeof sessionRaw.turns === "number" ? sessionRaw.turns : 0
	};
	return {
		monthly,
		rolling,
		...session === void 0 ? {} : { session },
		...sourceId === void 0 ? {} : { source: sourceId },
		weekly,
		...zenOverflow === void 0 ? {} : { zenOverflow }
	};
};
/**
* Validate the optional query. The whole value is optional on the wire
* (`acceptsUndefined`), as is every field within it.
*/
/**
* The per-plane spend, optional on the wire. A snapshot recorded before the
* split carries none; the floor is zero per plane and the ALL-planes total,
* which `costUsd` already holds, still tells the whole story.
*/
const parseCostByPlane = (raw) => {
	const plane = isRecord(raw) ? raw : {};
	return {
		go: typeof plane.go === "number" ? plane.go : 0,
		zen: typeof plane.zen === "number" ? plane.zen : 0
	};
};
const parseUsageQuery = (value) => {
	if (value === void 0 || value === null) return {};
	if (!isRecord(value)) throw new TypeError("Invalid OpenCode usage query: expected an object");
	const { model, provider, sessionId } = value;
	return {
		...typeof model === "string" && model.length > 0 ? { model } : {},
		...typeof provider === "string" && provider.length > 0 ? { provider } : {},
		...typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : {}
	};
};
//#endregion
//#region src/usage.ts
/**
* Host-side service that queries OpenCode Go usage statistics without
* exposing credentials to the client, plus its Typert remote registration.
*
* Credential and gateway resolution live in `go-discovery.ts` (shared with
* the `apply()` wiring); this module owns the service lifecycle, the quota
* fetch, and the typed errors the client meter reacts to.
*
* @module dsh-opencode-patch/usage
*/
const USAGE_MAX_BYTES = 1048576;
/** Stable failure code shared by every quota-fetch failure path. */
const USAGE_UNAVAILABLE = "opencode-go/usage-unavailable";
const isMissingCredential = (error) => {
	if (!(error instanceof Error)) return false;
	if (!("code" in error)) return false;
	return error.code === "MISSING_CREDENTIAL";
};
/**
* The reading served when the account is on Zen overflow: Go has no quota to
* report (no key, or a Go subscription the account is not entitled to), so
* every window sits at zero and the meter hands over to Zen balance.
*
* @param source - opaque host identity for the endpoint/account.
* @param sessionId - conversation whose spend to attach, when known.
*/
const zenOverflowUsage = (source, sessionId, query) => {
	const resetsAt = (/* @__PURE__ */ new Date()).toISOString();
	const window = () => ({
		percent: 0,
		resetsAt,
		status: "ok"
	});
	const session = attachSession(sessionId, query);
	return {
		monthly: window(),
		rolling: window(),
		quotaUnavailable: true,
		...session === void 0 ? {} : { session },
		source,
		weekly: window(),
		zenOverflow: true
	};
};
/**
* Attach session spend, re-described for the model the picker is on.
*
* The accumulator's own `active*` fields name the model that ran the LAST turn.
* The rate shown beside the figure is prospective, so when the caller says which
* model is selected and it differs, that identity and the catalog rate for it
* win. The Host owns the catalog — the client ships no rates — so this is the
* only side that can answer "what does the next turn cost".
*/
const attachSession = (sessionId, query) => {
	const session = getSessionUsage(sessionId);
	if (session === void 0) return;
	const plane = catalogPlaneForRoute(query?.provider ?? "");
	const selected = query?.model;
	if (!(selected !== void 0 && selected.length > 0 && selected !== session.activeModel)) return withPlaneSpend(nameModel(session, plane), plane);
	const spec = catalogFor(plane, selected);
	return withPlaneSpend(nameModel(describeModel(session, selected, spec?.cost, spec?.is_free === true, spec?.name), plane), plane);
};
/**
* Project THIS route's plane spend onto the snapshot as `planeCostFormatted`.
*
* The accumulator's `costUsd` is the session's ALL-planes total, which is the
* wrong number for a panel that answers for one balance: the Zen row read $1.44
* of Go allowance spend against a FREE model, and the owner read it as Zen
* charging $1.44 for a model that is free. The split travels on the snapshot
* (`costByPlane`); this is where the reading picks its own plane's number. The
* all-planes total stays on `costUsd` for anything that wants the whole story.
*/
const withPlaneSpend = (snapshot, plane) => ({
	...snapshot,
	planeCostFormatted: formatUsd(snapshot.costByPlane[plane]),
	planeSpendUsd: snapshot.costByPlane[plane]
});
/** The catalog spec for a model, or `undefined` when the catalog has none. */
const catalogFor = (plane, model) => findModelSpecOn(plane, model);
/**
* Fill in the display name, which a recorded turn never carries.
*
* A turn records the model ID — that is what the gateway speaks — so the first
* reading of a session has no name, and the meter's row falls back to
* `muse-spark-1.3-contributor-free`: a debug value, in a row that also says the
* model is free. The catalog is the only thing that knows the other half, and
* this is the one place that can reach it for the model being described.
*/
const nameModel = (snapshot, plane) => {
	const model = snapshot.activeModel;
	if (snapshot.activeModelName !== void 0 || model === void 0 || model.length === 0) return snapshot;
	const spec = catalogFor(plane, model);
	return spec === void 0 ? snapshot : {
		...snapshot,
		activeModelName: spec.name
	};
};
/**
* Attach the selected model's monthly allowance, from the generated limits table.
*
* Resolved on the Host for the same reason the rate is: the table is generated
* from the vendor's docs and belongs beside the catalog it is joined against, so
* the client ships neither. Unknown models get nothing — the row then simply is
* not rendered, which is the honest outcome for a model the plan does not list
* (an unlimited one, or one newer than the table).
*
* Both tiers travel together. The plan is not discoverable — `/limits`, `/plan`,
* `/subscription`, `/account` all 404 — so choosing one here would mean
* guessing, and a wrong tier misstates the money by 2-3x.
*/
const attachAllowance = (query) => {
	const model = query?.model?.trim() ?? "";
	if (model.length === 0) return;
	const row = allowanceFor(GO_MODEL_LIMITS_BY_ID, model);
	if (row === void 0) return;
	return {
		go: row.go,
		goPlus: row.goPlus,
		model
	};
};
/** Normalize a base URL to the Go `/usage` endpoint, without a trailing slash. */
const usageEndpointBase = (rawBaseURL) => toGoBaseURL(rawBaseURL).replace(/\/$/, "");
/**
* The generated limits as the Map `allowanceFor` reads.
*
* Built once: the generated file is a record, the lookup takes a Map, and
* converting per call would be the same lookup written a third way.
*/
const GO_MODEL_LIMITS_BY_ID = new Map(Object.entries(GO_MODEL_LIMITS));
var GoUsageService = class extends TypertRemoteService {
	identity;
	options;
	constructor(ctx, options = {}) {
		if (!isRecord(ctx)) throw new TypeError("GoUsageService requires a Cordis context object");
		super(ctx, "opencodeGoUsage");
		this.options = options;
	}
	async read(query) {
		const targetProvider = query?.provider;
		const sessionId = query?.sessionId;
		const discovered = discoverGoConfig(this.ctx, targetProvider);
		const rawBaseURL = this.options.baseURL?.() ?? discovered.baseURL ?? "https://opencode.ai/zen/go/v1";
		const baseURL = usageEndpointBase(rawBaseURL);
		const keyRef = effectiveGoKeyRef(discovered);
		let key;
		try {
			key = this.options.resolveApiKey ? await this.options.resolveApiKey() : await resolveGoApiKey(this.ctx, targetProvider, this.options.keySource ?? "auto", this.options.readOpencodeStore === true);
		} catch (error) {
			this.identity = void 0;
			const missing = isMissingCredential(error);
			throw new RemoteError(USAGE_UNAVAILABLE, missing ? "OpenCode Go API key is not configured" : "Could not resolve OpenCode Go API key", {
				...missing ? { configured: false } : {},
				retainPrevious: false,
				retryable: !missing
			}, { cause: error });
		}
		if (key === void 0 || key.length === 0) {
			if ((await resolveZenCreditInfo(this.ctx)).isConfigured || targetProvider === "opencode") return zenOverflowUsage(randomUUID(), sessionId, query);
			this.identity = void 0;
			throw new RemoteError(USAGE_UNAVAILABLE, "OpenCode Go API key is not configured", {
				configured: false,
				retainPrevious: false,
				retryable: false
			});
		}
		if (this.identity?.baseURL !== baseURL || this.identity.key !== keyRef) this.identity = {
			baseURL,
			key: keyRef,
			source: randomUUID()
		};
		const { source } = this.identity;
		const url = `${baseURL}/usage`;
		let response;
		let text;
		try {
			response = await fetch(url, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${key}`,
					"User-Agent": OPENCODE_PATCH_USER_AGENT,
					"x-opencode-client": "cli",
					"x-opencode-project": "global"
				},
				redirect: "error",
				signal: AbortSignal.timeout(1e4)
			});
			text = await response.text();
		} catch (error) {
			throw new RemoteError(USAGE_UNAVAILABLE, `Could not read ${url}: ${error instanceof Error ? error.message : String(error)}`, {
				retainPrevious: true,
				retryable: true,
				source
			}, { cause: error });
		}
		if (text.length > USAGE_MAX_BYTES) throw new RemoteError(USAGE_UNAVAILABLE, `Response from ${url} exceeds ${USAGE_MAX_BYTES} byte limit`, {
			retainPrevious: false,
			retryable: true,
			source
		});
		if (!response.ok) {
			const isZen = isZenProvider(targetProvider);
			if (response.status === 403 && text.includes("EntitlementError") || response.status === 401 && isZen) {
				if ((await resolveZenCreditInfo(this.ctx)).isConfigured || isZen) return zenOverflowUsage(source, sessionId, query);
				throw new RemoteError(USAGE_UNAVAILABLE, "OpenCode Go subscription required", {
					configured: false,
					retainPrevious: false,
					retryable: false
				});
			}
			const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
			throw new RemoteError(USAGE_UNAVAILABLE, response.status === 401 ? "OpenCode Go rejected the API key for this account" : `OpenCode Go usage unavailable (HTTP ${response.status})`, {
				retainPrevious: temporary,
				retryable: temporary,
				source,
				...response.status === 401 ? { reason: "auth" } : {}
			});
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new RemoteError(USAGE_UNAVAILABLE, "Invalid JSON in OpenCode Go usage response", {
				retainPrevious: false,
				retryable: true,
				source
			}, { cause: error });
		}
		try {
			const usage = parseGoUsage(parsed);
			const zenInfo = await resolveZenCreditInfo(this.ctx);
			const session = attachSession(sessionId, query);
			const allowance = attachAllowance(query);
			return {
				...usage,
				...allowance === void 0 ? {} : { allowance },
				...session === void 0 ? {} : { session },
				source,
				zenOverflow: zenInfo.isConfigured
			};
		} catch (error) {
			throw new RemoteError(USAGE_UNAVAILABLE, "Invalid OpenCode Go usage response structure", {
				retainPrevious: false,
				retryable: true,
				source
			}, { cause: error });
		}
	}
};
/**
* Declare `read` as a Remote method — exactly what `@Remote()` does.
*
* The decorator cannot be used: this build transform is oxc/rolldown based and
* rejects TC39 decorator syntax outright ("SyntaxError: Invalid or unexpected
* token"), and `esbuild: { target: "esnext" }` is ignored by it. The decorator has
* no magic — it registers an instance initializer calling
* `mark(prototype, method, invocation)`, and `mark` only writes this one property.
* `remoteMethods()` reads it straight off the prototype, so writing it directly
* is equivalent. Swap for the decorator once the transform accepts one.
*/
Object.defineProperty(GoUsageService.prototype, "@deepseek-ai/dsh-typert-protocol/remote-methods", {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze([{
			method: "read",
			invocation: { kind: "direct" }
		}])
	})
});
//#endregion
//#region src/lifecycle.ts
/**
* Plugin lifecycle: the `apply()` entry point and its installers.
*
* `apply()` is a composition of small, independently readable installers, one
* per side effect the plugin has on the host:
*
* | installer                | side effect                                   |
* | ------------------------ | --------------------------------------------- |
* | {@link logRenameNotice}  | one-time notice for legacy rows                |
* | {@link installUsageService} | register the Go quota service + remotes     |
* | {@link installFetchPatch}   | wrap `globalThis.fetch` (returns `false` if none) |
* | {@link installStreamHook}   | capture turn state on `llm/stream`          |
* | {@link installModelDiscovery} | publish the canonical catalog to the picker |
*
* Order is load-bearing and documented at the call site in {@link apply}.
*
* @module dsh-opencode-patch/lifecycle
*/
/**
* One catalog row in the shape DSH's model-discovery surface expects.
*
* Models whose SDK no route serves are dropped: offering them would be offering
* a model that cannot work, and the user has no way to tell that from the row.
*/
const toDiscovered = (specs, maxContextWindow, modelOverrides) => specs.filter((m) => isServableSdk(m.provider_npm)).map((m) => {
	const override = modelOverrides?.[m.id];
	const baseContext = override?.contextWindow ?? m.context_window;
	return {
		contextWindow: typeof maxContextWindow === "number" && maxContextWindow > 0 ? Math.min(baseContext, maxContextWindow) : baseContext,
		id: m.id,
		inputModalities: override?.inputModalities === void 0 ? sanitizeModalities(m.input_modalities) : [...override.inputModalities],
		maxTokens: override?.maxTokens ?? m.max_output_tokens,
		name: override?.name ?? m.name
	};
});
/** Tell a row still configured under the pre-rename id/package to update. */
const logRenameNotice = (ctx) => {
	const entryOptions = readEntryOptions(ctx);
	if (entryOptions?.name === "@viztor/dsh-opencode" || entryOptions?.id === "dsh-opencode") ctx.logger?.info?.("[dsh-opencode-patch] Notice: \"@viztor/dsh-opencode\" has been renamed to \"dsh-opencode-patch\". Please update your profile configuration.");
};
/**
* Register the Go quota service and its Typert remote face.
*
* Runs before the fetch patch so a composition without `globalThis.fetch`
* still gets a working meter.
*/
/**
* Publish a service through `ctx.provide`, when `ctx.plugin` is not available.
*
* The fallback exists because a service the client cannot reach has no way to say
* so from the host: the installers report through `ctx.logger`, and a host that
* writes no log file turns every one of those into a silence. `provide` reaches
* the same lookup under the same name, which is the half that matters.
*
* @param ctx - the host context.
* @param name - the service name the client looks for.
* @param Service - the service class.
* @param options - its constructor options.
*/
const mountByProvide = (ctx, serviceName, Service, options) => {
	const { provide } = ctx;
	if (typeof provide !== "function") {
		ctx.logger?.warn?.(`[dsh-opencode-patch] ${serviceName} did not mount: this composition has neither ctx.plugin nor ctx.provide`);
		return;
	}
	try {
		provide.call(ctx, serviceName, new Service(ctx, options));
	} catch (error) {
		ctx.logger?.warn?.(`[dsh-opencode-patch] ${serviceName} did not mount`, error);
	}
};
/**
* Roots that already carry the usage service.
*
* Keyed on the ROOT context rather than the activation, so a live reload neither
* registers a duplicate nor loses the one it has. See {@link installUsageService}
* for the measured failure this prevents.
*/
const usageMountedOn = /* @__PURE__ */ new WeakSet();
const installUsageService = (ctx, config) => {
	if (!config.usageEnabled) {
		ctx.logger?.info?.("[dsh-opencode-patch] usage service NOT registered; the meter will render nothing");
		return;
	}
	const usageOptions = {
		baseURL: () => resolveGoBaseURL(ctx, config.usageBaseURL),
		keySource: config.keySource,
		readOpencodeStore: config.readOpencodeStore
	};
	if (typeof ctx.plugin !== "function") {
		mountByProvide(ctx, "opencodeGoUsage", GoUsageService, usageOptions);
		return;
	}
	const root = ctx.root ?? ctx;
	if (usageMountedOn.has(root)) {
		verifyUsageService(root);
		return;
	}
	usageMountedOn.add(root);
	try {
		root.plugin?.(GoUsageService, usageOptions);
	} catch (error) {
		usageMountedOn.delete(root);
		ctx.logger?.warn?.("[dsh-opencode-patch] the usage service did not mount; the meter will render nothing", error);
	}
	verifyUsageService(root);
};
/**
* Confirm the usage service is REACHABLE from the context, and say so either way.
*
* The client reported, from a browser console:
*
*   the usage meter is not rendering: no usage service: remote.opencodeGoUsage.read is missing
*
* That names the client's half as fine (the contribution mounts, the descriptor
* names `service: "opencodeGoUsage"`). The Gateway exposes a namespace from the
* host's registry, so what is missing is a Service it can find — and there are
* three ways that happens with nothing in the client to show it:
*
*  1. the host never registered it (this installer threw, or `usageEnabled` is off
*     in the row the host actually loaded);
*  2. it registered under another key;
*  3. it registered as a VALUE (`ctx.provide`) rather than a Service, and the
*     Gateway's "source-mode discovery" scans services, so a provided value is
*     invisible to it even though `ctx.get` can see it.
*
* Cases 2 and 3 are indistinguishable from the client and from here, so this reads
* the service back through the same context and reports what it found: whether it
* resolved, and whether it carries the `typertRemote` binding the Gateway scans
* for. One line, once per process, so the next console says which case it is
* instead of a meter that is merely absent.
*/
const verifyUsageService = (ctx) => {
	let resolved;
	try {
		resolved = typeof ctx.get === "function" ? ctx.get("opencodeGoUsage") : void 0;
	} catch {
		resolved = void 0;
	}
	if (!isRecord(resolved)) {
		ctx.logger?.warn?.("[dsh-opencode-patch] the usage service did not register: ctx.get('opencodeGoUsage') answered nothing", "the meter will render nothing with 'no usage service'");
		return;
	}
	const binding = resolved.typertRemote;
	if (!isRecord(binding)) {
		ctx.logger?.warn?.("[dsh-opencode-patch] the usage service registered but carries no typertRemote binding", "the Gateway's source-mode discovery will not find it; ctx.provide() publishes a value, not a Service", "the meter will render nothing with 'no usage service'");
		return;
	}
	ctx.logger?.info?.("[dsh-opencode-patch] the usage service is reachable with a typertRemote binding for namespace %s", typeof binding.namespace === "string" ? binding.namespace : "(unnamed)");
};
/**
* Wrap `globalThis.fetch` so claimed OpenCode traffic carries session affinity
* and the gateway headers, restoring both on dispose.
*
* @returns `false` when there is no fetch to wrap. The caller then stops: the
* stream hook and discovery must not attach, or turns would run without the
* session affinity this plugin exists to provide.
*/
/**
* Roots that already carry the purge service, for the same reason the usage
* service keeps its own set: `apply` runs once per live reload, and a service
* tied to the activation fiber dies with it while a second registration is
* refused as a duplicate. Process-scoped is what a Gateway-scanned service wants.
*/
const purgeMountedOn = /* @__PURE__ */ new WeakSet();
const installPurgeService = (ctx) => {
	const root = ctx.root ?? ctx;
	if (purgeMountedOn.has(root)) return;
	purgeMountedOn.add(root);
	if (typeof ctx.plugin !== "function") {
		mountByProvide(ctx, "opencodeModelPurge", ModelPurgeService);
		return;
	}
	try {
		root.plugin?.(ModelPurgeService);
	} catch (error) {
		purgeMountedOn.delete(root);
		console.warn("[dsh-opencode-patch] the purge service did not mount; the card will say so", error);
	}
};
const storeMountedOn = /* @__PURE__ */ new WeakSet();
const installStoreService = (ctx) => {
	const root = ctx.root ?? ctx;
	if (storeMountedOn.has(root)) return;
	storeMountedOn.add(root);
	if (typeof ctx.plugin !== "function") {
		mountByProvide(ctx, STORE_NAMESPACE, OpencodeStoreService);
		return;
	}
	try {
		root.plugin?.(OpencodeStoreService);
	} catch (error) {
		storeMountedOn.delete(root);
		console.warn("[dsh-opencode-patch] the opencode store inspection service did not mount", error);
	}
};
const installFetchPatch = (ctx, config, als) => {
	const originalFetch = globalThis.fetch;
	if (!isFetchFunction(originalFetch)) {
		ctx.logger?.warn?.("[dsh-opencode-patch] globalThis.fetch is unavailable; cannot inject x-opencode-session");
		return false;
	}
	const patched = patchFetch(originalFetch, als, config, {
		resolveOrg: () => config.credentialOrg,
		// 把"声明的 key"改为经凭据服务解析：本机 key 存在 WB 凭据库，process.env 为空。
		resolveDeclaredKey: (ref) => resolveRef(ctx, ref),
		...config.debug && config.debugFile !== void 0 ? { debug: (entry) => {
			recordDebug(ctx, config.debugFile ?? "", entry);
		} } : {}
	});
	ctx.effect?.(() => {
		globalThis.fetch = patched;
		console.info(`[dsh-opencode-patch] active for providers [${[...config.providers].join(", ")}]`);
		const stopDiscoveryDecoration = decorateModelDiscovery(ctx, config);
		const stopModelInfoDecoration = decorateModelInfo(ctx, config);
		const stopAdapterDecoration = decoratePlaneAdapters(ctx.llm, config);
		// ctx 一并传入：hasPlaneCredential 需要它走凭据服务取 key（见该函数内 shortcut 注释）。
		const stopCatalogHiding = hideResponsesRoute(ctx, config, { hasCredential: (plane) => hasPlaneCredential(plane, ctx, config) });
		let stopResponsesProvider;
		let released = false;
		const releaseResponsesProvider = () => {
			released = true;
			stopResponsesProvider?.();
			stopResponsesProvider = void 0;
		};
		(async () => {
			const stop = await registerResponsesProvider(ctx, config);
			if (released) {
				stop?.();
				return;
			}
			stopResponsesProvider = stop;
		})();
		return () => {
			releaseResponsesProvider();
			stopCatalogHiding?.();
			stopDiscoveryDecoration?.();
			stopModelInfoDecoration?.();
			stopAdapterDecoration?.();
			if (globalThis.fetch === patched) globalThis.fetch = originalFetch;
		};
	}, "dsh-opencode-patch.fetch-patch");
	return true;
};
/** Capture turn state (session id, project, parent) on every streamed turn. */
const installStreamHook = (ctx, config, als) => {
	ctx.on?.("llm/stream", createStreamHook(ctx, config, als), { prepend: true });
};
/**
* Publish the canonical Go/Zen catalog to DSH's model discovery.
*
* Model discovery is part of the same "canonical catalog" feature as the
* gateway listing enrichment, so both sit behind the one `enrichModels`
* toggle: turning it off leaves DSH's own catalog and the raw gateway
* listings untouched.
*/
const installModelDiscovery = (ctx, config) => {
	if (!config.enrichModels) return;
	try {
		const { llm } = ctx;
		if (typeof llm?.registerModelDiscovery !== "function") return;
		llm.registerModelDiscovery(name, () => Promise.resolve(toDiscovered([...getLiveGoCatalog(), ...getLiveZenCatalog()], config.maxContextWindow, config.modelOverrides)));
		llm.registerModelDiscovery("opencode-go", () => Promise.resolve(toDiscovered(getLiveGoCatalog(), config.maxContextWindow, config.modelOverrides)));
		llm.registerModelDiscovery("opencode", () => Promise.resolve(toDiscovered(getLiveZenCatalog(), config.maxContextWindow, config.modelOverrides)));
	} catch {}
};
/**
* Plugin entry: register the quota service, patch `fetch` for OpenCode
* traffic, and capture turn state for configured providers.
*
* Order matters:
* 1. the rename notice, so it is the first thing a legacy row logs;
* 2. the quota service, before the fetch patch, so a composition without
*    `globalThis.fetch` still gets a working meter;
* 3. the fetch patch, which bails out (warning) when there is nothing to
*    wrap — `on` must not be attached in that case, or turns would run
*    without session affinity;
* 4. the stream hook and model discovery, which only make sense once the
*    request path is patched.
*
* @param ctx - the Cordis host context.
* @param rawConfig - the row config, if any.
*/
/**
* Whether this plane holds a credential the gateway would accept.
*
* Deliberately synchronous and deliberately generous: a declared env key, a key
* captured from a live request, or an org written by a completed login. The
* SQLite store is not consulted because it is opt-in and off by default, and
* calling a deployment "keyless" when it does hold a credential would hide models
* it can actually use.
*
* @param plane - the gateway plane.
* @returns whether any credential is known for it.
*/
const hasPlaneCredential = async (plane, ctx, config) => {
	// shortcut: 上游只读 process.env，会把"key 在插件配置或凭据库里、环境变量没有"的
	// 部署误判成无凭据，进而隐藏全部付费模型。改为：插件配置 → 凭据服务 → env → 捕获值。
	const fromConfig = typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
	if (fromConfig.length > 0 && !isPlaceholderApiKey(fromConfig)) return true;
	const ref = typeof config?.apiKeyEnv === "string" && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : (plane === "opencode-go" ? "OPENCODE_GO_API_KEY" : "OPENCODE_API_KEY");
	const declared = await resolveRef(ctx, ref);
	if (typeof declared === "string" && declared.length > 0 && !isPlaceholderApiKey(declared)) return true;
	return getCapturedApiKey(plane) !== void 0;
};
const apply = (ctx, rawConfig = {}) => {
	const config = resolveConfig(rawConfig);
	const als = new AsyncLocalStorage();
	logRenameNotice(ctx);
	installUsageService(ctx, config);
	installPurgeService(ctx);
	installStoreService(ctx);
	if (!installFetchPatch(ctx, config, als)) return;
	installStreamHook(ctx, config, als);
	installModelDiscovery(ctx, config);
};
//#endregion
export { ALL_MODELS_MARKER, ANTHROPIC_ROUTE, ANTHROPIC_SDK, CATALOG_REVALIDATION_TTL_MS, CONFIG_DEFAULTS, Config, DEFAULT_ENDPOINT_FAMILY, DEFAULT_FREE_MODEL_MARKER, DEFAULT_GATEWAY_URLS, DEFAULT_INJECT_PROJECT, DEFAULT_KEY_SOURCE, DEFAULT_ORIGIN_CLIENT, DEFAULT_PROVIDERS, DEFAULT_SESSION_ID_ENV, DEFAULT_USAGE_BASE_URL, DEFAULT_USAGE_KEY_ENV, DSH_SUPPORTED_MODALITIES, DUMMY_BASH_TOOL, DUMMY_READ_TOOL, ENDPOINT_FAMILIES, GOOGLE_INTERNAL_ROUTE, GOOGLE_SDK, GO_ANTHROPIC_ROUTE, GO_RESPONSES_ROUTE, GoUsageService, INTERNAL_ROUTES, KEY_SOURCE_POLICIES, LEGACY_NAME, LEGACY_PKG, MISTRAL_SDK, MODELS_DEV_TIMEOUT_MS, MODELS_DEV_URL, MODELS_OPENCODE_URL, OPENCODE_CLI_VERSION, OPENCODE_GO_CATALOG, OPENCODE_PATCH_USER_AGENT, OPENCODE_UA, OPENCODE_USER_AGENT, OPENCODE_ZEN_CATALOG, PARENT_SESSION_ALT_HEADER, PARENT_SESSION_HEADER, PLANES, PROTOCOL_FOR_SDK, RESPONSES_PATH, RESPONSES_ROUTE, RESPONSES_SDK, ROUTE_FOR_PLANE_PROTOCOL, ROUTE_FOR_PROTOCOL, SELF_MOUNTED_ROUTES, SESSION_AFFINITY_HEADER, SESSION_HEADER, UNSERVED_SDKS, apply, calculateTurnCost, catalogPlaneForRoute, clearCapturedApiKeys, clearSessionUsageStore, decorateModelDiscovery, decorateModelInfo, decoratePlaneAdapters, describeModel, discoverGoConfig, effectiveGoKeyRef, enrichModelsResponse, extractApiKeyFromHeaders, fallbackSessionId, findModelSpec, findModelSpecOn, formatModelRate, formatUsd, getCapturedApiKey, getLiveCatalog, getLiveGoCatalog, getLiveZenCatalog, getSessionUsage, hasSessionHeader, headerValueFor, hideResponsesRoute, inheritedCredentialRef, inject, internalRouteFor, isCoreToolModel, isDeprecatedModelOn, isGoModelsListingUrl, isInternalRoute, isModelsListingUrl, isOpenCodeMessageId, isOpenCodeRequest, isOpenCodeSessionId, isPlaceholderApiKey, isRouteRegistered, isServableSdk, loadPiAi, maybeInjectCoreTools, mergeDiscoveredModels, modelsForSdk, name, narrowToDeclared, newOpenCodeMessageId, openCodeSessionIdFor, parseGoUsage, parseModelsDevCatalog, parseUsageQuery, patchFetch, pinnedSessionId, readBoolean, readString, readStringList, recordCapturedApiKey, recordTurnUsage, refreshCatalog, registerResponsesProvider, resolveConfig, resolveDiscoveryProvider, resolveEffectiveContextWindow, resolveGoApiKey, resolveGoBaseURL, resolveOpencodeStoreKey, resolveRoutedKey, resolveZenCreditInfo, sanitizeModalities, sessionIdForRequest, tierForRequest, toGoBaseURL, undescribedDeclaredModels, unroutedDeclaredModels, unwrapNode, withStore };
