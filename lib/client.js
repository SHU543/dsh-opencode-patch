(function() {
  var factory = function(require) {
    var module = { exports: {} };
    var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react = require("react");
react = __toESM(react, 1);
let react_jsx_runtime = require("react/jsx-runtime");
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
//#endregion
//#region src/config-values.ts
/**
* Coercion readers shared by the host config resolver and the client card, so
* both apply the same "absent or invalid means default" rule. Dependency-free by
* design: importing schemastery would ship the validator to the browser.
*
* @module dsh-opencode-patch/config-values
*/
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
//#endregion
//#region src/purge-contract.ts
/** The remote namespace the host mounts and the card calls. */
const PURGE_NAMESPACE = "opencodeModelPurge";
/** Whether a value is one `PurgedModel` row. */
const isPurgedModel = (value) => typeof value === "object" && value !== null && typeof value.id === "string" && typeof value.provider === "string";
/**
* Parse a purge result, rejecting anything that is not one.
*
* A whitelist, like every other codec on this seam: the client renders what it
* is told, so it must be told only the fields it renders.
*
* @param value - the decoded wire value.
* @returns the result, or `undefined` when it is not one.
*/
const parsePurgeResult = (value) => {
	if (typeof value !== "object" || value === null) return;
	const { removed, catalogRead } = value;
	if (!Array.isArray(removed) || typeof catalogRead !== "boolean") return;
	const rows = [];
	for (const row of removed) {
		if (!isPurgedModel(row)) return;
		rows.push({
			id: row.id,
			provider: row.provider,
			...typeof row.site === "string" ? { site: row.site } : {}
		});
	}
	return {
		catalogRead,
		removed: rows
	};
};
/**
* The purge namespace, as a contribution the client mounts.
*
* **Without a descriptor the namespace never reaches the browser.** The host
* mounts the Service and the card asks `remote.opencodeModelPurge.purge`; a
* Remote is only reachable when a contribution carrying its descriptor was
* mounted on the client, so the row reported "unavailable" for a host that had
* the service all along. Same shape as `usageRemote`, and the card mounts both
* under one package name.
*/
const purgeRemote = {
	descriptors: [{
		id: "dsh-opencode-patch#opencodeModelPurge/purge",
		invocation: { kind: "direct" },
		method: "purge",
		namespace: PURGE_NAMESPACE,
		parameters: [],
		result: {
			create: () => ({ parse: parsePurgeResult }),
			mode: "strict",
			schema: { parse: parsePurgeResult },
			typeSymbol: "dsh-opencode-patch#PurgeResult"
		},
		service: PURGE_NAMESPACE
	}],
	package: "dsh-opencode-patch"
};
//#endregion
//#region src/settings-field-shell.tsx
/**
* Shared chrome for the card's non-text controls: label, override badge with its
* reset, the control, and one message line. Keeping it here leaves each control
* only what differs.
*
* @module dsh-opencode-patch/settings-field-shell
*/
const SettingsFieldShell = (props) => {
	const hint = props.hint ?? "";
	const hasMessage = props.invalid || hint !== "";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: "6px",
			padding: "12px 0"
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				alignItems: "center",
				display: "flex",
				gap: "8px"
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					alignItems: "center",
					display: "flex",
					flex: "1",
					gap: "4px",
					minWidth: 0
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: props.id,
					style: {
						color: "var(--dsw-alias-label-primary)",
						flex: "0 1 auto",
						fontSize: "13px",
						fontWeight: 500,
						lineHeight: 1.5
					},
					children: props.label
				}), props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						alignItems: "center",
						display: "inline-flex",
						gap: "8px"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						tone: "neutral",
						children: props.overriddenLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						disabled: props.disabled,
						onClick: props.onReset,
						size: "sm",
						variant: "ghost",
						children: props.resetLabel
					})]
				}) : null]
			}), props.children]
		}), hasMessage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: {
				color: props.invalid ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-tertiary)",
				fontSize: "12px",
				lineHeight: 1.5,
				margin: 0
			},
			children: props.invalid ? props.invalidLabel : hint
		}) : null]
	});
};
//#endregion
//#region src/settings-boolean-field.tsx
/**
* Boolean settings field: the injected `Switch` inside the shared
* {@link SettingsFieldShell}. See `AGENTS.md` → "Why the card owns its
* boolean/list fields".
*
* @module dsh-opencode-patch/settings-boolean-field
*/
const SettingsBooleanField = (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsFieldShell, {
	disabled: props.disabled,
	hint: props.hint,
	id: props.id,
	invalid: props.invalid,
	invalidLabel: props.invalidLabel,
	label: props.label,
	onReset: props.onReset,
	overridden: props.overridden,
	overriddenLabel: props.overriddenLabel,
	resetLabel: props.resetLabel,
	children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
		checked: props.text === "true",
		disabled: props.disabled,
		label: props.label,
		onChange: (next) => {
			props.onEdit(String(next));
		}
	})
});
//#endregion
//#region src/settings-choice-field.tsx
/**
* Constrained-choice settings field for the OpenCode Patch card.
*
* A native `<select>` inside the shared {@link SettingsFieldShell}: keyboard- and
* screen-reader-correct, and unable to express a value outside the option set.
* That is the host's own idiom for a stored enum — `ui-settings-models`'
* `ProviderEditor` renders its protocol picker the same way, down to the "name
* the empty option so a screen reader does not announce a choice with no
* identity" rule. Its stylesheet is private, so {@link SELECT_STYLE} mirrors
* `ModelsSection.module.css`'s `.input` / `select.input` / `.selectInput` with the
* same design tokens.
*
* Copy-agnostic: the card resolves each option's label before passing it.
*
* @module dsh-opencode-patch/settings-choice-field
*/
/**
* The settings form's input metrics (`fields.module.css`'s `.input`), plus the
* chevron and `appearance: none` an enum picker needs. Matching `.input` rather
* than a text field's look is the point: this control sits directly beside
* `SettingsValueField` rows and has to read as the same kind of control.
*/
const SELECT_STYLE = {
	appearance: "none",
	backgroundColor: "var(--dsw-alias-bg-layer-3)",
	backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
	backgroundPosition: "right 12px center",
	backgroundRepeat: "no-repeat",
	backgroundSize: "12px 12px",
	border: "0.5px solid var(--dsw-alias-border-l4)",
	borderRadius: "var(--dsw-radius-md)",
	boxSizing: "border-box",
	color: "var(--dsw-alias-label-primary)",
	cursor: "pointer",
	font: "inherit",
	fontSize: "13px",
	height: "34px",
	lineHeight: 1.5,
	maxWidth: "240px",
	padding: "0 32px 0 12px"
};
/** 本机新增：文本框样式，与 SELECT_STYLE 同源，只是不需要下拉箭头。 */
const TEXT_STYLE = {
	backgroundColor: "var(--dsw-alias-bg-layer-3)",
	border: "0.5px solid var(--dsw-alias-border-l4)",
	borderRadius: "var(--dsw-radius-md)",
	boxSizing: "border-box",
	color: "var(--dsw-alias-label-primary)",
	font: "inherit",
	fontSize: "13px",
	height: "34px",
	lineHeight: 1.5,
	maxWidth: "360px",
	padding: "0 12px",
	width: "100%"
};
const SettingsChoiceField = (props) => {
	const known = props.options.some((option) => option.value === props.text);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsFieldShell, {
		disabled: props.disabled,
		hint: props.hint,
		id: props.id,
		invalid: props.invalid,
		invalidLabel: props.invalidLabel,
		label: props.label,
		onReset: props.onReset,
		overridden: props.overridden,
		overriddenLabel: props.overriddenLabel,
		resetLabel: props.resetLabel,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
			"aria-label": props.label,
			disabled: props.disabled,
			id: props.id,
			onChange: (event) => {
				props.onEdit(event.target.value);
			},
			style: SELECT_STYLE,
			value: props.text,
			children: [known ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: props.text }), props.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
				value: option.value,
				children: option.label
			}, option.value))]
		})
	});
};
/**
* 本机新增：自由文本字段（API key 用）。
* 宿主没有 text 控件，这里照 SettingsChoiceField 的形状自己画一个 input。
*/
const SettingsTextField = (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsFieldShell, {
	disabled: props.disabled,
	hint: props.hint,
	id: props.id,
	invalid: props.invalid,
	invalidLabel: props.invalidLabel,
	label: props.label,
	onReset: props.onReset,
	overridden: props.overridden,
	overriddenLabel: props.overriddenLabel,
	resetLabel: props.resetLabel,
	children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
		"aria-label": props.label,
		disabled: props.disabled,
		id: props.id,
		onChange: (event) => {
			props.onEdit(event.target.value);
		},
		placeholder: props.placeholder,
		spellCheck: false,
		autoComplete: "off",
		style: TEXT_STYLE,
		type: "password",
		value: props.text
	})
});
//#endregion
//#region src/settings-copy.ts
/**
* Locale dictionaries for the OpenCode Patch card and quota meter. `zh` is typed
* against `en`'s key set, so a missing translation fails typecheck instead of
* surfacing as a raw key in the UI.
*
* @module dsh-opencode-patch/settings-copy
*/
const en = {
	description: "OpenCode Zen gateway origin headers, session affinity, free-tier compatibility, and live Go quota display.",
	enrichModels: "Enrich model metadata from the OpenCode catalog (default on)",
	enrichModelsHint: "Fills context limits, modalities and thinking levels from the OpenCode catalog (models.opencode.ai — the same registry models.dev serves) into the model info, and lets the gateway's /models listing carry the full catalog. It does NOT add models to the picker — the picker shows only what you declared; use \"Check catalog\" above for that. Off leaves both the listing and the model info as the gateway sent them.",
	endpoint: "API Endpoint",
	endpointAuto: "Automatic (follow the catalog)",
	endpointHint: "Which endpoint family requests are sent to. Automatic follows the gateway's own catalog address; the other two pin one. The older and newer families are separately entitled and both still answer, so pick whichever your account works on rather than whichever is current.",
	apiKey: "API key",
	apiKeyHint: "Stored in this plugin's settings and sent on every OpenCode request. Go keys look like sk-…, Zen keys like oc_sk_…. Leave blank to fall back to the credentials service or OPENCODE_GO_API_KEY.",
	endpointLegacy: "Legacy (zen/v1)",
	endpointModern: "Modern (inference/v1)",
	injectCoreTools: "Inject Core Tools (default on)",
	injectCoreToolsHint: "Auto-injects read and bash tool schemas on free-tier requests to satisfy gateway validation. Empty inherits the default.",
	injectOriginHeaders: "Inject Origin Headers (default on)",
	injectOriginHeadersHint: "Injects official x-opencode-client origin header. Empty inherits the default.",
	injectProject: "Attach Workspace Project (default on)",
	injectProjectHint: "Automatically tags requests with your current workspace folder name (or 'global' if outside a project) for OpenCode Console tracking. Turn off to omit.",
	injectUserAgent: "Inject User-Agent (default on)",
	injectUserAgentHint: "Restores the opencode CLI User-Agent stripped by the DSH LLM adapter. Empty inherits the default.",
	groupAccess: "Account & Endpoint",
	groupModels: "Models & Free Tier",
	groupQuota: "Quota Meter",
	groupRequests: "Gateway Requests",
	freeModel: "Free",
	invalidText: "This value was not accepted; leave blank for default.",
	keySource: "Credential Source",
	keySourceAuto: "Automatic",
	keySourceConfigured: "Declared key first",
	keySourceHint: "Which key wins when several resolve. Automatic takes the declared key, then one captured from a live request; the other two promote one side.",
	keySourceRequest: "Live request first",
	readOpencodeStore: "Read the OpenCode installation's key (default off)",
	readOpencodeStoreHint: "Uses the credential OpenCode itself stored, as the LAST resort: a key you declared here or exported always wins. Off by default — turn it on to let this plugin read another tool's credential store.",
	storeInspect: "Check this machine",
	storeInspectBusy: "Checking…",
	storeInspectTitle: "Local OpenCode installation",
	storeInspectHint: "Reads the credential store the OpenCode CLI on this machine already holds and reports which account it belongs to. It never displays or transmits the secret itself.",
	storeInspectFound: "Found",
	storeInspectMissing: "No local OpenCode store was found on this machine.",
	storeInspectNoAccount: "The store exists but holds no OpenCode account credential.",
	storeInspectUnavailable: "This host mounted no inspection service.",
	storeInspectFailed: "The check failed",
	storeInspectAccount: "Account",
	storeInspectOrg: "Organization",
	storeInspectKind: "Credential",
	storeInspectKindOauth: "OAuth session",
	storeInspectKindKey: "API key",
	storeInspectKindUnknown: "Unknown",
	storeInspectExpires: "Expires",
	storeInspectExpired: "expired",
	storeInspectRefreshable: "expired — renews on next use",
	storeInspectValid: "valid",
	overridden: "Overridden",
	readOnly: "This deployment stores settings read-only.",
	reset: "Reset to default",
	sessionSpend: "Session Spend",
	/**
	* The spend row is always drawn; this is what it says when the accumulator
	* holds nothing for the session. Hiding the row instead reads as "the feature
	* is gone", and the panel cannot tell that apart from "no turns yet".
	*/
	sessionSpendEmpty: "No turns yet in this session",
	save: "Save",
	saveFailed: "The deployment did not accept these values.",
	saving: "Saving…",
	title: "OpenCode Patch",
	unavailable: "This plugin is not loaded, so it cannot be configured.",
	usageConsole: "Console",
	usageTopUp: "Top up",
	usageEnabled: "Enable Composer Usage Meter (default on)",
	usageEnabledHint: "Shows the OpenCode meter in the composer dock beside context usage: the Go quota ring, or the Zen session spend. Empty inherits default.",
	usageLastUpdated: "Last updated",
	usageLimited: "Limit reached",
	usageRefreshFailed: "Refresh failed",
	usageRefreshing: "Refreshing…",
	/**
	* The absolute shape's word, in TWO halves: a locale puts it where its own
	* grammar wants it. English reads `Resets Nov 7, 8:55 AM` (prefix, empty
	* suffix); Chinese reads `11月7日8点55分重置` (empty prefix, suffix). Word order
	* is a property of the language, so it belongs in the dictionary rather than
	* in a branch in the panel.
	*/
	usageResetsAtPrefix: "Resets ",
	usageResetsAtSuffix: "",
	/**
	* The SUFFIX form, for a countdown: `1h 11m until reset`. Carries its own
	* leading space because zh does not want one (`1h 11m后重置`), and the two
	* cannot share a composition rule.
	*/
	usageResetsIn: " until reset",
	/** A window whose reset instant has already passed — see `RelativeReset`. */
	usageResetPassed: "Already reset",
	/**
	* Under a minute to go. Copy rather than a duration: no locale formats "less
	* than a minute" as a number of minutes, and the old hardcoded `<1m` leaked
	* a Latin unit into the Chinese line.
	*/
	usageResetUnderMinute: "<1m",
	usageRetry: "Retry now",
	usageTitle: "OpenCode Go usage",
	usageAuthRejected: "Go key rejected — check this account’s key",
	usageUnavailable: "Unavailable",
	usageUpgradePlan: "Upgrade plan",
	purgeTitle: "Purge deprecated models",
	purgeHint: "Deletes the model entries this deployment declares that the live catalog has retired. It rewrites the provider list in your profile — nothing is filtered at read time, so what the picker shows is exactly what you declared.",
	purgeAction: "Purge",
	purgeBusy: "Purging…",
	purgeRemoved: "reference(s) to retired models removed from your configuration",
	purgeNothing: "Nothing to purge — the catalog reports no retired model in your list.",
	purgeCatalogUnread: "Nothing removed, but the catalog could not be read — try again when online.",
	purgeUnavailable: "Unavailable: this composition has no config editor.",
	purgeFailed: "Purge failed",
	usageSummaryTitle: "Go usage",
	usageSummaryStatusOk: "Healthy",
	usageSummaryStatusLimited: "Limit reached",
	loginAction: "Sign in to OpenCode",
	loginAgain: "Sign in again",
	loginExpired: "The code expired",
	loginFailed: "Sign-in failed",
	loginSignedIn: "Signed in",
	loginSignedOut: "Not signed in",
	loginPlane: "Sign in to",
	loginPlaneGo: "Go (subscription)",
	loginPlaneZen: "Zen (pay-as-you-go)",
	loginTitle: "OpenCode account",
	loginWaiting: "Waiting for approval…",
	usageSummaryUnavailable: "Quota unavailable",
	usageSummaryUsed: "used",
	usageSummaryRemaining: "left",
	usageSummaryAllowance: "Monthly allowance",
	usageSummaryNote: "OpenCode publishes a percentage per window and no balance, so \"left\" is the complement of that same percentage — not a dollar figure. The plan tier is not discoverable either.",
	usageZenFallbackNotice: "When Go plan limits are reached, requests automatically fall back to Zen balance only if 'Use balance' is enabled on this Go subscription's account in the OpenCode Console. Separate Zen accounts cannot be debited for Go plan overflow.",
	/**
	* The billing-semantics note under the Zen-credit card. Deliberately makes no
	* dollar claims: the gateway decides overflow per request and publishes no
	* within-allowance vs overage split, so every figure this meter could print
	* would be an estimate wearing a precise outfit.
	*/
	usageOverflowBilling: "Session spend is split by where each turn ran: Go plan requests bill to the Go allowance, Zen requests to the Zen balance. When the Go plan overflows, the gateway bills the overflow to Zen — OpenCode publishes no within-allowance vs overage split.",
	usage_monthly: "Monthly",
	usage_rolling: "5 hours",
	usage_weekly: "Weekly",
	zenCredit: "Available Zen Balance",
	zenFallbackNotice: "Requests will automatically consume Zen balance",
	zenOverflowActive: "Zen balance ready for overflow",
	zenPaygBadge: "Pay-as-you-go",
	goPlanTitle: "OpenCode Go",
	goPlusTier: "Plus",
	goTier: "Go",
	monthlyAllowance: "Monthly allowance",
	zenPaygTitle: "OpenCode Zen",
	zenPaygTooltip: "Pay-as-you-go · no quota window"
};
/** `zh` mirrors `en` key-for-key; the type makes a missing key a compile error. */
const zh = {
	description: "OpenCode Zen 网关来源头恢复、会话保持、免费模型兼容与 Go 实时额度显示。",
	enrichModels: "用 OpenCode 官方目录补全模型信息（默认开启）",
	enrichModelsHint: "把 OpenCode 官方目录（models.opencode.ai，与 models.dev 是同一份注册表）里的上下文上限、模态与思考档位补进模型信息，并让网关 /models 列表带上完整目录。它不会往选择器里添加模型——选择器只显示你声明的那些，要添加请用上面的「检查目录」。关闭后网关列表与模型信息都保持原样。",
	injectCoreTools: "自动补全核心工具（默认开启）",
	injectCoreToolsHint: "在免费模型请求中自动注入 read 和 bash 工具声明以满足网关校验。留空沿用默认值。",
	injectOriginHeaders: "注入客户端来源头（默认开启）",
	injectOriginHeadersHint: "在网关请求中附带官方 x-opencode-client 标识头。留空沿用默认值。",
	injectProject: "附带工作区项目标识（默认开启）",
	injectProjectHint: "在请求中自动附带当前工作区目录名称（若在工作区外则为 'global'），便于在 OpenCode 控制台按项目统计用量。关闭后则不发送该请求头。",
	injectUserAgent: "恢复 User-Agent（默认开启）",
	injectUserAgentHint: "恢复被 DSH 适配器过滤掉的官方 OpenCode CLI User-Agent。留空沿用默认值。",
	groupAccess: "账户与端点",
	groupModels: "模型与免费额度",
	groupQuota: "配额计量",
	groupRequests: "网关请求",
	endpoint: "API 端点",
	endpointAuto: "自动（跟随目录）",
	endpointHint: "请求发往哪个端点家族。自动会跟随网关目录给出的地址；另外两项则固定其一。旧端点与新端点的授权彼此独立且目前均可访问，因此请选择账户可用的那个，而不是当前最新的那个。",
	apiKey: "API 密钥",
	apiKeyHint: "保存在本插件设置里，随每个 OpenCode 请求发送。Go 的 key 形如 sk-…，Zen 的形如 oc_sk_…。留空则回退到凭据服务或 OPENCODE_GO_API_KEY。",
	endpointLegacy: "旧端点（zen/v1）",
	endpointModern: "新端点（inference/v1）",
	freeModel: "免费",
	invalidText: "该值未被接受，留空使用默认值。",
	keySource: "凭据来源",
	keySourceAuto: "自动",
	keySourceConfigured: "优先已声明密钥",
	keySourceHint: "多个来源都可用时以哪个为准。自动先取已声明密钥、再取捕获密钥；另两项各优先一侧。",
	keySourceRequest: "优先实时请求",
	readOpencodeStore: "读取 OpenCode 安装的密钥（默认关闭）",
	readOpencodeStoreHint: "使用 OpenCode 自己保存的凭据，且仅作为最后兜底：你在此声明或导出的密钥始终优先。默认关闭——开启后本插件才会读取另一个工具的凭据库。",
	storeInspect: "检测本机",
	storeInspectBusy: "检测中…",
	storeInspectTitle: "本机 OpenCode 安装",
	storeInspectHint: "读取本机 OpenCode CLI 已保存的凭据库，并报告它属于哪个账号。密钥本身既不会显示，也不会外传。",
	storeInspectFound: "已找到",
	storeInspectMissing: "本机没有找到 OpenCode 的凭据库。",
	storeInspectNoAccount: "凭据库存在，但其中没有 OpenCode 账号凭据。",
	storeInspectUnavailable: "当前宿主未挂载检测服务。",
	storeInspectFailed: "检测失败",
	storeInspectAccount: "账号",
	storeInspectOrg: "组织",
	storeInspectKind: "凭据类型",
	storeInspectKindOauth: "OAuth 会话",
	storeInspectKindKey: "API 密钥",
	storeInspectKindUnknown: "未知",
	storeInspectExpires: "有效期至",
	storeInspectExpired: "已过期",
	storeInspectRefreshable: "已过期（下次使用自动续期）",
	storeInspectValid: "有效",
	overridden: "已覆盖",
	readOnly: "当前部署配置为只读。",
	reset: "恢复默认",
	sessionSpend: "当前会话消耗",
	sessionSpendEmpty: "本会话暂无记录",
	save: "保存",
	saveFailed: "保存失败，请检查填写内容。",
	saving: "保存中…",
	title: "OpenCode 补丁设置",
	unavailable: "插件未加载，暂无法配置。",
	usageConsole: "控制台",
	usageTopUp: "充值",
	usageEnabled: "开启输入区用量计量（默认开启）",
	usageEnabledHint: "在输入框停靠栏（与上下文用量并列）显示 OpenCode 用量计量：Go 额度环，或 Zen 会话消耗。留空沿用默认值。",
	usageLastUpdated: "更新于",
	usageLimited: "已达限额",
	usageRefreshFailed: "刷新失败",
	usageRefreshing: "正在刷新…",
	usageResetsAtPrefix: "",
	usageResetsAtSuffix: "重置",
	usageResetsIn: "后重置",
	usageResetPassed: "已重置",
	usageResetUnderMinute: "<1分",
	usageRetry: "立即重试",
	usageTitle: "OpenCode Go 用量",
	usageAuthRejected: "Go 密钥被拒 — 请检查该账号的 Go key",
	usageUnavailable: "暂不可用",
	usageUpgradePlan: "升级套餐",
	purgeTitle: "清理已废弃模型",
	purgeHint: "删除本部署声明过、但线上目录已下架的模型条目。它会重写你 profile 里的 provider 列表——读取时不做任何过滤，所以选择器显示的就是你真正声明的。",
	purgeAction: "清理",
	purgeBusy: "清理中…",
	purgeRemoved: "处已下架的模型引用已从配置中移除",
	purgeNothing: "没有可清理的内容——目录显示你的声明与引用里都没有已下架模型。",
	purgeCatalogUnread: "没有移除任何条目，但目录读取失败——联网后重试。",
	purgeUnavailable: "不可用：此组合没有 config editor。",
	purgeFailed: "清理失败",
	usageSummaryTitle: "Go 用量",
	usageSummaryStatusOk: "状态正常",
	usageSummaryStatusLimited: "已达限额",
	loginAction: "登录 OpenCode",
	loginAgain: "重新登录",
	loginExpired: "验证码已过期",
	loginFailed: "登录失败",
	loginSignedIn: "已登录",
	loginSignedOut: "未登录",
	loginPlane: "登录到",
	loginPlaneGo: "Go（订阅）",
	loginPlaneZen: "Zen（按量付费）",
	loginTitle: "OpenCode 账户",
	loginWaiting: "等待批准…",
	usageSummaryUnavailable: "读不到配额",
	usageSummaryUsed: "已用",
	usageSummaryRemaining: "剩余",
	usageSummaryAllowance: "月度额度",
	usageSummaryNote: "OpenCode 每个窗口只提供百分比、没有余额接口，所以「剩余」是同一百分比的反面，而不是美元数；套餐档位也无法探测。",
	usageZenFallbackNotice: "当 Go 套餐额度用尽时，仅在当前 Go 订阅账号的控制台中开启了「使用余额 (Use balance)」时才会自动回退；独立账号的 Zen 余额无法跨账号自动承接。",
	usageOverflowBilling: "本会话消耗按轮次归属：Go 套餐请求计入 Go 额度，Zen 请求计入 Zen 余额。Go 套餐溢出时由网关把溢出部分计入 Zen 余额——OpenCode 不提供「额度内 / 溢出」的拆分数据。",
	usage_monthly: "每月",
	usage_rolling: "5 小时",
	usage_weekly: "每周",
	zenCredit: "可用 Zen 余额",
	zenFallbackNotice: "请求将自动从 Zen 余额中扣除",
	zenOverflowActive: "Zen 余额已就绪，将在额度用尽时自动承接",
	zenPaygBadge: "按量计费",
	goPlanTitle: "OpenCode Go",
	goPlusTier: "Plus",
	goTier: "Go",
	monthlyAllowance: "月度额度",
	zenPaygTitle: "OpenCode Zen",
	zenPaygTooltip: "按量计费 · 无额度窗口"
};
/**
* A `t` that asks the seat's dictionary first and THIS bundle's second.
*
* The locale service keeps one dictionary per (namespace, locale) and throws on a
* second registration, so whichever copy of this bundle registered first owns the
* namespace. A page that outlived a rebuild therefore serves the older dictionary:
* every key that existed then translates, and every key added since renders
* verbatim — `goPlanTitle` reached the screen that way, and then `storeInspectTitle`
* did, on the settings card, because that card still trusted the seat alone.
*
* The seat still wins when it HAS the key: a host-side translation, or a locale
* this bundle does not ship, must keep working. The bundle is the fallback, which
* is the case that was missing — a seat's miss is indistinguishable from "this
* dictionary predates the key", and the second is what happens here.
*
* Pure: the locale arrives as a getter, so a language switch lands on the next
* call rather than the next mount.
*
* @param base - the seat's translator, whose misses fall through.
* @param active - the active locale id, read per call; absent means English.
* @returns a translator that cannot render a key this bundle defines.
*/
const withBundleCopy = (base, active) => (key) => {
	const fromSeat = base(key);
	if (fromSeat !== key) return fromSeat;
	return (active?.() === "zh" ? zh : en)[key] ?? key;
};
//#endregion
//#region src/settings-fields.ts
/** Schema knob names the card edits; keys double as label ids. */
const FIELD = {
	apiKey: "apiKey",
	endpoint: "endpoint",
	enrichModels: "enrichModels",
	injectCoreTools: "injectCoreTools",
	injectOriginHeaders: "injectOriginHeaders",
	injectProject: "injectProject",
	injectUserAgent: "injectUserAgent",
	keySource: "keySource",
	readOpencodeStore: "readOpencodeStore",
	usageEnabled: "usageEnabled"
};
/**
* Section headings, in the order they appear.
*
* A field names its group and the card inserts a heading wherever it changes, so
* the display order comes from {@link CARD_FIELDS} rather than a second list.
* Keeping each group's entries adjacent is what makes the heading appear once.
*/
const GROUP = {
	access: "groupAccess",
	models: "groupModels",
	quota: "groupQuota",
	requests: "groupRequests"
};
const BOOLEAN_DRAFTS = {
	"": { kind: "clear" },
	false: {
		kind: "set",
		value: false
	},
	true: {
		kind: "set",
		value: true
	}
};
/**
* Boolean draft conversion (the host ships no boolean spec).
*
* A blank draft clears the field so it re-inherits the default; anything that
* is not `true`/`false` is invalid, which `SettingsFormModel` reports rather
* than silently writing a value.
*/
const settingsBooleanField = (field) => ({
	field,
	format: (value) => typeof value === "boolean" ? String(value) : "",
	parse: (text) => BOOLEAN_DRAFTS[text.trim().toLowerCase()]
});
/**
* Constrained-choice draft conversion (the host ships no enum spec).
*
* Blank clears so the field re-inherits the default; a value outside `allowed`
* is invalid, which the form model reports rather than letting the host quietly
* coerce a typo back to the default.
*/
const settingsSelectField = (field, allowed) => ({
	field,
	format: (value) => typeof value === "string" ? value : "",
	parse: (text) => {
		const trimmed = text.trim();
		if (trimmed.length === 0) return { kind: "clear" };
		return allowed.includes(trimmed) ? {
			kind: "set",
			value: trimmed
		} : void 0;
	}
});
/** Draft-conversion factory per control kind; a missing kind is a type error. */
const FIELD_SPEC_BUILDERS = {
	boolean: (entry) => settingsBooleanField(entry.field),
	select: (entry) => settingsSelectField(entry.field, (entry.options ?? []).map((option) => option.value)),
	// 本机新增：自由文本（API key）。空串 = 清除，其余原样写入。
	text: (entry) => ({
		field: entry.field,
		format: (value) => typeof value === "string" ? value : "",
		parse: (text) => text.length === 0 ? { kind: "clear" } : { kind: "set", value: text }
	})
};
const toSettingsFieldSpec = (entry) => FIELD_SPEC_BUILDERS[entry.kind](entry);
/**
* Every field the card renders, in render order, grouped into sections.
*
* Entries are ordered so each {@link GROUP} stays contiguous: the card inserts a
* heading where the group changes. Only decisions a user makes live here — the
* override knobs are in {@link CONFIG_ONLY_FIELDS}.
*
* The endpoint family and the credential choice both live under
* {@link GROUP.access}: together they are "which account, on which endpoint",
* and filing the credential knob under the quota meter instead is what made it
* hard to find.
*/
const CARD_FIELDS = [
	{
		field: FIELD.apiKey,
		group: GROUP.access,
		hintKey: "apiKeyHint",
		kind: "text",
		labelKey: "apiKey"
	},
	{
		field: FIELD.endpoint,
		group: GROUP.access,
		hintKey: "endpointHint",
		kind: "select",
		labelKey: "endpoint",
		options: [
			{
				labelKey: "endpointAuto",
				value: "auto"
			},
			{
				labelKey: "endpointLegacy",
				value: "legacy"
			},
			{
				labelKey: "endpointModern",
				value: "modern"
			}
		]
	},
	{
		field: FIELD.keySource,
		group: GROUP.access,
		hintKey: "keySourceHint",
		kind: "select",
		labelKey: "keySource",
		options: [
			{
				labelKey: "keySourceAuto",
				value: "auto"
			},
			{
				labelKey: "keySourceRequest",
				value: "request"
			},
			{
				labelKey: "keySourceConfigured",
				value: "configured"
			}
		]
	},
	{
		field: FIELD.readOpencodeStore,
		group: GROUP.access,
		hintKey: "readOpencodeStoreHint",
		kind: "boolean",
		labelKey: "readOpencodeStore"
	},
	{
		field: FIELD.injectUserAgent,
		group: GROUP.requests,
		hintKey: "injectUserAgentHint",
		kind: "boolean",
		labelKey: "injectUserAgent"
	},
	{
		field: FIELD.injectOriginHeaders,
		group: GROUP.requests,
		hintKey: "injectOriginHeadersHint",
		kind: "boolean",
		labelKey: "injectOriginHeaders"
	},
	{
		field: FIELD.injectProject,
		group: GROUP.requests,
		hintKey: "injectProjectHint",
		kind: "boolean",
		labelKey: "injectProject"
	},
	{
		field: FIELD.enrichModels,
		group: GROUP.models,
		hintKey: "enrichModelsHint",
		kind: "boolean",
		labelKey: "enrichModels"
	},
	{
		field: FIELD.injectCoreTools,
		group: GROUP.models,
		hintKey: "injectCoreToolsHint",
		kind: "boolean",
		labelKey: "injectCoreTools"
	},
	{
		field: FIELD.usageEnabled,
		group: GROUP.quota,
		hintKey: "usageEnabledHint",
		kind: "boolean",
		labelKey: "usageEnabled"
	}
];
/** The draft conversions the form model binds, derived from {@link CARD_FIELDS}. */
const SPECS = CARD_FIELDS.map(toSettingsFieldSpec);
//#endregion
//#region src/settings-store-inspect.tsx
/**
* The "check this machine" row: one button, and a report of what the local
* OpenCode installation actually holds.
*
* Why it exists: the `readOpencodeStore` switch is a *permission*, and a
* permission with no way to see what it would read is a blind choice. Turning it
* on used to be the only affordance, so the honest question — "is there even an
* OpenCode credential here, and whose is it?" — had no answer in the UI.
*
* Two properties are load-bearing:
*
* 1. **The secret never crosses the seam.** The host's inspection answers with a
*    sanitized summary (account email, org name, credential kind, expiry) and
*    never with the token. This module therefore cannot leak one: it is not
*    handed one.
* 2. **The report is a pure function.** {@link inspectLine} turns an outcome into
*    rows, so every branch is reachable from a test without mounting React — the
*    same contract `purgeLine` keeps, and the reason that container has no
*    decisions left in it.
*
* @module dsh-opencode-patch/settings-store-inspect
*/
/** The credential kind, in the reader's language. */
const kindLabel = (t, kind) => {
	if (kind === "oauth") return t("storeInspectKindOauth");
	if (kind === "key") return t("storeInspectKindKey");
	return t("storeInspectKindUnknown");
};
/** The expiry as a date plus a verdict, or `undefined` when the date is junk. */
const expiryLabel = (t, locale, expiresAt, expired, refreshable) => {
	const at = Date.parse(expiresAt);
	if (!Number.isFinite(at)) return;
	const when = locale === void 0 ? new Date(at).toISOString() : new Date(at).toLocaleString(locale);
	let verdict = t("storeInspectValid");
	if (expired === true) verdict = refreshable ? t("storeInspectRefreshable") : t("storeInspectExpired");
	return `${when} · ${verdict}`;
};
/** The report for one inspection result. Pure, so a test can call it. */
const inspectLine = (t, outcome, locale) => {
	if (outcome.kind === "unavailable") return {
		note: t("storeInspectUnavailable"),
		rows: [],
		warn: true
	};
	if (outcome.kind === "failed") return {
		note: `${t("storeInspectFailed")}: ${outcome.message}`,
		rows: [],
		warn: true
	};
	const { inspection } = outcome;
	if (!inspection.found) return {
		note: t("storeInspectMissing"),
		rows: [],
		warn: true
	};
	const { account } = inspection;
	if (account === void 0) return {
		note: t("storeInspectNoAccount"),
		rows: [],
		warn: true
	};
	const rows = [];
	if (account.email !== void 0) rows.push({
		label: t("storeInspectAccount"),
		value: account.email
	});
	if (account.orgName !== void 0) rows.push({
		label: t("storeInspectOrg"),
		value: account.orgName
	});
	rows.push({
		label: t("storeInspectKind"),
		value: kindLabel(t, account.type)
	});
	const refreshable = account.refreshable === true;
	if (account.expiresAt !== void 0) {
		const value = expiryLabel(t, locale, account.expiresAt, account.expired === true, refreshable);
		if (value !== void 0) rows.push({
			label: t("storeInspectExpires"),
			value
		});
	}
	return {
		rows,
		warn: account.expired === true && !refreshable
	};
};
/**
* The row itself: a heading, the button, and the report once it lands.
*
* The report is kept after the click rather than cleared, because the question it
* answers ("what is on this machine?") does not go stale in seconds — and a row
* that emptied itself would look like the check had failed.
*/
const StoreInspectRow = (props) => {
	const [state, setState] = react.default.useState({ busy: false });
	const run = async () => {
		setState({ busy: true });
		const outcome = await props.onInspect();
		setState({
			busy: false,
			report: inspectLine(props.t, outcome, props.getLocale?.())
		});
	};
	const { report } = state;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
			marginBottom: 16,
			paddingBottom: 14
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				alignItems: "center",
				display: "flex",
				gap: 12,
				justifyContent: "space-between"
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 13,
					fontWeight: 600
				},
				children: props.t("storeInspectTitle")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					color: "var(--dsw-alias-label-caption)",
					fontSize: 12,
					marginTop: 2
				},
				children: props.t("storeInspectHint")
			})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				disabled: state.busy,
				onClick: () => {
					run();
				},
				size: "sm",
				variant: "outline",
				children: state.busy ? props.t("storeInspectBusy") : props.t("storeInspect")
			})]
		}), report !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				fontSize: 12,
				marginTop: 8
			},
			children: [report.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 8,
					padding: "1px 0"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						color: "var(--dsw-alias-label-caption)",
						flex: "0 0 auto",
						minWidth: 72
					},
					children: row.label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						color: "var(--dsw-alias-label-secondary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					},
					children: row.value
				})]
			}, row.label)), report.note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					color: report.warn ? "var(--dsw-alias-label-warning, var(--dsw-alias-label-caption))" : "var(--dsw-alias-label-caption)",
					marginTop: 6
				},
				children: report.note
			})]
		})]
	});
};
//#endregion
//#region src/go-limits.ts
/** Unknown allowances (including NaN serialized as null) are never dollar values. */
const formatUsd = (value) => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
	return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
};
//#endregion
//#region src/settings-remote.ts
/**
* Whether a value is an object, narrowed without an assertion.
*
* `isRecord` from `guards.ts` does exactly this and is already the house
* predicate; it is re-used rather than restated so the narrowing is a guard the
* compiler follows instead of a cast it only tolerates.
*/
const isObject = (value) => typeof value === "object" && value !== null;
/**
* The namespace's calls, or `undefined` when the namespace is not reachable.
*
* Three ways it is not reachable, all answering `undefined`: there is no remote,
* the remote has no such namespace, and the access THROWS because the bundle
* never declared the name.
*
* @param remote - the host's remote face.
* @param namespace - the namespace to read.
* @returns the namespace's calls, or `undefined`.
*/
const remoteNamespace = (remote, namespace) => {
	try {
		if (!isObject(remote)) return;
		const face = remote[namespace];
		if (!isObject(face)) return;
		return face;
	} catch {
		return;
	}
};
/** Whether a value is one of the seam's call shapes. */
const isRemoteCall = (value) => typeof value === "function";
/**
* Read a namespace through the CONTEXT rather than the remote face.
*
* **This is the read that works for a namespace this bundle mounts itself.**
* `remote.<namespace>` is a Cordis service property, so reading it requires the
* name in `inject` — and a name there is a hard gate that holds the whole plugin
* until it exists, which is a deadlock when the same plugin is what mounts it.
* Cordis refuses the property access with
* `cannot get property "remote.<ns>" without inject`, {@link remoteNamespace}
* catches that and answers `undefined`, and the meter then reports
* "no usage service" for a service that is mounted and answering.
*
* Measured in a browser console, after the contribution mounted:
*
*   property read: false; ctx.get('remote.opencodeGoUsage'): object
*
* `ctx.get` does NOT consult `inject` (cordis reads the scope's store directly),
* so it reaches the namespace without declaring it. That is the documented
* difference between `get` and property access, and it is exactly the seam this
* needs.
*
* @param ctx - any context in the composition the contribution mounted on.
* @param namespace - the Remote namespace to read.
* @returns the namespace's calls, or `undefined` when it is not mounted.
*/
const remoteNamespaceOf = (ctx, namespace) => {
	if (!isObject(ctx)) return;
	const { get } = ctx;
	if (typeof get !== "function") return;
	try {
		const face = get.call(ctx, `remote.${namespace}`);
		return isObject(face) ? face : void 0;
	} catch {
		return;
	}
};
//#endregion
//#region src/utils/request-shape.ts
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
const CIRCUMFERENCE = 2 * Math.PI * 5.5;
/**
* Clamp a quota percentage to the ring's range and derive its dash array.
*
* Shared by the trigger ring (which strokes `strokeDasharray`) and the panel
* progress bar (which uses `clampedPercent` as a width), so both render the
* same number.
*
* @param percent - the raw quota percentage; out-of-range values clamp.
*/
const ringGeometry = (percent) => {
	const clampedPercent = Math.min(100, Math.max(0, percent));
	return {
		clampedPercent,
		strokeDasharray: `${CIRCUMFERENCE * clampedPercent / 100} ${CIRCUMFERENCE}`
	};
};
/**
* Where a user acts on what this meter shows. The console is the ONLY place a
* balance appears: OpenCode exposes no credit endpoint and the payload carries
* no currency, so no dollar figure can be derived from a percentage.
* `AGENTS.md` → "OpenCode endpoints" records the probed surface behind that.
*/
const GO_PLAN_URL = "https://opencode.ai/go";
/**
* The console, which is also where a pay-as-you-go account is topped up.
*
* One URL for both, and deliberately so: it is the only destination verified to
* exist. Every path under `/console/` answers 200 because the console is a
* single-page app, so a probe cannot distinguish a real `/billing` route from a
* catch-all — and a top-up link that 404s in front of a user is worse than one
* that opens the page where top-up lives.
*/
const CONSOLE_URL = "https://opencode.ai/console";
/**
* What to DO about the quota, rendered inside the GO layer — next to the windows
* it acts on, not parked under the shared footer.
*
* One link, not two. The limits doc went: the panel already names every window
* with its share and its reset time, so the document explained a list the user
* is looking at. A link that restates what is on screen is the same redundancy
* as a card that restates the badge — the doc is one click from the console for
* anyone who wants the policy.
*
* Zen has nothing to add: its single action IS the console on the footer row,
* labelled 充值 because that is what a pay-as-you-go user wants from it.
*/
const panelActions = (isZen) => isZen ? [] : [{
	href: GO_PLAN_URL,
	labelKey: "usageUpgradePlan"
}];
/**
* Whether a provider route or model id contains any configured marker,
* case-insensitively. Blank markers never match, so an accidental empty
* entry cannot reveal the meter everywhere.
*/
const matchesAny = (value, markers) => {
	const lower = value.toLowerCase();
	return markers.some((marker) => marker.length > 0 && lower.includes(marker.toLowerCase()));
};
/** Markers for one quota window, driving both the breakdown rows and cards. */
const BREAKDOWN_WINDOWS = [
	{
		cardName: "5-Hour",
		key: "rolling",
		labelKey: "usage_rolling"
	},
	{
		cardName: "Weekly",
		key: "weekly",
		labelKey: "usage_weekly"
	},
	{
		cardName: "Monthly",
		key: "monthly",
		labelKey: "usage_monthly"
	}
];
const STYLES = `
.dsh-oc-usage-root {
  position: relative;
  display: inline-flex;
  min-width: 0;
  vertical-align: middle;
  /* The trigger carries side padding for its hit area, and the dock adds its own
     gap — stacked, they read as one wide space beside the model selector. Pull
     the BOX back by part of that padding so the visual edge sits at the dock's
     rhythm. The hit area is untouched: shrinking the padding instead would trade
     accessibility for spacing, which is the wrong trade. */
  margin-right: -6px;
  /* Hug the content. A slot wrapper may stretch its child, and a stretched box
     makes the pill's hover tint wider than the thing inside it — an edge with
     nothing in it. */
  flex: none;
}

/*
 * The trigger follows the host's own composer pills: a translucent fill rather
 * than a bare glyph on the bar. DSH pairs its ContextMeter ring with a filled
 * pill ("176M tok · 缓存命中 97%"), and an unfilled trigger reads as unfinished
 * next to it.
 */
.dsh-oc-usage-trigger {
  border: 0;
  /*
   * No fill at rest: the composer's own controls are ghost, and a tinted pill
   * beside the model selector reads as a chip with a frame of its own. The hover
   * tint is the affordance — it is what says the ring is a button.
   */
  background: transparent;
  color: var(--dsw-alias-label-secondary, currentColor);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  /* Trimmed from 3px 9px: the box read as a fat edge around a 12px label. The
   * target is still ~18px tall and ~48px wide, which is a comfortable hit area
   * — this trims the edge, it does not remove the target. */
  padding: 2px 7px;
  /* --dsw-radius-sm (8px), and the RATIO is the reason — not the token.
   *
   * The host's own controls (Button, Input, SegmentedControl) all declare
   * --dsw-radius-md, and this trigger first copied them. That is right at their
   * height: 12px on a ~28px control is 43% of it, which reads as a rounded
   * rect. This trigger is ~20px tall, so the same 12px clamps to 10px — 50% of
   * the box, which IS a stadium, and the owner read it as too round.
   *
   * Same host ladder, one step down: 8px on 20px restores the host's own
   * ratio. The value comes from the theme; only the rung changes. */
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s ease, color 0.15s ease;
  user-select: none;
}

.dsh-oc-usage-trigger:hover,
.dsh-oc-usage-trigger:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 7%, transparent));
  color: var(--dsw-alias-label-primary, currentColor);
}

.dsh-oc-usage-trigger.dsh-oc-usage-alert {
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dsh-oc-usage-ring-track {
  fill: none;
  stroke: currentColor;
  opacity: 0.2;
  stroke-width: 2;
}

.dsh-oc-usage-ring-fill {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s ease, stroke 0.2s ease;
}

/*
 * Host rules for a floating surface: no border AND an elevation shadow, never
 * both a border and a shadow (docs/web-styling.md), radius from the panel token,
 * background from the menu material so it matches every other popover.
 */
.dsh-oc-usage-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 1100;
  width: 320px;
  max-width: calc(100vw - 24px);
  max-height: 80vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 14px 16px;
  border: 0;
  /* --dsw-radius-lg, 16px — which is where this STARTED, before two rounds of
   * "read the host's values" made it worse. The right reference is
   * MenuSurface.module.css, because this panel IS menu material: its .surface and
   * .backing rules take --dsw-radius-lg, and .compact takes --dsw-radius-md.
   * (Braces cannot appear in this comment — the tests extract a rule with a
   * brace-free match, so one here truncates every assertion in this file.)
   *   * The 28px --dsw-radius-panel belongs to the dockkit FLOAT, which is a
   * position:fixed panel docked to the screen edge with an opaque
   * --dsw-alias-bg-layer-2 and no backdrop. Different material, different radius —
   * see the note on choosing the reference. */
  border-radius: var(--dsw-radius-lg, 16px);
  /*
   * NO background, NO backdrop-filter, and no data-menu-material here.
   *
   * The host's MenuSurface owns the menu material, and the panel renders
   * THROUGH it: MenuSurface draws a separate .material layer layer at z-index -1
   * behind the content, sets isolation: isolate on the surface so that
   * negative index stays contained, and portals an opaque .backing layer into
   * document.body so Chromium has something to blur on macOS.
   *
   * Hand-rolling the fill on the panel itself was the transparency:
   * --dsw-menu-surface-fill is ~58% opaque, and with no backing behind it the
   * page showed straight through. The panel supplies GEOMETRY; the host
   * supplies the material.
   */
  /* The stroke is NOT declared here, and never needed to be. Hardcoding one
   * level broke the other theme — which is why the owner's first instinct
   * ("should we use border-l4?") was RIGHT and two rounds of reasoning talked
   * them out of it.
   *
   * The theme picks it per theme, off the attribute the host's own Menu sets:
   *     body                                          -> border-l4
   *     body[data-ds-dark-theme] [data-menu-material] -> border-l3
   * There is NO light-theme [data-menu-material] rule, so l3 is a DARK value
   * that reads like a global one. Grep it without its selector and you get the
   * wrong answer in the light theme — the theme every screenshot here is in.
   * The panel is menu material, so it carries the attribute and takes whatever
   * the theme says; setting the variable here would pin one theme's answer and
   * silently break the other's. */
  /* --dsw-elevation-prominent, and this was briefly "panel" because a token by
   * that name exists. The harness's OWN floating panel — the dockkit float, the
   * same class of thing in this same dock — reads
   *   box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.18))
   * so prominent is the surface elevation, and elevation-panel is a token nobody
   * consumes. Reverted after reading the consumer instead of the name, which is
   * the mistake this file has now paid for twice. */
  box-shadow: var(--dsw-elevation-prominent, 0 12px 36px rgba(0, 0, 0, 0.28));
  color: var(--dsw-alias-label-primary, CanvasText);
  font-size: 12px;
  line-height: 1.5;
  isolation: isolate;
  animation: dsh-oc-fade-in 0.15s ease-out;
}

@keyframes dsh-oc-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Header: title left, the one big number right — the host's own popover shape. */
.dsh-oc-usage-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.dsh-oc-usage-headline {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.dsh-oc-usage-breakdown {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
  /* The windows are quota; the rows below are money. Without this the last
     reset sat flush against the session spend and the two read as one list. */
  margin-bottom: 14px;
}

.dsh-oc-usage-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

/* The kit's dot keeps a 10px SLOT but paints a 6px core inside it, so 2px of
   every side is empty. A 7px gap therefore read as ~9px beside a 6px circle —
   the dot looked detached from its label, like a marker hanging at the row's
   front. 4px makes the optical gap match the circle. */
.dsh-oc-usage-row-left {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, currentColor);
}

/* Tertiary, and never competing with the percent for the right edge. */
.dsh-oc-usage-row-reset {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, currentColor);
}

.dsh-oc-usage-row-right {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, currentColor);
}

/* The bar is the shape the number takes: one track per window, the fill the
   window's own colour. Two pixels — a progress bar that is also a ruler.
   It spans the WHOLE row, starting under the state dot: the 13px indent that
   used to align it with the label left the dot hanging outside the row's own
   bounds, like a list marker, and cost the ruler the width it exists to use. */
.dsh-oc-usage-bar {
  height: 2px;
  margin-top: 4px;
  border-radius: var(--dsw-radius-full, 999px);
  background: var(--dsw-alias-border-l4, currentColor);
  overflow: hidden;
}

.dsh-oc-usage-bar-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}

/* Styling lives in the sheet, not inline: an ad-hoc style prop here would be
   the only one surviving in the panel, and a second limited-state tone tomorrow
   would either duplicate it or diverge from it. */
.dsh-oc-usage-limited {
  margin-left: 6px;
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

/* The footer carries the timestamp AND every action now. The upgrade-plan link had its own
   row once, behind a divider, which made the panel a row taller and put a second
   action in a second place. Links keep the host's own language — the colour is
   from its MarkdownText stylesheet — because unstyled anchors ran together into
   one sentence. See AGENTS.md, "The meter's panel". */
.dsh-oc-usage-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, currentColor);
  padding-top: 4px;
}

.dsh-oc-usage-console {
  color: var(--dsw-alias-link, currentColor);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.dsh-oc-usage-console:hover,
.dsh-oc-usage-console:focus-visible {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.dsh-oc-usage-console:focus-visible {
  outline: none;
  border-radius: var(--dsw-radius-xs, 4px);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6));
}

.dsh-oc-usage-updated {
  display: inline-flex;
  align-items: center;
  /* Tight: the button's own 20px box already carries the breathing room, and
     the gap was on top of it. The target stays 20px — padding is not what makes
     this row look empty, and shrinking the hit area to close a gap would trade
     accessibility for a pixel. */
  gap: 1px;
  min-width: 0;
}

.dsh-oc-usage-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: -4px 0;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, currentColor);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dsh-oc-usage-refresh:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent));
  color: var(--dsw-alias-label-primary, currentColor);
}

.dsh-oc-usage-refresh:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6));
}

/* The control is busy mid-read; the glyph turns rather than disappearing. */
.dsh-oc-usage-refresh:disabled {
  cursor: default;
  opacity: 0.6;
}

.dsh-oc-usage-refresh:disabled .dsh-oc-usage-refresh-icon {
  animation: dsh-oc-spin 0.9s linear infinite;
}

@keyframes dsh-oc-spin {
  to {
    transform: rotate(360deg);
  }
}

.dsh-oc-usage-console {
  color: var(--dsw-alias-link, currentColor);
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
}

.dsh-oc-usage-console:hover,
.dsh-oc-usage-console:focus-visible {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

/*
 * A failure is the one thing here the user can act on, so unlike every other row
 * it IS a callout — same shape as the overflow notice above, in the error tone.
 * This class rendered with no rule at all until now: a bare <div> with a <p>,
 * which meant UA margins, no colour and no emphasis on the one message that
 * needed it.
 */
.dsh-oc-usage-warning {
  padding: 7px 9px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 8px;
}

.dsh-oc-usage-warning strong {
}

/* The detail line is a <p>, whose UA margins would double the padding. */
.dsh-oc-usage-warning p {
  margin: 2px 0 0;
  color: var(--dsw-alias-label-secondary, currentColor);
}

.dsh-oc-usage-zen-notice {
  font-size: 11px;
  line-height: 1.45;
  padding: 7px 9px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f5a524) 12%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  margin-top: 4px;
}

/*
 * A detail row — label, sub-label, value. NOT a card: the panel is already a
 * floating surface, and a second background inside it draws two nested frames
 * around one line of text. The row reads as one of the breakdown's own rows,
 * which is what it is.
 */
.dsh-oc-usage-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

/* The first detail is spaced by whatever precedes it — the header's own margin
   on Zen, the divider on Go — so only a STACKED one needs a gap of its own. */
.dsh-oc-usage-detail + .dsh-oc-usage-detail {
  margin-top: 10px;
}

.dsh-oc-usage-detail-left {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.dsh-oc-usage-detail-title {
  font-size: 11px;
  color: var(--dsw-alias-label-primary, currentColor);
}

.dsh-oc-usage-detail-desc {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, currentColor);
}

/* The info affordance that carries the billing rule: a control, not
   decoration, so it takes the host's label token and says it is hoverable. */
.dsh-oc-usage-info {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  color: var(--dsw-alias-label-tertiary, currentColor);
  cursor: help;
  vertical-align: middle;
}

/* Same metrics as a breakdown row's value, so the rows line up as one list. */
.dsh-oc-usage-detail-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, currentColor);
  white-space: nowrap;
}
`;
const getWindowState = (window) => {
	if (window.status === "rate-limited" || window.percent >= 100) return "error";
	if (window.percent >= 80) return "warning";
	return "done";
};
/** The state ladder as colours, for strokes and fills the kit does not ship. */
const WINDOW_STATE_COLOR = {
	done: "var(--dsw-alias-state-success-primary, #16a34a)",
	warning: "var(--dsw-alias-state-warn-primary, #f5a524)",
	error: "var(--dsw-alias-state-error-primary, #e5484d)"
};
const getWindowColor = (window) => WINDOW_STATE_COLOR[getWindowState(window)];
/**
* The ring colour before a window exists — `done`, the neutral assumption;
* the ring refills the moment data lands.
*/
const getWindowColorFor = (affecting) => affecting === void 0 ? WINDOW_STATE_COLOR.done : getWindowColor(affecting.window);
/**
* A reset countdown, tagged with the SHAPE it took.
*
* The tag exists because the two shapes compose with DIFFERENT grammar and the
* panel cannot tell them apart from the text alone. A duration reads as a
* suffix — `1h 11m后重置` / `1h 11m until reset` — while an absolute date reads
* as a prefix: `重置于 11月7日 08:55` / `Resets Nov 7, 08:55 AM`. One copy key
* serving both could only ever be right for one of them, and `重置于 1h 11m`
* literally reads "resets at 1h 11m".
*/
/**
* One instant in the reader's own language.
*
* `Intl.DateTimeFormat` renders zh's time as `08:55` — CLDR's zh time pattern is
* `HH:mm` — but a Chinese sentence writes `8点55分`. So for zh the platform's own
* PARTS are reused and only the hour/minute separator is localized: the
* month/day literals (`11`, `月`, `7`, `日`) come out of the formatter untouched,
* and the leading zero comes off the hour because 点 takes the bare number.
* English keeps the platform's whole assembled string.
*/
const absoluteText = (locale, target) => {
	const format = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		month: "short"
	});
	if (locale?.startsWith("zh") !== true) return format.format(target);
	const parts = format.formatToParts(target);
	const hourIndex = parts.findIndex((part) => part.type === "hour");
	const head = parts.slice(0, hourIndex).map((part) => part.value).join("").trim();
	const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
	return `${head}${value("hour").replace(/^0/, "")}点${value("minute")}分`;
};
/** Whether a value is that constructor. A predicate, so no assertion is needed. */
const isDurationFormatCtor = (value) => typeof value === "function";
/**
* One duration in the reader's own language.
*
* `Intl.DurationFormat` is the platform's built-in for this and is used whenever
* the engine ships it — Chrome 129+, Safari 18.4+, Firefox 139+, Node 24+. The
* `narrow` style is what a quota row wants: `1h 11m` in en and `1小时11分钟` in
* zh, with each locale's own unit words, ordering and pluralisation. The
* alternative was a hand-rolled unit table, which is a second formatter and a
* second set of translation decisions.
*
* The fallback exists because a missing API must not blank the row, and it is
* deliberately a unit TABLE rather than a second formatter: same composition,
* two words per language.
*/
const durationText = (locale, parts) => {
	const candidate = Reflect.get(Intl, "DurationFormat");
	if (isDurationFormatCtor(candidate)) try {
		return new candidate(locale, { style: "narrow" }).format(parts);
	} catch {}
	const zh = locale?.startsWith("zh") === true;
	const units = zh ? {
		d: "天",
		h: "小时",
		m: "分"
	} : {
		d: "d",
		h: "h",
		m: "m"
	};
	const out = [];
	if (parts.days !== void 0 && parts.days > 0) out.push(`${parts.days}${units.d}`);
	if (parts.hours !== void 0 && parts.hours > 0) out.push(`${parts.hours}${units.h}`);
	if (parts.minutes !== void 0 && parts.minutes > 0) out.push(`${parts.minutes}${units.m}`);
	return out.join(zh ? "" : " ");
};
const formatRelativeReset = (dateStr, locale) => {
	const target = Date.parse(dateStr);
	if (!Number.isFinite(target)) return {
		kind: "absolute",
		text: dateStr
	};
	const diffMs = target - Date.now();
	if (diffMs <= 0) return {
		kind: "passed",
		text: ""
	};
	const diffMinutes = Math.floor(diffMs / 6e4);
	if (diffMinutes < 1) return {
		kind: "underMinute",
		text: ""
	};
	if (diffMinutes < 60) return {
		kind: "duration",
		text: durationText(locale, { minutes: diffMinutes })
	};
	const diffHours = Math.floor(diffMinutes / 60);
	const remMinutes = diffMinutes % 60;
	if (diffHours < 24) return {
		kind: "duration",
		text: durationText(locale, {
			hours: diffHours,
			...remMinutes > 0 ? { minutes: remMinutes } : {}
		})
	};
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) {
		const remHours = diffHours % 24;
		return {
			kind: "duration",
			text: durationText(locale, {
				days: diffDays,
				...remHours > 0 ? { hours: remHours } : {}
			})
		};
	}
	return {
		kind: "absolute",
		text: absoluteText(locale, new Date(target))
	};
};
/**
* Compose one reset countdown into a single localised line.
*
* The three shapes take two different grammars, which is why the formatter
* reports its kind instead of returning a bare string:
*
* - duration — a SUFFIX, because the unit is Latin and the label is not:
*   `1h 11m后重置` / `1h 11m until reset`.
* - absolute — a prefix AND a suffix, because the two languages disagree about
*   where the word goes: `Resets Nov 7, 8:55 AM` puts it first, `11月7日8点55分重置`
*   puts it last. Both halves live in the dictionary and one of them is empty per
*   locale.
* - passed — the window already rolled over, so there is no countdown to give.
*
* One prefix for all three produced `重置于 1h 11m`, which reads "resets at
* 1h 11m" — a sentence no window was ever in.
*/
const resetLabel = (reset, t) => {
	if (reset.kind === "duration" || reset.kind === "underMinute") return `${reset.kind === "underMinute" ? t("usageResetUnderMinute") : reset.text}${t("usageResetsIn")}`;
	if (reset.kind === "passed") return t("usageResetPassed");
	return `${t("usageResetsAtPrefix")}${reset.text}${t("usageResetsAtSuffix")}`;
};
/** Whether a window is OUT: the vendor says so, or it is at the cap. */
const isExhausted = (window) => window.status === "rate-limited" || window.percent >= 100;
const getAffectingWindow = (usage) => {
	if (isExhausted(usage.monthly)) return {
		key: "monthly",
		label: "Monthly",
		window: usage.monthly
	};
	if (isExhausted(usage.weekly)) return {
		key: "weekly",
		label: "Weekly",
		window: usage.weekly
	};
	if (isExhausted(usage.rolling)) return {
		key: "rolling",
		label: "5-Hour",
		window: usage.rolling
	};
	return {
		key: "rolling",
		label: "5-Hour",
		window: usage.rolling
	};
};
/**
* Derive the meter's user-facing copy from the active reading.
*
* Pure: the component owns state, this owns wording. `t` is the bound
* translator; `affecting` is the bottleneck window (or `undefined` while the
* first read is in flight).
*/
const describeUsage = (_usage, affecting, isZen, t) => {
	const isLimited = affecting?.window.status === "rate-limited";
	const percent = affecting?.window.percent ?? 0;
	const title = isZen ? t("zenPaygTitle") : t("goPlanTitle");
	const headline = isLimited ? `${affecting?.label} quota limited` : `${percent}% of ${affecting?.label ?? "quota"} used`;
	const tooltip = isZen ? t("zenPaygTooltip") : headline;
	let badgeText;
	if (isZen) badgeText = t("zenPaygBadge");
	else if (isLimited) badgeText = t("usageLimited");
	else badgeText = "";
	return {
		badgeText,
		headline,
		title,
		tooltip,
		zenCardCredit: isLimited ? "Active" : "Ready"
	};
};
/** Normalize a Host remote rejection into a {@link UsageFailure}. */
const parseFailure = (error) => {
	if (typeof error === "object" && error !== null && "code" in error && error.code === "opencode-go/usage-unavailable") {
		const details = "details" in error && isRecord(error.details) ? error.details : {};
		return {
			...details.configured === false ? { configured: false } : {},
			message: "message" in error && typeof error.message === "string" ? error.message : void 0,
			reason: typeof details.reason === "string" ? details.reason : void 0,
			retainPrevious: details.retryable === true && details.retainPrevious === true,
			source: typeof details.source === "string" ? details.source : void 0
		};
	}
	return {
		message: error instanceof Error ? error.message : String(error),
		retainPrevious: false
	};
};
//#endregion
//#region src/utils/retry.ts
/**
* Generic retry loop over an asynchronous operation that may return undefined or throw.
*
* This is a pure algorithm: it takes the operation, the retry limit, the sleep
* mechanism and an optional liveness probe. No context, no globals, no I/O.
*
* @module dsh-opencode-patch/retry
*/
/**
* Attempt to read a defined value until an answer arrives or attempts are exhausted.
*
* Each attempt awaits the reader. If the reader resolves a defined value, that value
* is returned immediately. If the reader returns undefined or throws an error, the attempt
* is considered unfulfilled:
* - If `live()` returns false, the loop aborts immediately without further attempts.
* - Otherwise, it sleeps for the duration determined by `sleep(attempt)` and tries again.
* - If all attempts are exhausted, it returns `undefined`.
*
* @param read - the async reader operation.
* @param attempts - maximum number of attempts (defaults to 5).
* @param sleep - callback taking attempt index (0-based) and returning a sleep Promise.
* @param live - optional predicate polled before each attempt; returning false aborts.
* @returns the first defined answer, or `undefined` if unfulfilled.
*/
const retryUntilAnswered = async (read, attempts = 5, sleep = (attempt) => new Promise((resolve) => {
	setTimeout(resolve, 300 * (attempt + 1));
}), live = () => true) => {
	let lastError;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (!live()) return;
		try {
			const next = await read();
			if (next !== void 0) return next;
		} catch (error) {
			lastError = error;
		}
		if (attempt < attempts - 1) await sleep(attempt);
	}
	if (lastError !== void 0) console.warn("[dsh-opencode-patch] retry: all attempts failed", lastError);
};
//#endregion
//#region src/settings-usage.tsx
/**
* The Go usage summary on the plugin settings page.
*
* The composer meter answers "how much have I used" at the point of use; this
* answers the same question where a reader goes to CONFIGURE the plugin, in the
* layout the vendor's own console uses: one row per window, with what is LEFT
* held out on the right.
*
* What it can say is the vendor's limit, not ours. `/usage` publishes a percent
* per window and no balance, and the plan tier is not discoverable, so "left" is
* the complement of the same percentage — never a dollar figure. The allowance
* is stated as a TOTAL for the same reason the meter states it that way.
*
* @module dsh-opencode-patch/settings-usage
*/
/** The three windows, in the order the panel lists them. */
const WINDOWS = [
	{
		copy: "usage_rolling",
		key: "rolling"
	},
	{
		copy: "usage_weekly",
		key: "weekly"
	},
	{
		copy: "usage_monthly",
		key: "monthly"
	}
];
/** Whether a value is one window, as the Host's contract defines it. */
const isWindow = (value) => isRecord(value) && typeof value.percent === "number" && typeof value.resetsAt === "string" && (value.status === "ok" || value.status === "rate-limited");
/** Whether a value is a quota reading. The windows are what this page renders. */
const isGoUsage = (value) => isRecord(value) && isWindow(value.rolling) && isWindow(value.weekly) && isWindow(value.monthly);
/**
* Read the Go plane's quota through the Host service.
*
* The card's scope carries `remote` the same way the meter's does, so the read
* goes through the one service that owns credential resolution and the endpoint.
* Anything unrecognised is `undefined` rather than a half-built row: this page
* has no retry affordance, and a fabricated 0% would be worse than silence.
*/
const readGoUsage = async (scope) => {
	const remote = isRecord(scope) ? scope.remote : void 0;
	if (remote === void 0) {
		console.warn("[dsh-opencode-patch] usage read: the settings scope exposes no remote");
		return;
	}
	const namespace = remoteNamespaceOf(scope, "opencodeGoUsage") ?? remoteNamespace(remote, "opencodeGoUsage");
	if (namespace === void 0) {
		console.warn("[dsh-opencode-patch] usage read: no opencodeGoUsage service on the remote", Object.keys(isRecord(remote) ? remote : {}));
		return;
	}
	const call = namespace.read;
	if (!isRemoteCall(call)) {
		console.warn("[dsh-opencode-patch] usage read: no opencodeGoUsage service on the remote", Object.keys(namespace));
		return;
	}
	const result = await call({ provider: "opencode-go" });
	if (isRecord(result) && typeof result.ok === "boolean") {
		if (!result.ok) throw "error" in result ? result.error : /* @__PURE__ */ new Error("usage call failed");
		const value = "value" in result ? result.value : void 0;
		if (!isGoUsage(value)) return;
		return value;
	}
	const value = isRecord(result) && "value" in result ? result.value : result;
	if (!isGoUsage(value)) {
		console.warn("[dsh-opencode-patch] usage read: the answer is not a usage shape", result);
		return;
	}
	return value;
};
/** The status word: which of the three states this reading is in. */
const statusText = (t, usage, limited, refreshing = false) => {
	if (refreshing) return t("usageRefreshing");
	if (usage === void 0) return t("usageSummaryUnavailable");
	return limited ? t("usageSummaryStatusLimited") : t("usageSummaryStatusOk");
};
/**
* The summary itself: pure, so a test can invoke it and read the tree without
* mounting — the same contract the meter's panel keeps.
*/
const UsageSummaryView = ({ locale, onRefresh, refreshing = false, t, usage }) => {
	const limited = usage !== void 0 && WINDOWS.some(({ key }) => usage[key].status === "rate-limited");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 6
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					alignItems: "baseline",
					display: "flex",
					justifyContent: "space-between"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						alignItems: "center",
						display: "inline-flex",
						fontSize: 12,
						fontWeight: 600,
						gap: 4
					},
					children: [t("usageSummaryTitle"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("usageSummaryNote"),
						portal: true,
						side: "top",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-alias-label-tertiary)",
								cursor: "help",
								display: "inline-flex"
							},
							tabIndex: 0,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInfoOutlineRegular, { size: 13 })
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "inline-flex",
						gap: 6
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color: "var(--dsw-alias-label-secondary)",
							fontSize: 11
						},
						children: statusText(t, usage, limited, refreshing)
					}), onRefresh !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"aria-label": refreshing ? t("usageRefreshing") : t("usageRetry"),
						disabled: refreshing,
						onClick: () => {
							onRefresh();
						},
						style: {
							alignItems: "center",
							background: "transparent",
							border: "none",
							borderRadius: 4,
							color: "var(--dsw-alias-label-secondary)",
							cursor: refreshing ? "default" : "pointer",
							display: "inline-flex",
							height: 18,
							justifyContent: "center",
							opacity: refreshing ? .6 : 1,
							padding: 2,
							width: 18
						},
						type: "button",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								animation: refreshing ? "dsh-oc-spin 0.9s linear infinite" : void 0,
								display: "inline-flex"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 11 })
						})
					})]
				})]
			}),
			usage !== void 0 && WINDOWS.map(({ copy, key }) => {
				const window = usage[key];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "flex",
						fontSize: 11,
						gap: 8
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: getWindowState(window) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { flex: "0 0 46px" },
							children: t(copy)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-alias-label-secondary)",
								flex: 1,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: `${window.percent}% ${t("usageSummaryUsed")} · ${resetLabel(formatRelativeReset(window.resetsAt, locale), t)}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontVariantNumeric: "tabular-nums",
								fontWeight: 600,
								textAlign: "right"
							},
							children: `${Math.max(0, 100 - window.percent)}%`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-alias-label-tertiary)",
								flex: "0 0 26px"
							},
							children: t("usageSummaryRemaining")
						})
					]
				}, key);
			}),
			usage?.allowance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 11
				},
				children: `${t("usageSummaryAllowance")} ${usage.allowance.model} · ${t("goTier")} ${formatUsd(usage.allowance.go)} · ${t("goPlusTier")} ${formatUsd(usage.allowance.goPlus)}`
			})
		]
	});
};
/**
* Read until an answer arrives, a bounded number of times.
*
* The remote is mounted by an asynchronous effect, so a surface that appears first
* reads against a remote that is not there yet and answers `undefined`. Reading once
* leaves it empty until the page is reloaded, which is exactly the difference a user
* sees between this card and the composer meter - the meter reads on every turn.
*
* Extracted from the component so the retry is a behaviour a test can perform rather
* than a branch inside a React effect.
*
* @param read - the read to attempt.
* @param attempts - how many times to try before giving up.
* @param sleep - the wait between attempts, called with the attempt number.
* @param live - asked before each attempt; `false` abandons the loop.
* @returns the first defined answer, or `undefined`.
*/
const readUntilAnswered = retryUntilAnswered;
/** The container: reads once when the card appears, on window focus, or via manual refresh. */
const UsageSummary = ({ attempts = 5, getLocale, readUsage, sleep, t }) => {
	const [usage, setUsage] = react.default.useState();
	const [settled, setSettled] = react.default.useState(false);
	const [refreshing, setRefreshing] = react.default.useState(false);
	const fetchUsage = react.default.useCallback(async () => {
		if (readUsage === void 0) return;
		setRefreshing(true);
		let next;
		try {
			next = await readUntilAnswered(readUsage, attempts, sleep, () => true);
		} catch (error) {
			console.warn("[dsh-opencode-patch] usage read failed", error);
			next = void 0;
		} finally {
			setRefreshing(false);
		}
		setUsage(next);
		setSettled(true);
	}, [
		attempts,
		readUsage,
		sleep
	]);
	react.default.useEffect(() => {
		fetchUsage();
	}, [fetchUsage]);
	react.default.useEffect(() => {
		const onFocus = () => {
			fetchUsage();
		};
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("focus", onFocus);
		};
	}, [fetchUsage]);
	if (readUsage === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, {});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageSummaryView, {
		locale: getLocale?.(),
		onRefresh: fetchUsage,
		refreshing,
		t,
		usage: settled ? usage : void 0
	});
};
//#endregion
//#region src/settings-card.tsx
/**
* The OpenCode Patch configuration card: a `SettingsForm` wrapping one control
* per {@link CARD_FIELDS} entry, in register order — so adding a field is a
* register entry rather than a JSX edit.
*
* A pure view: `settings-page.tsx` owns the store, the actions and the slot
* registration, and hands them in as props.
*
* @module dsh-opencode-patch/settings-card
*/
/** Section heading between register groups; `first` drops the separator rule. */
const GroupHeading = (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
	style: {
		borderTop: props.first ? void 0 : "0.5px solid var(--dsw-alias-border-l2)",
		marginTop: props.first ? void 0 : "10px",
		paddingTop: "6px"
	},
	children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		style: {
			color: "var(--dsw-alias-label-caption)",
			fontSize: "12px",
			fontWeight: 600,
			letterSpacing: "0.02em"
		},
		children: props.label
	})
});
/**
* The purge row: one sentence, one button, and the outcome underneath.
*
* It says "rewrites your profile" rather than "hides", because that is what it
* does — a read-time filter would leave the declaration in place and make the
* model's absence unexplainable from the configuration.
*/
/**
* What one outcome says, and whether it reads as a warning.
*
* Pure, so every branch is reachable from a test without mounting a component —
* the container below then has no decisions left in it.
*/
const purgeLine = (t, outcome) => {
	if (outcome.kind === "unavailable") return {
		line: t("purgeUnavailable"),
		warn: true
	};
	if (outcome.kind === "failed") return {
		line: `${t("purgeFailed")}: ${outcome.message}`,
		warn: true
	};
	if (outcome.result.removed.length === 0) return outcome.result.catalogRead ? {
		line: t("purgeNothing"),
		warn: false
	} : {
		line: t("purgeCatalogUnread"),
		warn: true
	};
	return {
		line: `${String(outcome.result.removed.length)} ${t("purgeRemoved")}`,
		warn: false
	};
};
const PurgeRow = (props) => {
	const [state, setState] = react.default.useState({ busy: false });
	const run = async () => {
		setState({ busy: true });
		const outcome = await props.onPurge();
		setState({
			busy: false,
			...purgeLine(props.t, outcome)
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
			marginBottom: 16,
			paddingBottom: 14
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				alignItems: "center",
				display: "flex",
				gap: 12,
				justifyContent: "space-between"
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 13,
					fontWeight: 600
				},
				children: props.t("purgeTitle")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					color: "var(--dsw-alias-label-caption)",
					fontSize: 12,
					marginTop: 2
				},
				children: props.t("purgeHint")
			})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				disabled: state.busy,
				onClick: () => {
					run();
				},
				size: "sm",
				variant: "outline",
				children: state.busy ? props.t("purgeBusy") : props.t("purgeAction")
			})]
		}), state.line !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				color: state.warn ? "var(--dsw-alias-label-warning, var(--dsw-alias-label-caption))" : "var(--dsw-alias-label-caption)",
				fontSize: 12,
				marginTop: 6
			},
			children: state.line
		})]
	});
};
const formLabels = (t) => ({
	readOnly: t("readOnly"),
	save: t("save"),
	saveFailed: t("saveFailed"),
	saving: t("saving"),
	unavailable: t("unavailable")
});
const OpencodeCard = (props) => {
	const t = withBundleCopy(props.t, props.getLocale);
	if (props.view === "summary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: t("description") });
	const state = props.useOpencodeCard((snapshot) => snapshot);
	const disabled = !state.shell.writable;
	/** The staged draft for a field; a never-touched field is empty, not invalid. */
	const staged = (name) => state.fields[name] ?? {
		invalid: false,
		overridden: false,
		text: ""
	};
	/** Chrome shared by every control: id, edit/reset wiring, staged state. */
	const field = (name) => ({
		disabled,
		id: `plugin-config-opencode-${name}`,
		invalidLabel: t("invalidText"),
		onEdit: (text) => {
			props.edit(name, text);
		},
		onReset: () => {
			props.resetField(name);
		},
		overriddenLabel: t("overridden"),
		resetLabel: t("reset"),
		...staged(name)
	});
	/** The subset a toggle needs: no placeholder, but the same invalid contract. */
	const boolField = (name) => {
		const { invalid, overridden, text: draft } = staged(name);
		return {
			disabled,
			id: `plugin-config-opencode-${name}`,
			invalid,
			invalidLabel: t("invalidText"),
			onEdit: (text) => {
				props.edit(name, text);
			},
			onReset: () => {
				props.resetField(name);
			},
			overridden,
			overriddenLabel: t("overridden"),
			resetLabel: t("reset"),
			text: draft
		};
	};
	/** The control a register entry renders, chosen by its `kind`. */
	const controlFor = (entry) => {
		const label = t(entry.labelKey);
		const hint = t(entry.hintKey);
		if (entry.kind === "text") return /* @__PURE__ */ (0, react.createElement)(SettingsTextField, {
			...field(entry.field),
			hint,
			key: entry.field,
			label,
			placeholder: entry.placeholderKey === void 0 ? void 0 : t(entry.placeholderKey)
		});
		if (entry.kind === "select") return /* @__PURE__ */ (0, react.createElement)(SettingsChoiceField, {
			...field(entry.field),
			hint,
			key: entry.field,
			label,
			options: (entry.options ?? []).map((option) => ({
				label: t(option.labelKey),
				value: option.value
			}))
		});
		return /* @__PURE__ */ (0, react.createElement)(SettingsBooleanField, {
			...boolField(entry.field),
			hint,
			key: entry.field,
			label
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: { fontFamily: "var(--dsw-font-family, inherit)" },
		children: [
			props.readUsage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
					marginBottom: 20,
					paddingBottom: 16
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageSummary, {
					getLocale: props.getLocale,
					readUsage: props.readUsage,
					t
				})
			}),
			props.purgeDeprecated !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PurgeRow, {
				onPurge: props.purgeDeprecated,
				t
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				onDiscard: props.discard,
				onSave: props.save,
				state: state.shell,
				children: CARD_FIELDS.flatMap((entry, index) => {
					const control = controlFor(entry);
					const beside = entry.field === FIELD.readOpencodeStore && props.inspectStore !== void 0 ? [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StoreInspectRow, {
						getLocale: props.getLocale,
						onInspect: props.inspectStore,
						t
					}, "store-inspect")] : [];
					return index === 0 || CARD_FIELDS[index - 1]?.group !== entry.group ? [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupHeading, {
							first: index === 0,
							label: t(entry.group)
						}, `group-${entry.group}`),
						control,
						...beside
					] : [control, ...beside];
				})
			})
		]
	});
};
//#endregion
//#region src/settings-purge.ts
/**
* The card's one destructive action: ask the host to delete the retired models
* this deployment declares.
*
* The call is a Remote, like the quota read: the purge needs the profile and the
* config editor, neither of which a browser has. Every failure is named rather
* than collapsed into `undefined`, because "no service", "no config editor" and
* "the host refused" are three different problems for whoever clicks it.
*
* @module dsh-opencode-patch/settings-purge
*/
/** The Remote's namespace, read through the shared guard (see settings-remote). */
const namespaceOf$1 = (scope) => remoteNamespaceOf(scope, "opencodeModelPurge") ?? remoteNamespace(isRecord(scope) ? scope.remote : void 0, "opencodeModelPurge");
/**
* Ask the host to purge, once.
*
* @param scope - the settings scope the card was rendered with.
* @returns the outcome; never throws.
*/
const purgeDeprecatedModels = async (scope) => {
	const call = namespaceOf$1(scope)?.purge;
	if (typeof call !== "function") {
		console.warn("[dsh-opencode-patch] purge: no opencodeModelPurge service on the remote");
		return { kind: "unavailable" };
	}
	try {
		const answer = await call();
		const value = isRecord(answer) && "value" in answer ? answer.value : answer;
		if (!isRecord(value) || !Array.isArray(value.removed)) return {
			kind: "failed",
			message: "the host answered something that is not a purge result"
		};
		return {
			kind: "purged",
			result: value
		};
	} catch (error) {
		return {
			kind: "failed",
			message: error instanceof Error ? error.message : String(error)
		};
	}
};
//#endregion
//#region src/settings-store.ts
/**
* Safe client-side Remote caller for inspecting the local OpenCode installation.
*
* Reads through the Cordis remote guard, handles unavailable remote/service,
* and formats the outcome without throwing or leaking.
*
* @module dsh-opencode-patch/settings-store
*/
const namespaceOf = (scope) => remoteNamespaceOf(scope, "opencodeStore") ?? remoteNamespace(isRecord(scope) ? scope.remote : void 0, "opencodeStore");
/**
* Ask the host to inspect the local OpenCode installation.
*
* @param scope - the settings scope the card was rendered with.
* @returns the outcome; never throws.
*/
const inspectStore = async (scope) => {
	const call = namespaceOf(scope)?.inspect;
	if (typeof call !== "function") {
		console.warn("[dsh-opencode-patch] store inspection: no opencodeStore service on the remote");
		return { kind: "unavailable" };
	}
	try {
		const answer = await call();
		const value = isRecord(answer) && "value" in answer ? answer.value : answer;
		if (!isRecord(value) || typeof value.found !== "boolean") return {
			kind: "failed",
			message: "host returned an invalid inspection shape"
		};
		return {
			kind: "inspected",
			inspection: value
		};
	} catch (error) {
		return {
			kind: "failed",
			message: error instanceof Error ? error.message : String(error)
		};
	}
};
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
const usageCodec = {
	create: () => ({ parse: parseGoUsage }),
	mode: "strict",
	schema: { parse: parseGoUsage },
	typeSymbol: "dsh-opencode-patch#GoUsage"
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
const usageRemote = {
	descriptors: [{
		id: "dsh-opencode-patch#opencodeGoUsage/read",
		invocation: { kind: "direct" },
		method: "read",
		namespace: "opencodeGoUsage",
		parameters: [{
			acceptsUndefined: true,
			codec: {
				create: () => ({ parse: parseUsageQuery }),
				mode: "strict",
				schema: { parse: parseUsageQuery },
				typeSymbol: "dsh-opencode-patch#UsageQuery"
			},
			name: "query",
			source: "json",
			wire: "query"
		}],
		result: usageCodec,
		service: "opencodeGoUsage"
	}],
	package: "dsh-opencode-patch"
};
//#endregion
//#region src/usage-panel.tsx
/**
* Presentational pieces of the OpenCode Go quota meter. `usage-pill.tsx` owns the
* state and hands them everything they render; neither uses hooks, so both can be
* invoked directly and asserted as an element tree.
*
* @module dsh-opencode-patch/usage-panel
*/
/**
* The refresh glyph is the HOST'S, not a hand-drawn arrow.
*
* This used to carry a comment claiming the kit ships no icon set, and that
* claim is why the arrow stayed hand-drawn — it ships ~150 icons. Every icon is
* `(props) => <Artwork {...props} strokeWidth={…}>` over a `size = 16` default,
* so the only thing we choose is the size. `currentColor` comes from the
* artwork, which is what lets it ride the muted label colour beside it.
*
* General rule, and it cost a hand-rolled divider, dot and pill before it was
* written down: **a claim about what the host does NOT ship must be verified
* before it is written, because it freezes the decision.**
*/
const RefreshIcon = () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {
	"aria-hidden": "true",
	className: "dsh-oc-usage-refresh-icon",
	size: 14
});
/**
* The Go hover: EVERY window, because the trigger can print only one of them.
*
* The host `Tooltip` takes a TEXT label — its type is not a node — so the answer
* is one line rather than a row per window. A richer card would be the host's
* `HoverCard` (anchor + content), which is the built-in for that shape.
*/
const goQuotaTooltip = (t, usage) => {
	if (usage === void 0) return t("usageTitle");
	return BREAKDOWN_WINDOWS.map(({ key, labelKey }) => `${t(labelKey)} ${usage[key].percent}%`).join(" · ");
};
const UsageTrigger = ({ displayPercent, isLimited, isZen, onClick, open, ringColor, strokeDasharray, t, tooltipLabel, triggerLabel, usage }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
	label: tooltipLabel,
	side: "top",
	children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		"aria-expanded": open,
		"aria-haspopup": "dialog",
		"aria-label": isZen ? `${t("zenPaygTitle")} (${t("zenPaygBadge")})` : `${t("usageTitle")}: ${displayPercent}%`,
		className: `dsh-oc-usage-trigger${isLimited && !isZen ? " dsh-oc-usage-alert" : ""}`,
		onClick,
		type: "button",
		children: [!isZen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			"aria-hidden": "true",
			height: "14",
			viewBox: "0 0 14 14",
			width: "14",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				className: "dsh-oc-usage-ring-track",
				cx: "7",
				cy: "7",
				r: 5.5
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				className: "dsh-oc-usage-ring-fill",
				cx: "7",
				cy: "7",
				r: 5.5,
				strokeDasharray,
				style: { stroke: ringColor },
				transform: "rotate(-90 7 7)"
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isZen && usage?.session !== void 0 ? usage.session.planeCostFormatted ?? usage.session.costFormatted : triggerLabel })]
	})
});
/**
* The session-spend row, and the one row here that is ALWAYS drawn.
*
* It used to be omitted whenever the accumulator held nothing for the session,
* which reads as "this feature is gone" rather than "no turns yet" — and that
* state is reachable on every host restart, because the accumulator lives in
* the Host process and counts only OpenCode-route turns. A row that cannot
* distinguish the two has to say which.
*/
const SpendRow = ({ t, usage }) => {
	const session = usage?.session;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dsh-oc-usage-detail",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-detail-left",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-oc-usage-detail-title",
				children: t("sessionSpend")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-oc-usage-detail-desc",
				children: session === void 0 ? t("sessionSpendEmpty") : `${session.activeModelName ?? session.activeModel ?? ""} · ${session.freeModel === true ? t("freeModel") : session.activeRateFormatted ?? ""}`
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "dsh-oc-usage-detail-value",
			children: session === void 0 ? "—" : session.planeCostFormatted ?? session.costFormatted
		})]
	});
};
const UsagePanel = ({ badgeText, failure, isLimited, isZen, locale, onMouseEnter, onMouseLeave, refreshing, retry, t, title, updatedAt, usage, zenCardCredit }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
	"aria-busy": refreshing,
	"aria-label": isZen ? t("zenPaygTitle") : t("usageTitle"),
	className: "dsh-oc-usage-panel",
	onMouseEnter,
	onMouseLeave,
	role: "dialog",
	children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-header",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-oc-usage-headline",
				children: title
			}), badgeText.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				tone: isLimited && !isZen ? "danger" : "neutral",
				children: badgeText
			})]
		}),
		!isZen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [usage !== void 0 && usage.quotaUnavailable !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "dsh-oc-usage-breakdown",
			children: BREAKDOWN_WINDOWS.map((entry) => {
				const window = usage[entry.key];
				const reset = formatRelativeReset(window.resetsAt, locale);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-oc-usage-window",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-oc-usage-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-oc-usage-row-left",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: getWindowState(window) }), t(entry.labelKey)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-oc-usage-row-reset",
								children: [resetLabel(reset, t), window.status === "rate-limited" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-oc-usage-limited",
									children: t("usageLimited")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-oc-usage-row-right",
								children: [window.percent, "%"]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-oc-usage-bar",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-oc-usage-bar-fill",
							style: {
								width: `${Math.min(100, Math.max(0, window.percent))}%`,
								backgroundColor: WINDOW_STATE_COLOR[getWindowState(window)]
							}
						})
					})]
				}) }, entry.key);
			})
		}), usage?.allowance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-detail",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-oc-usage-detail-left",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-oc-usage-detail-title",
					children: t("monthlyAllowance")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-oc-usage-detail-desc",
					children: usage.session?.activeModelName ?? usage.allowance.model
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsh-oc-usage-detail-value",
				children: [
					t("goTier"),
					" ",
					formatUsd(usage.allowance.go),
					" · ",
					t("goPlusTier"),
					" ",
					formatUsd(usage.allowance.goPlus)
				]
			})]
		})] }),
		SpendRow({
			t,
			usage
		}),
		!isZen && usage?.zenOverflow === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-detail",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-oc-usage-detail-left",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-oc-usage-detail-title",
					children: [t("zenCredit"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("usageOverflowBilling"),
						portal: true,
						side: "top",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-oc-usage-info",
							tabIndex: 0,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInfoOutlineRegular, { size: 14 })
						})
					})]
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-oc-usage-detail-value",
				children: zenCardCredit
			})]
		}),
		isLimited && !isZen && usage?.zenOverflow !== true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "dsh-oc-usage-zen-notice",
			children: t("usageZenFallbackNotice")
		}) : null,
		failure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-warning",
			role: "alert",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: failure.reason === "auth" ? t("usageAuthRejected") : t("usageRefreshFailed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: failure.message ?? t("usageUnavailable") })]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-oc-usage-footer",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-oc-usage-updated",
					children: [updatedAt === null ? "" : `${t("usageLastUpdated")} ${new Date(updatedAt).toLocaleTimeString(locale, {
						hour: "2-digit",
						minute: "2-digit"
					})}`, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"aria-label": refreshing ? t("usageRefreshing") : t("usageRetry"),
						className: "dsh-oc-usage-refresh",
						disabled: refreshing,
						onClick: retry,
						type: "button",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {})
					})]
				}),
				panelActions(isZen).map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					className: "dsh-oc-usage-console",
					href: action.href,
					rel: "noreferrer noopener",
					target: "_blank",
					children: t(action.labelKey)
				}, action.href)),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					className: "dsh-oc-usage-console",
					href: CONSOLE_URL,
					rel: "noreferrer noopener",
					target: "_blank",
					children: t(isZen ? "usageTopUp" : "usageConsole")
				})
			]
		})
	]
});
//#endregion
//#region src/usage-pill.tsx
/**
* Composer-dock component displaying OpenCode Go quota and rate limits.
*
* Owns the meter's *state* (polling, dismissal, retry, gating); `usage-panel.tsx`
* renders it and `usage-ui.ts` reads it, so both are testable without a DOM.
*
* @module dsh-opencode-patch/usage-pill
*/
/**
* A STABLE snapshot, not a fresh object per call.
*
* `useSyncExternalStore` compares by identity, so a getter that builds a new
* object every time reports a change on every read and React re-renders forever
* — "Maximum update depth exceeded" (React error #185), which is how the first
* version of this fallback failed.
*/
const NO_DIRECTORY_STATE = {};
const NO_DIRECTORY = {
	getSnapshot: () => NO_DIRECTORY_STATE,
	subscribe: () => () => {}
};
/**
* Whether the reader has asked for less motion.
*
* Read at call time, not at module load: the query can change between renders,
* and a cached answer would pin the first preference the reader ever had.
*/
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const noop = () => {};
const ActiveUsage = ({ getLocale, model, provider, readUsage, t }) => {
	const [snapshot, setSnapshot] = (0, react.useState)(null);
	const [failed, setFailed] = (0, react.useState)(null);
	const [refreshing, setRefreshing] = (0, react.useState)(false);
	const [open, setOpen] = (0, react.useState)(false);
	const root = (0, react.useRef)(null);
	const hoverTimer = (0, react.useRef)(null);
	const retry = (0, react.useRef)(noop);
	(0, react.useEffect)(() => {
		let alive = true;
		let busy = false;
		setSnapshot(null);
		setFailed(null);
		setRefreshing(false);
		const refresh = async (manual = false) => {
			if (busy || !manual && document.visibilityState === "hidden") return;
			busy = true;
			const startedAt = Date.now();
			setRefreshing(true);
			try {
				const value = await readUsage(provider, model);
				if (alive) {
					setSnapshot({
						reader: readUsage,
						updatedAt: Date.now(),
						usage: value
					});
					setFailed(null);
				}
			} catch (error) {
				if (alive) {
					const failure = parseFailure(error);
					setFailed({
						failure,
						reader: readUsage
					});
					setSnapshot((previous) => previous?.reader === readUsage && failure.retainPrevious && typeof previous.usage.source === "string" && previous.usage.source === failure.source ? previous : null);
				}
			} finally {
				busy = false;
				if (alive) {
					const remaining = 900 - (Date.now() - startedAt);
					if (manual && remaining > 0 && !reducedMotion()) await new Promise((resolve) => {
						setTimeout(resolve, remaining);
					});
					setRefreshing(false);
				}
			}
		};
		retry.current = () => {
			refresh(true);
		};
		refresh();
		const timer = setInterval(() => {
			refresh();
		}, 6e4);
		const onVisible = () => {
			refresh();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			alive = false;
			retry.current = noop;
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [
		readUsage,
		provider,
		model
	]);
	(0, react.useEffect)(() => {
		if (!open) return noop;
		const click = (event) => {
			if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
		};
		const key = (event) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", click);
		document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("mousedown", click);
			document.removeEventListener("keydown", key);
		};
	}, [open]);
	/**
	* Hovering no longer opens the panel — it only cancels a pending close, so
	* moving from the trigger onto the panel keeps it open. The panel is opened by
	* a click, and hovering the trigger shows a `Tooltip` instead.
	*/
	const handleMouseEnter = () => {
		if (hoverTimer.current !== null) {
			clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
	};
	const handleMouseLeave = () => {
		if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
		hoverTimer.current = setTimeout(() => {
			setOpen(false);
		}, 200);
	};
	const current = snapshot?.reader === readUsage ? snapshot : null;
	const usage = current?.usage;
	const failure = failed?.reader === readUsage ? failed.failure : null;
	if (failure?.configured === false) return null;
	const isZen = isZenProvider(provider);
	const affecting = usage === void 0 ? void 0 : getAffectingWindow(usage);
	const isLimited = affecting?.window.status === "rate-limited";
	const displayPercent = affecting?.window.percent ?? 0;
	const isFree = usage?.session?.freeModel === true;
	const ringColor = isFree ? "var(--dsw-alias-label-tertiary)" : getWindowColorFor(affecting);
	const strokeDasharray = isFree ? `0 ${CIRCUMFERENCE}` : ringGeometry(displayPercent).strokeDasharray;
	let triggerLabel = "";
	if (usage !== void 0) triggerLabel = isZen ? "" : `${displayPercent}%`;
	else if (failure !== null) triggerLabel = "!";
	const locale = getLocale?.();
	const { badgeText, title, tooltip, zenCardCredit } = describeUsage(usage, affecting, isZen, t);
	const zenSpend = usage?.session === void 0 ? void 0 : usage.session.planeCostFormatted ?? usage.session.costFormatted;
	const zenTooltip = zenSpend === void 0 ? tooltip : `${t("sessionSpend")} ${zenSpend} · ${t("zenPaygBadge")}`;
	const tooltipLabel = isZen ? zenTooltip : goQuotaTooltip(t, usage);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "dsh-oc-usage-root",
		onMouseEnter: handleMouseEnter,
		onMouseLeave: handleMouseLeave,
		ref: root,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: STYLES }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageTrigger, {
				displayPercent,
				isLimited,
				isZen,
				onClick: () => {
					setOpen((prev) => !prev);
				},
				open,
				ringColor,
				strokeDasharray,
				t,
				tooltipLabel,
				triggerLabel,
				usage
			}),
			open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsagePanel, {
				badgeText,
				failure,
				isLimited,
				isZen,
				locale,
				onMouseEnter: handleMouseEnter,
				onMouseLeave: handleMouseLeave,
				refreshing,
				retry: () => {
					retry.current();
				},
				t,
				title,
				updatedAt: current === null ? null : current.updatedAt,
				usage,
				zenCardCredit
			})
		]
	});
};
/**
* Reasons already written to the console, so a re-render does not flood it.
*
* A meter that is absent and a meter that failed look identical on screen, which
* is why "the meter is not shown" cost several rounds. The injector already
* computes a precise reason — "no modelDirectories service", "directoryFor threw:
* …", "no usage service: remote.opencodeGoUsage.read is missing" — and this
* component used to destructure it as `_reason` and drop it. Now it says it, once
* per distinct reason.
*/
const reportedAbsences = /* @__PURE__ */ new Set();
const reportAbsence = (reason) => {
	if (reportedAbsences.has(reason)) return;
	reportedAbsences.add(reason);
	console.warn(`[dsh-opencode-patch] the usage meter is not rendering: ${reason}`);
};
const UsagePill = ({ directory, meterProviders, modelMarkers: _modelMarkers, reason, ...props }) => {
	const store = directory ?? NO_DIRECTORY;
	const state = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
	if (directory === void 0) {
		if (typeof reason === "string" && reason.length > 0) reportAbsence(reason);
		return null;
	}
	const provider = state?.current?.provider ?? state?.pending?.provider ?? "";
	const model = state?.pending?.model ?? state?.current?.model ?? void 0;
	const providers = meterProviders !== void 0 && meterProviders.length > 0 ? meterProviders : DEFAULT_PROVIDERS;
	if (provider.length > 0 && !matchesAny(provider, providers)) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActiveUsage, {
		...props,
		model,
		provider
	});
};
//#endregion
//#region src/settings-page.tsx
/**
* `dsh-opencode-patch` settings page — DSH Web client bundle entry.
*
* Contributes a settings card under DSH Settings → Plugins and a quota pill in
* the composer dock. Wiring only: copy lives in `settings-copy.ts`, the field
* register in `settings-fields.ts`, presentation in `settings-card.tsx`. See
* AGENTS.md for the module map.
*
* @module dsh-opencode-patch/settings-page
*/
const NS = "dsh-opencode-patch";
const LEGACY_NS = "dsh-opencode";
/**
* The bundle's npm package name, spelled rather than imported.
*
* `plugins.bundle.config` entries are keyed by npm package name (not the
* cordis row id), so this must equal `package.json`'s `name`. The client
* half must not depend on the host half, hence the duplication.
*/
const PKG = "dsh-opencode-patch";
/**
* The plugin's remote contribution: the meter, under the package name `PKG`.
*
* It is a contribution rather than a bare descriptor list because Typert
* enforces unique package names, and this is the one place the package is
* registered. The meter's namespace is the only one this build mounts — the
* sign-in row and its `opencodeLogin` namespace are v2 work.
*/
const patchRemote = {
	descriptors: [...usageRemote.descriptors, ...purgeRemote.descriptors],
	package: PKG
};
/**
* The scoped npm name — published from this same tree, and the one a new
* install gets. It must answer to the SAME pages as `PKG` or the settings card
* never appears for whoever installed the name we tell them to. The retired
* `@viztor/dsh-opencode` is deliberately absent: it is a deprecated wrapper
* with no client half (see AGENTS.md, "Package vs component").
*/
const SCOPED_PKG = "@viztor/dsh-opencode-patch";
/** The value a Remote result carries, or a thrown failure. */
/**
* Mount one remote contribution, reporting why when it cannot.
*
* The two optional chains are the point: an absent `remote`, or a remote without
* `$mount`, evaluates to undefined WITHOUT throwing, so a catch around the call
* never runs and the surface simply renders nothing - indistinguishable from a
* surface whose service answered nothing.
*
* `ready` settles when the mount is DONE, which is the one observable fact a
* caller can wait on. Waiting on a service name instead does not work: the
* namespace the contribution installs (`remote.opencodeGoUsage`) is a child of
* the Host remote face, not a service a scoped `ctx.inject` resolves, so naming
* it waits forever and the meter only appeared through a ten-second timeout.
*
* @param ctx - the settings context.
* @param contribution - the remote's descriptors.
* @param what - what will not render, named in the report.
* @returns the disposer the effect gives back, and the mount's settlement.
*/
const mountRemote = (ctx, contribution, what) => {
	let dispose;
	return {
		dispose: () => {
			dispose?.();
		},
		ready: (async () => {
			if (ctx.remote === void 0 || typeof ctx.remote.$mount !== "function") {
				console.warn(`[dsh-opencode-patch] ${what}: the settings context has no remote to mount on`, Object.keys(ctx));
				return;
			}
			try {
				dispose = await ctx.remote.$mount(contribution);
				if (remoteNamespaceOf(ctx, "opencodeGoUsage") === void 0) {
					const face = isRecord(ctx.remote) ? Object.keys(ctx.remote) : [];
					console.warn(`[dsh-opencode-patch] ${what}: the mount settled but remote.opencodeGoUsage is still unreachable; the remote exposes [${face.join(", ")}]`);
				}
			} catch (error) {
				console.warn(`[dsh-opencode-patch] ${what} did not mount`, error);
			}
		})()
	};
};
const inject = [
	"slots",
	"locale",
	"configForms",
	"modelDirectories",
	"remote",
	"remote.session"
];
const isSettingsFormScope = (value) => {
	if (value === null || value === void 0) return false;
	if (typeof value !== "object" && typeof value !== "function") return false;
	if (!("getSnapshot" in value && "subscribe" in value && "mutate" in value)) return false;
	const snapshot = value.getSnapshot;
	const subscribe = value.subscribe;
	const mutate = value.mutate;
	return typeof snapshot === "function" && typeof subscribe === "function" && typeof mutate === "function";
};
const noopDisposer = () => {};
/**
* The slot registries this bundle has already put the meter into.
*
* Keyed on the REGISTRY, not on a boolean and not on the `apply` call. The host
* may run a plugin's client entry more than once in a page's life and the slot
* registry throws on a duplicate id, so a per-`apply` flag resets on the second
* run and turns that throw into a meter that disappears. A module-level boolean
* would fix that and then refuse a genuinely fresh registry — a second
* conversation surface, or a test's own slots — so the identity that matters is
* the registry itself.
*/
const meterRegisteredOn = /* @__PURE__ */ new WeakSet();
/**
* The session's model-directory store, or `undefined` when the service cannot
* resolve one yet.
*
* `ModelDirectoryResolver.directoryFor` **throws** for a session it does not
* know (e.g. a composer rendered before its session is bound). A throw here
* would take the whole dock slot down with it, so an unresolved session
* degrades to "no meter" instead.
*/
const modelDirectoryStore = (ctx, sessionId) => {
	if (ctx.modelDirectories === void 0) return { reason: "no modelDirectories service" };
	if (typeof ctx.modelDirectories.directoryFor !== "function") return { reason: "no directoryFor" };
	let directory;
	try {
		directory = ctx.modelDirectories.directoryFor(sessionId);
	} catch (error) {
		return { reason: `directoryFor threw: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (directory === void 0 || directory === null) return { reason: "directoryFor returned nothing" };
	const { store } = directory;
	if (store === void 0) return { reason: "directory has no store" };
	return { store };
};
/**
* The meter's translator: this bundle's dictionaries, never the seat's.
*
* The locale service allows one dictionary per (namespace, locale) and throws on
* a second registration, so a stale copy of this bundle holding the namespace
* starves every key we add: old keys translate, new keys render verbatim, and
* nothing says why — which is exactly how `goPlanTitle` reached the screen. So
* the meter does not ask the seat at all; see {@link withBundleCopy} for the
* fallback the settings card keeps on top of it.
*
* A language switch lands on the next call without a reload, because the id is
* read at call time rather than captured.
*/
const meterTranslate = (active) => withBundleCopy((key) => key, active);
const apply = (ctx) => {
	ctx.effect?.(() => {
		for (const namespace of [NS, LEGACY_NS]) try {
			ctx.locale?.register?.(namespace, {
				en,
				zh
			});
		} catch {}
		return noopDisposer;
	}, "dsh-opencode-patch: dictionaries");
	ctx.effect?.(() => {
		const remotes = mountRemote(ctx, patchRemote, "remotes; the meter and sign-in row will render nothing");
		(async () => {
			await remotes.ready;
			registerMeter(ctx);
		})();
		return remotes.dispose;
	}, "dsh-opencode-patch: remotes");
	const rawScope = ctx.configForms?.get?.("dsh-opencode-patch") ?? ctx.configForms?.get?.("dsh-opencode");
	const scope = isSettingsFormScope(rawScope) ? rawScope : void 0;
	/**
	* The configured quota-meter markers from the scope's current value,
	* falling back to the plugin defaults while the scope is loading or the
	* fields carry no user value.
	*/
	/**
	* The meter's client-side knobs, read from the served settings snapshot. The
	* provider list is the SAME one the host claims traffic for: a route we do not
	* intercept carries no OpenCode headers, so it has no quota to report either —
	* which is why there is no separate "which routes show the meter" setting.
	*/
	const usageMarkers = () => {
		const value = scope?.getSnapshot().value;
		const record = isRecord(value) ? value : {};
		const providers = readStringList(record.providers);
		return { meterProviders: providers.length > 0 ? providers : DEFAULT_PROVIDERS };
	};
	const createUsageInjector = (meterScope) => (sessionId) => {
		const probe = modelDirectoryStore(meterScope, sessionId);
		const directory = probe.store;
		if (directory === void 0 || directory === null) return { reason: probe.reason ?? "no directory" };
		const usage = remoteNamespaceOf(meterScope, "opencodeGoUsage") ?? remoteNamespace(meterScope.remote, "opencodeGoUsage");
		if (typeof usage?.read !== "function") return { reason: "no usage service: remote.opencodeGoUsage.read is missing" };
		const markers = usageMarkers();
		const meterSessionId = typeof sessionId === "string" ? sessionId : "";
		return {
			directory,
			...markers,
			readUsage: async (provider, model) => {
				const read = usage.read;
				const res = await read({
					...provider === void 0 || provider.length === 0 ? {} : { provider },
					...model === void 0 || model.length === 0 ? {} : { model },
					...meterSessionId.length === 0 ? {} : { sessionId: meterSessionId }
				});
				if (isRecord(res) && typeof res.ok === "boolean") {
					if (res.ok) return "value" in res ? res.value : void 0;
					throw "error" in res ? res.error : void 0;
				}
				return res;
			},
			t: meterTranslate(() => ctx.locale?.getLocale?.()?.active),
			getLocale: () => ctx.locale?.getLocale?.()?.active
		};
	};
	const registerMeter = (meterScope) => {
		if (meterRegisteredOn.has(ctx)) return;
		const { slots } = meterScope;
		if (slots === void 0 || typeof slots.inject !== "function") return;
		meterRegisteredOn.add(ctx);
		try {
			slots.inject("conversation.input.right", () => {
				console.info("[dsh-opencode-patch] the usage meter registered on conversation.input.right");
				return slots.register?.({
					id: "dsh-opencode-patch-usage",
					inject: createUsageInjector(meterScope),
					name: "conversation.input.right",
					order: 50
				}, UsagePill);
			});
		} catch (error) {
			console.warn("[dsh-opencode-patch] the usage meter was already registered", error);
		}
	};
	if (typeof ctx.inject === "function") {
		ctx.inject([
			"modelDirectories",
			"remote",
			"slots"
		], registerMeter);
		const fallback = setTimeout(() => {
			registerMeter(ctx);
		}, 1e4);
		ctx.effect?.(() => () => {
			clearTimeout(fallback);
		});
	} else registerMeter(ctx);
	if (scope === void 0) return;
	const model = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, SPECS);
	const store = model.bind(() => ({
		fields: Object.fromEntries(SPECS.map((spec) => [spec.field, model.field(spec.field)])),
		shell: model.shell()
	}));
	ctx.effect?.(() => () => {
		model.dispose();
	}, "dsh-opencode-patch: form subscription");
	ctx.effect?.(() => {
		const stop = ctx.slots?.inject?.("plugins.bundle.config", () => {
			const cards = [];
			const keepCard = (dispose) => {
				if (typeof dispose === "function") cards.push(dispose);
			};
			const aliases = [
				{
					key: PKG,
					locale: NS
				},
				{
					key: SCOPED_PKG,
					locale: NS
				},
				{
					key: LEGACY_NS,
					locale: LEGACY_NS
				}
			];
			for (const alias of aliases) keepCard(ctx.slots?.register?.({
				inject: () => ({
					getLocale: () => ctx.locale?.getLocale?.()?.active,
					hooks: { opencodeCard: store },
					readUsage: () => readGoUsage(ctx),
					purgeDeprecated: () => purgeDeprecatedModels(ctx),
					inspectStore: () => inspectStore(ctx),
					...model.actions()
				}),
				key: alias.key,
				locale: alias.locale,
				name: "plugins.bundle.config"
			}, OpencodeCard));
			return () => {
				for (const dispose of cards) dispose();
			};
		});
		return () => {
			if (typeof stop === "function") stop();
		};
	}, "dsh-opencode-patch: settings");
};
//#endregion
exports.LEGACY_NS = LEGACY_NS;
exports.NS = NS;
exports.PKG = PKG;
exports.SCOPED_PKG = SCOPED_PKG;
exports.SPECS = SPECS;
exports.apply = apply;
exports.inject = inject;
exports.patchRemote = patchRemote;
exports.remoteNamespace = remoteNamespace;
exports.remoteNamespaceOf = remoteNamespaceOf;

    return module.exports;
  };
  window.__ModuleLoader__.load({ id: "dsh-opencode-patch", factory: factory });
  try { window.__ModuleLoader__.load({ id: "@viztor/dsh-opencode-patch", factory: factory }); } catch (e) {}
  try { window.__ModuleLoader__.load({ id: "dsh-opencode", factory: factory }); } catch (e) {}
})();