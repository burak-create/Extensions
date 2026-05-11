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
	headers: Record<string, string>;
	bodyType: "none" | "json" | "text" | "formData";
	body: unknown;
	bodyText: string;
	bodyFormData: Record<string, string>;
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

function buildBody(config: IPollingHttpRequestConfig): string | undefined {
	switch (config.bodyType) {
		case "json":
			return JSON.stringify(config.body ?? {});
		case "text":
			return String(config.bodyText ?? "");
		case "formData": {
			const params = new URLSearchParams();
			for (const [k, v] of Object.entries(config.bodyFormData ?? {})) {
				params.append(k, String(v));
			}
			return params.toString();
		}
		default:
			return undefined;
	}
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
			type: "json",
			defaultValue: {},
			description: "Additional request headers as a JSON object.",
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
			label: "Body",
			type: "json",
			defaultValue: {},
			description: "Request body as a JSON object.",
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
			type: "json",
			defaultValue: {},
			description:
				"Request body as a JSON object of key-value pairs, sent as form-encoded data.",
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

	function: async ({
		cognigy,
		config,
		childConfigs,
	}: IPollingHttpRequestParams) => {
		const { api, input, context } = cognigy;

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

		// Build static request headers (auth headers computed once)
		const requestHeaders: Record<string, string> = {
			...(config.headers ?? {}),
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

			const result = {
				status: responseStatus,
				headers: responseHeaders,
				body: responseBody,
			};

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

			const successValues = config.successValues ?? [];
			const failureValues = config.failureValues ?? [];

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

			// Not terminal — wait and retry (unless this was the last attempt)
			if (attempt < config.maxRetries) {
				await sleep(config.retryInterval ?? 2000);
			}
		}

		// All retries exhausted without a terminal status
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
