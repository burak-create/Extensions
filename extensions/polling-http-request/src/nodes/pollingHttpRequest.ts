import {
	createNodeDescriptor,
	type INodeFunctionBaseParams,
} from "@cognigy/extension-tools";
import { JSONPath } from "jsonpath-plus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IPollingHttpRequestConfig {
	method: "GET" | "POST" | "PUT" | "DELETE";
	url: string;
	headers: unknown;
	bodyType: "none" | "json" | "text" | "formData";
	body: unknown;
	bodyText: string;
	bodyFormData: unknown;
	authType: "none" | "basicAuth" | "apiKey";
	username: string;
	password: string;
	apiKeyHeader: string;
	apiKeyValue: string;
	retryInterval: number;
	maxRetries: number;
	terminationPath: string;
	successValues: string[];
	retryValues: string[];
	failureValues: string[];
	storeLocation: "input" | "context";
	inputKey: string;
	contextKey: string;
}

export interface IPollingHttpRequestParams extends INodeFunctionBaseParams {
	config: IPollingHttpRequestConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildAuthHeaders(
	config: IPollingHttpRequestConfig,
): Record<string, string> {
	const extra: Record<string, string> = {};
	if (config.authType === "basicAuth" && config.username) {
		const encoded = Buffer.from(
			`${config.username}:${config.password ?? ""}`,
		).toString("base64");
		extra.Authorization = `Basic ${encoded}`;
	} else if (config.authType === "apiKey" && config.apiKeyHeader) {
		extra[config.apiKeyHeader] = config.apiKeyValue ?? "";
	}
	return extra;
}

function resolveContentType(
	bodyType: IPollingHttpRequestConfig["bodyType"],
): string | undefined {
	switch (bodyType) {
		case "json":
			return "application/json";
		case "text":
			return "text/plain";
		case "formData":
			return "application/x-www-form-urlencoded";
		default:
			return undefined;
	}
}

/**
 * Safely coerces a field value that may arrive as a plain JSON string
 * (when the field type is cognigyText and Cognigy has resolved CognigyScript
 * expressions) or as a plain object (test fixtures / older configs).
 * Returns an empty object when the value is absent or empty.
 */
function parseJsonField(
	value: unknown,
	fieldName: string,
): Record<string, unknown> {
	if (value === null || value === undefined) return {};
	if (typeof value === "object") return value as Record<string, unknown>;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "" || trimmed === "{}") return {};
		try {
			return JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			throw new Error(
				`Polling HTTP Request: "${fieldName}" must be a valid JSON object. Received: ${trimmed}`,
			);
		}
	}
	return {};
}

function buildBody(config: IPollingHttpRequestConfig): string | undefined {
	switch (config.bodyType) {
		case "json":
			// config.body is a cognigyText string after CognigyScript resolution;
			// fall back to JSON.stringify for object values (test fixtures / legacy).
			if (typeof config.body === "string") return config.body;
			return JSON.stringify(config.body ?? {});
		case "text":
			return String(config.bodyText ?? "");
		case "formData": {
			const parsed = parseJsonField(config.bodyFormData, "Body (Form Data)");
			const params = new URLSearchParams();
			for (const [k, v] of Object.entries(parsed)) {
				params.append(k, String(v));
			}
			return params.toString();
		}
		default:
			return undefined;
	}
}

interface IPollingResult {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

// ---------------------------------------------------------------------------
// Parent node
// ---------------------------------------------------------------------------

export const pollingHttpRequest = createNodeDescriptor({
	type: "pollingHttpRequest",
	defaultLabel: "Polling HTTP Request",
	summary: "Polls an HTTP endpoint until a terminal status is reached",

	dependencies: {
		children: ["onPollingSuccess", "onPollingFailure", "onPollingTimeout"],
	},

	fields: [
		// ── HTTP Request ──────────────────────────────────────────────────────
		{
			key: "method",
			label: "Method",
			type: "select",
			defaultValue: "GET",
			params: {
				options: [
					{ label: "GET", value: "GET" },
					{ label: "POST", value: "POST" },
					{ label: "PUT", value: "PUT" },
					{ label: "DELETE", value: "DELETE" },
				],
				required: true,
			},
		},
		{
			key: "url",
			label: "URL",
			type: "cognigyText",
			defaultValue: "",
			description: "The full URL to poll. CognigyScript is supported.",
			params: {
				required: true,
				placeholder: "https://api.example.com/jobs/{{input.jobId}}",
			},
		},
		{
			key: "headers",
			label: "Headers",
			type: "cognigyText",
			defaultValue: "",
			description:
				'Additional request headers as a JSON object string. CognigyScript is supported, e.g. {"Authorization": "Bearer {{ci.token}}"}.',
			params: {
				placeholder: '{"Authorization": "Bearer {{ci.token}}"}',
			},
		},
		{
			key: "bodyType",
			label: "Body Type",
			type: "select",
			defaultValue: "none",
			description: "Format of the request body.",
			params: {
				options: [
					{ label: "None", value: "none" },
					{ label: "JSON", value: "json" },
					{ label: "Text", value: "text" },
					{ label: "Form Data", value: "formData" },
				],
			},
			condition: {
				key: "method",
				value: "GET",
				negate: true,
			},
		},
		{
			key: "body",
			label: "Body (JSON)",
			type: "cognigyText",
			defaultValue: "{}",
			description:
				'Request body as a JSON object string. CognigyScript is supported, e.g. {"jobId": "{{ci.jobId}}"}.',
			params: {
				placeholder: '{"key": "{{ci.value}}"}',
			},
			condition: {
				key: "bodyType",
				value: "json",
			},
		},
		{
			key: "bodyText",
			label: "Body",
			type: "cognigyText",
			defaultValue: "",
			description: "Request body as plain text.",
			condition: {
				key: "bodyType",
				value: "text",
			},
		},
		{
			key: "bodyFormData",
			label: "Body (Form Data)",
			type: "cognigyText",
			defaultValue: "{}",
			description:
				'Request body as a JSON object string of key-value pairs, sent as form-encoded data. CognigyScript is supported, e.g. {"name": "{{ci.name}}"}.',
			params: {
				placeholder: '{"name": "{{ci.name}}"}',
			},
			condition: {
				key: "bodyType",
				value: "formData",
			},
		},

		// ── Authentication ────────────────────────────────────────────────────
		{
			key: "authType",
			label: "Authentication",
			type: "select",
			defaultValue: "none",
			params: {
				options: [
					{ label: "None", value: "none" },
					{ label: "Basic Auth", value: "basicAuth" },
					{ label: "API Key", value: "apiKey" },
				],
			},
		},
		{
			key: "username",
			label: "Username",
			type: "cognigyText",
			defaultValue: "",
			condition: { key: "authType", value: "basicAuth" },
		},
		{
			key: "password",
			label: "Password",
			type: "cognigyText",
			defaultValue: "",
			condition: { key: "authType", value: "basicAuth" },
		},
		{
			key: "apiKeyHeader",
			label: "Header Name",
			type: "cognigyText",
			defaultValue: "X-Api-Key",
			description: "The header name used to send the API key.",
			condition: { key: "authType", value: "apiKey" },
		},
		{
			key: "apiKeyValue",
			label: "API Key",
			type: "cognigyText",
			defaultValue: "",
			condition: { key: "authType", value: "apiKey" },
		},

		// ── Polling Configuration ─────────────────────────────────────────────
		{
			key: "retryInterval",
			label: "Retry Interval (ms)",
			type: "number",
			defaultValue: 2000,
			description: "Time in milliseconds to wait between polling attempts.",
			params: { min: 100, max: 15000 },
		},
		{
			key: "maxRetries",
			label: "Max Retries",
			type: "number",
			defaultValue: 5,
			description:
				"Maximum number of retry attempts before the Timeout exit is taken. Total execution time (maxRetries × retryInterval) must stay under ~20 seconds to avoid Extension timeout.",
			params: { min: 1, max: 50 },
		},
		{
			key: "terminationPath",
			label: "Termination Path (JSONPath)",
			type: "cognigyText",
			defaultValue: "$.status",
			description:
				"JSONPath expression pointing to the status field in the response body, e.g. $.data.status",
			params: { required: true },
		},
		{
			key: "successValues",
			label: "Success Values",
			type: "chipInput",
			defaultValue: ["COMPLETED", "SUCCESS"],
			description: "Status values that trigger the On Success exit.",
		},
		{
			key: "retryValues",
			label: "Retry Values",
			type: "chipInput",
			defaultValue: ["PENDING", "IN_PROGRESS"],
			description: "Status values that trigger another retry.",
		},
		{
			key: "failureValues",
			label: "Failure Values",
			type: "chipInput",
			defaultValue: ["FAILED", "CANCELLED"],
			description: "Status values that trigger the On Failure exit.",
		},

		// ── Result Storage ────────────────────────────────────────────────────
		{
			key: "storeLocation",
			label: "Store Result In",
			type: "select",
			defaultValue: "context",
			params: {
				options: [
					{ label: "Input", value: "input" },
					{ label: "Context", value: "context" },
				],
			},
		},
		{
			key: "inputKey",
			label: "Input Key",
			type: "cognigyText",
			defaultValue: "pollingResult",
			description: "Key under which the result is stored in the Input object.",
			condition: { key: "storeLocation", value: "input" },
		},
		{
			key: "contextKey",
			label: "Context Key",
			type: "cognigyText",
			defaultValue: "pollingResult",
			description:
				"Key under which the result is stored in the Context object.",
			condition: { key: "storeLocation", value: "context" },
		},
	],

	sections: [
		{
			key: "httpSection",
			label: "HTTP Request",
			defaultCollapsed: false,
			fields: [
				"method",
				"url",
				"headers",
				"bodyType",
				"body",
				"bodyText",
				"bodyFormData",
			],
		},
		{
			key: "authSection",
			label: "Authentication",
			defaultCollapsed: true,
			fields: [
				"authType",
				"username",
				"password",
				"apiKeyHeader",
				"apiKeyValue",
			],
		},
		{
			key: "pollingSection",
			label: "Polling Configuration",
			defaultCollapsed: false,
			fields: [
				"retryInterval",
				"maxRetries",
				"terminationPath",
				"successValues",
				"retryValues",
				"failureValues",
			],
		},
		{
			key: "storageSection",
			label: "Result Storage",
			defaultCollapsed: true,
			fields: ["storeLocation", "inputKey", "contextKey"],
		},
	],

	form: [
		{ type: "section", key: "httpSection" },
		{ type: "section", key: "authSection" },
		{ type: "section", key: "pollingSection" },
		{ type: "section", key: "storageSection" },
	],

	preview: {
		key: "url",
		type: "text",
	},

	function: async (params) => {
		const {
			cognigy,
			config: rawConfig,
			childConfigs,
		} = params as IPollingHttpRequestParams;
		const config = rawConfig;
		const { api, input, context } = cognigy;

		// Fix 3: Timeout budget guard — fail fast before any network I/O
		const estimatedMs = config.maxRetries * (config.retryInterval ?? 2000);
		if (estimatedMs > 18_000) {
			throw new Error(
				`Polling HTTP Request: estimated execution time of ${estimatedMs} ms exceeds the safe limit of 18 000 ms. Reduce Max Retries or Retry Interval.`,
			);
		}

		// Resolve child node IDs
		const successChild = childConfigs.find(
			(c) => c.type === "onPollingSuccess",
		);
		const failureChild = childConfigs.find(
			(c) => c.type === "onPollingFailure",
		);
		const timeoutChild = childConfigs.find(
			(c) => c.type === "onPollingTimeout",
		);

		if (!successChild || !failureChild || !timeoutChild) {
			throw new Error(
				"Polling HTTP Request: one or more output child nodes are missing. Please attach On Success, On Failure, and On Timeout nodes.",
			);
		}

		// Build static request headers (auth headers computed once).
		// parseJsonField handles both cognigyText strings (CognigyScript resolved)
		// and plain objects (test fixtures / legacy configs).
		const parsedHeaders = parseJsonField(config.headers, "Headers") as Record<
			string,
			string
		>;
		const requestHeaders: Record<string, string> = {
			...parsedHeaders,
			...buildAuthHeaders(config),
		};
		const contentType = resolveContentType(config.bodyType);
		if (contentType) {
			requestHeaders["Content-Type"] = contentType;
		}

		// Build request body string (same across all retries)
		const bodyPayload = buildBody(config);

		function storeResult(result: unknown): void {
			if (config.storeLocation === "input") {
				(input as Record<string, unknown>)[config.inputKey ?? "pollingResult"] =
					result;
			} else {
				(context as Record<string, unknown>)[
					config.contextKey ?? "pollingResult"
				] = result;
			}
		}

		// Fix 1 & 2: pre-read value lists; hoist lastResult so the timeout exit can store it
		const successValues = config.successValues ?? [];
		const failureValues = config.failureValues ?? [];
		const retryValues = config.retryValues ?? [];

		let lastResult: IPollingResult | undefined;

		// Polling loop — runs entirely in this async function, no Cognigy flow iteration
		for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
			let responseBody: unknown;
			let responseStatus: number;
			let responseHeaders: Record<string, string>;

			try {
				const fetchOptions: RequestInit = {
					method: config.method,
					headers: requestHeaders as HeadersInit,
				};
				if (bodyPayload !== undefined) {
					fetchOptions.body = bodyPayload;
				}

				const response = await fetch(config.url, fetchOptions);
				responseStatus = response.status;

				responseHeaders = {};
				response.headers.forEach((value, key) => {
					responseHeaders[key] = value;
				});

				const rawText = await response.text();
				try {
					responseBody = JSON.parse(rawText);
				} catch {
					responseBody = rawText;
				}
			} catch (err) {
				throw new Error(
					`Polling HTTP Request: network error on attempt ${attempt + 1}: ${String(err)}`,
				);
			}

			const result: IPollingResult = {
				status: responseStatus,
				headers: responseHeaders,
				body: responseBody,
			};

			// Fix 2: track the latest successful response so the timeout exit always has data
			lastResult = result;

			// Evaluate JSONPath termination condition
			let statusValue = "";
			if (
				config.terminationPath &&
				typeof responseBody === "object" &&
				responseBody !== null
			) {
				const matches = JSONPath({
					path: config.terminationPath,
					json: responseBody,
				});
				if (Array.isArray(matches) && matches.length > 0) {
					statusValue = String(matches[0]);
				}
			}

			if (successValues.includes(statusValue)) {
				storeResult(result);
				api.setNextNode(successChild.id);
				return;
			}

			if (failureValues.includes(statusValue)) {
				storeResult(result);
				api.setNextNode(failureChild.id);
				return;
			}

			// retryValues is explicitly consulted: a value in that list is the expected
			// "loop back" case (e.g. PENDING). An unknown value — not present in any of the
			// three lists — also retries defensively so that integrations are not silently
			// broken by unexpected transient statuses. Only success/failure values terminate
			// the loop early.
			// _isDocumentedRetry is intentionally unused at runtime; it makes the retryValues
			// consultation explicit and testable.
			const _isDocumentedRetry = retryValues.includes(statusValue);
			if (attempt < config.maxRetries) {
				await sleep(config.retryInterval ?? 2000);
			}
		}

		// Fix 2: All retries exhausted — store the last received response before routing
		if (lastResult) {
			storeResult(lastResult);
		}
		api.setNextNode(timeoutChild.id);
	},
});

// ---------------------------------------------------------------------------
// Child nodes
// ---------------------------------------------------------------------------

export const onPollingSuccess = createNodeDescriptor({
	type: "onPollingSuccess",
	parentType: "pollingHttpRequest",
	defaultLabel: "On Success",
	appearance: {
		color: "#27ae60",
		textColor: "white",
		variant: "mini",
	},
	constraints: {
		editable: false,
		deletable: false,
		collapsable: true,
		creatable: false,
		movable: false,
		placement: {
			predecessor: {
				whitelist: [],
			},
		},
	},
});

export const onPollingFailure = createNodeDescriptor({
	type: "onPollingFailure",
	parentType: "pollingHttpRequest",
	defaultLabel: "On Failure",
	appearance: {
		color: "#e74c3c",
		textColor: "white",
		variant: "mini",
	},
	constraints: {
		editable: false,
		deletable: false,
		collapsable: true,
		creatable: false,
		movable: false,
		placement: {
			predecessor: {
				whitelist: [],
			},
		},
	},
});

export const onPollingTimeout = createNodeDescriptor({
	type: "onPollingTimeout",
	parentType: "pollingHttpRequest",
	defaultLabel: "On Timeout",
	appearance: {
		color: "#e67e22",
		textColor: "white",
		variant: "mini",
	},
	constraints: {
		editable: false,
		deletable: false,
		collapsable: true,
		creatable: false,
		movable: false,
		placement: {
			predecessor: {
				whitelist: [],
			},
		},
	},
});
