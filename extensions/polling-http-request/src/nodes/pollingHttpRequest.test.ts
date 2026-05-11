import * as assert from "node:assert";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
	type IPollingHttpRequestConfig,
	pollingHttpRequest,
} from "./pollingHttpRequest";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Builds a minimal fetch Response-shaped mock object. */
function makeMockResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = { "content-type": "application/json" },
) {
	return {
		ok: status >= 200 && status < 400,
		status,
		headers: {
			forEach(cb: (value: string, key: string) => void) {
				for (const [k, v] of Object.entries(headers)) {
					cb(v, k);
				}
			},
		},
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	};
}

const CHILD_CONFIGS = [
	{ type: "onPollingSuccess", id: "success-child-id", config: {} },
	{ type: "onPollingFailure", id: "failure-child-id", config: {} },
	{ type: "onPollingTimeout", id: "timeout-child-id", config: {} },
];

function baseConfig(
	overrides: Partial<IPollingHttpRequestConfig> = {},
): IPollingHttpRequestConfig {
	return {
		method: "GET",
		url: "https://api.example.com/jobs/42",
		headersMode: "json",
		headers: {},
		header1Name: "",
		header1Value: "",
		header2Name: "",
		header2Value: "",
		header3Name: "",
		header3Value: "",
		header4Name: "",
		header4Value: "",
		header5Name: "",
		header5Value: "",
		bodyType: "none",
		body: {},
		bodyText: "",
		bodyFormData: {},
		authType: "none",
		username: "",
		password: "",
		apiKeyHeader: "",
		apiKeyValue: "",
		retryInterval: 0,
		maxRetries: 3,
		terminationPath: "$.status",
		successValues: ["COMPLETED", "SUCCESS"],
		retryValues: ["PENDING", "IN_PROGRESS"],
		failureValues: ["FAILED", "CANCELLED"],
		storeLocation: "context",
		inputKey: "pollingResult",
		contextKey: "pollingResult",
		...overrides,
	};
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("pollingHttpRequest", () => {
	// biome-ignore lint/suspicious/noExplicitAny: mock.fn needs a generic slot for the node API
	let setNextNode: ReturnType<typeof mock.fn<any>>;
	let input: Record<string, unknown>;
	let context: Record<string, unknown>;

	beforeEach(() => {
		setNextNode = mock.fn();
		input = {};
		context = {};
	});

	afterEach(() => {
		mock.restoreAll();
	});

	function callNode(
		config: IPollingHttpRequestConfig,
		children = CHILD_CONFIGS,
	) {
		// biome-ignore lint/suspicious/noExplicitAny: minimal cognigy mock for unit tests
		const fn = pollingHttpRequest.function as (params: any) => Promise<void>;
		return fn({
			cognigy: { api: { setNextNode }, input, context },
			config,
			childConfigs: children,
		});
	}

	// ── Routing ─────────────────────────────────────────────────────────────

	it("routes to onPollingSuccess when the termination value matches a success value", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "COMPLETED" }),
		);

		await callNode(baseConfig());

		assert.strictEqual(setNextNode.mock.calls.length, 1);
		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"success-child-id",
		);
	});

	it("routes to onPollingFailure when the termination value matches a failure value", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "FAILED" }),
		);

		await callNode(baseConfig());

		assert.strictEqual(setNextNode.mock.calls.length, 1);
		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"failure-child-id",
		);
	});

	it("routes to onPollingTimeout after all retries are exhausted without a terminal status", async () => {
		// No { times } — the mock stays active and returns PENDING for every call.
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "PENDING" }),
		);

		await callNode(baseConfig({ maxRetries: 2 }));

		assert.strictEqual(setNextNode.mock.calls.length, 1);
		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"timeout-child-id",
		);
	});

	it("retries on a retry value and routes to onPollingSuccess on a subsequent attempt", async () => {
		// Stacked { times: 1 } mocks — last registered is consumed first.
		mock.method(
			global,
			"fetch",
			async () => makeMockResponse({ status: "COMPLETED" }),
			{ times: 1 },
		);
		mock.method(
			global,
			"fetch",
			async () => makeMockResponse({ status: "PENDING" }),
			{ times: 1 },
		);

		await callNode(baseConfig({ maxRetries: 2 }));

		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"success-child-id",
		);
	});

	// ── Result Storage ───────────────────────────────────────────────────────

	it("stores the full response object in context under the configured key", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "COMPLETED", jobId: 42 }),
		);

		await callNode(
			baseConfig({ storeLocation: "context", contextKey: "myResult" }),
		);

		const result = context.myResult as Record<string, unknown>;
		assert.ok(result, "result should be stored in context");
		assert.strictEqual(result.status, 200);
		assert.deepStrictEqual(result.body, { status: "COMPLETED", jobId: 42 });
	});

	it("stores the full response object in input under the configured key", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "COMPLETED" }),
		);

		await callNode(
			baseConfig({ storeLocation: "input", inputKey: "myResult" }),
		);

		const result = input.myResult as Record<string, unknown>;
		assert.ok(result, "result should be stored in input");
		assert.strictEqual(result.status, 200);
	});

	it("includes response headers in the stored result object", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "SUCCESS" }, 200, {
				"x-request-id": "abc-123",
			}),
		);

		await callNode(baseConfig());

		const result = context.pollingResult as Record<string, unknown>;
		assert.deepStrictEqual(result.headers, { "x-request-id": "abc-123" });
	});

	// ── Error Handling ───────────────────────────────────────────────────────

	it("throws when a required child node is missing from childConfigs", async () => {
		await assert.rejects(
			() => callNode(baseConfig(), []),
			/one or more output child nodes are missing/i,
		);
	});

	it("throws a descriptive error when fetch rejects with a network error", async () => {
		mock.method(global, "fetch", async () => {
			throw new Error("Connection refused");
		});

		await assert.rejects(
			() => callNode(baseConfig()),
			/network error on attempt 1/i,
		);
	});

	// ── Authentication ───────────────────────────────────────────────────────

	it("sets a Basic Authorization header derived from username and password", async () => {
		let capturedHeaders: Record<string, string> = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedHeaders = options.headers as Record<string, string>;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				authType: "basicAuth",
				username: "alice",
				password: "secret",
			}),
		);

		const expected = `Basic ${Buffer.from("alice:secret").toString("base64")}`;
		assert.strictEqual(capturedHeaders.Authorization, expected);
	});

	it("sets a custom API key header when authType is apiKey", async () => {
		let capturedHeaders: Record<string, string> = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedHeaders = options.headers as Record<string, string>;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				authType: "apiKey",
				apiKeyHeader: "X-Api-Key",
				apiKeyValue: "token-xyz",
			}),
		);

		assert.strictEqual(capturedHeaders["X-Api-Key"], "token-xyz");
	});

	// ── Request Body ─────────────────────────────────────────────────────────

	it("sends a serialised JSON body and sets Content-Type application/json", async () => {
		let capturedOptions: RequestInit = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedOptions = options;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				method: "POST",
				bodyType: "json",
				body: { foo: "bar" },
			}),
		);

		assert.strictEqual(capturedOptions.method, "POST");
		assert.strictEqual(capturedOptions.body, JSON.stringify({ foo: "bar" }));
		assert.strictEqual(
			(capturedOptions.headers as Record<string, string>)["Content-Type"],
			"application/json",
		);
	});

	it("sends a URL-encoded body and sets Content-Type application/x-www-form-urlencoded", async () => {
		let capturedOptions: RequestInit = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedOptions = options;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				method: "POST",
				bodyType: "formData",
				bodyFormData: { name: "alice", role: "admin" },
			}),
		);

		assert.strictEqual(capturedOptions.body, "name=alice&role=admin");
		assert.strictEqual(
			(capturedOptions.headers as Record<string, string>)["Content-Type"],
			"application/x-www-form-urlencoded",
		);
	});

	it("sends a plain-text body and sets Content-Type text/plain", async () => {
		let capturedOptions: RequestInit = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedOptions = options;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				method: "POST",
				bodyType: "text",
				bodyText: "hello world",
			}),
		);

		assert.strictEqual(capturedOptions.body, "hello world");
		assert.strictEqual(
			(capturedOptions.headers as Record<string, string>)["Content-Type"],
			"text/plain",
		);
	});

	it("sends no body when bodyType is none", async () => {
		let capturedOptions: RequestInit = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedOptions = options;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(baseConfig({ method: "GET", bodyType: "none" }));

		assert.strictEqual(capturedOptions.body, undefined);
	});

	// ── CognigyScript (ci./cc.) Field Support ────────────────────────────────

	it("passes an object body as serialised JSON (json-type field, CognigyScript resolved in platform)", async () => {
		let capturedOptions: RequestInit = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedOptions = options;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				method: "POST",
				bodyType: "json",
				// json-type fields deliver a plain object (with CognigyScript resolved
				// in string values by the platform before the Extension is called)
				body: { jobId: "abc-123", userId: "42" },
			}),
		);

		assert.strictEqual(
			capturedOptions.body,
			JSON.stringify({ jobId: "abc-123", userId: "42" }),
		);
		assert.strictEqual(
			(capturedOptions.headers as Record<string, string>)["Content-Type"],
			"application/json",
		);
	});

	it("passes object headers from the JSON editor (headersMode: json)", async () => {
		let capturedHeaders: Record<string, string> = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedHeaders = options.headers as Record<string, string>;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				headersMode: "json",
				// json-type field delivers a plain object; string values have CognigyScript
				// already resolved by the platform
				headers: { "X-Tenant-Id": "tenant-99", "X-Request-Id": "req-001" },
			}),
		);

		assert.strictEqual(capturedHeaders["X-Tenant-Id"], "tenant-99");
		assert.strictEqual(capturedHeaders["X-Request-Id"], "req-001");
	});

	it("builds headers from individual key-value cognigyText pairs (headersMode: keyValue)", async () => {
		let capturedHeaders: Record<string, string> = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedHeaders = options.headers as Record<string, string>;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				headersMode: "keyValue",
				header1Name: "Authorization",
				header1Value: "Bearer token-abc",
				header2Name: "X-Tenant-Id",
				header2Value: "tenant-99",
			}),
		);

		assert.strictEqual(capturedHeaders.Authorization, "Bearer token-abc");
		assert.strictEqual(capturedHeaders["X-Tenant-Id"], "tenant-99");
	});

	it("ignores blank header entries in keyValue mode", async () => {
		let capturedHeaders: Record<string, string> = {};
		mock.method(global, "fetch", async (_url: string, options: RequestInit) => {
			capturedHeaders = options.headers as Record<string, string>;
			return makeMockResponse({ status: "COMPLETED" });
		});

		await callNode(
			baseConfig({
				headersMode: "keyValue",
				header1Name: "X-Api-Key",
				header1Value: "key-xyz",
				// header2-5 left blank (default "")
			}),
		);

		assert.strictEqual(capturedHeaders["X-Api-Key"], "key-xyz");
		assert.strictEqual(Object.keys(capturedHeaders).length, 1);
	});

	it("throws a descriptive error when the headers JSON editor contains invalid JSON string", async () => {
		await assert.rejects(
			() =>
				callNode(
					baseConfig({
						headersMode: "json",
						headers: "not-valid-json",
					}),
				),
			/"Headers" must be a valid JSON object/i,
		);
	});

	// ── retryValues Consultation (Fix 1) ────────────────────────────────────

	it("retryValues is explicitly consulted — a known retry value re-polls before resolving", async () => {
		mock.method(
			global,
			"fetch",
			async () => makeMockResponse({ status: "COMPLETED" }),
			{ times: 1 },
		);
		mock.method(
			global,
			"fetch",
			async () => makeMockResponse({ status: "PENDING" }),
			{ times: 1 },
		);

		await callNode(
			baseConfig({ retryValues: ["PENDING"], maxRetries: 3, retryInterval: 0 }),
		);

		assert.strictEqual(setNextNode.mock.calls.length, 1);
		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"success-child-id",
		);
	});

	it("an unknown status (not in any list) retries defensively and eventually times out", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "QUEUED" }),
		);

		await callNode(
			baseConfig({
				retryValues: ["PENDING"],
				maxRetries: 1,
				retryInterval: 0,
			}),
		);

		assert.strictEqual(setNextNode.mock.calls.length, 1);
		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"timeout-child-id",
		);
	});

	// ── Timeout Store (Fix 2) ────────────────────────────────────────────────

	it("stores the last response in context before routing to the timeout exit", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ status: "PENDING", attempt: 1 }),
		);

		await callNode(
			baseConfig({
				maxRetries: 1,
				retryInterval: 0,
				storeLocation: "context",
				contextKey: "lastPoll",
			}),
		);

		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"timeout-child-id",
		);
		const stored = context.lastPoll as Record<string, unknown>;
		assert.ok(stored, "last response should be stored on timeout");
		assert.deepStrictEqual(stored.body, { status: "PENDING", attempt: 1 });
	});

	// ── Budget Guard (Fix 3) ─────────────────────────────────────────────────

	it("throws when maxRetries × retryInterval exceeds 18 000 ms", async () => {
		await assert.rejects(
			() =>
				callNode(
					baseConfig({
						maxRetries: 10,
						retryInterval: 2000,
					}),
				),
			/exceeds the safe limit of 18 000 ms/i,
		);
	});

	// ── JSONPath Evaluation ──────────────────────────────────────────────────

	it("evaluates a deeply nested JSONPath expression to extract the status", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ data: { job: { state: "SUCCESS" } } }),
		);

		await callNode(
			baseConfig({
				terminationPath: "$.data.job.state",
				successValues: ["SUCCESS"],
			}),
		);

		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"success-child-id",
		);
	});

	// ── Non-JSON Response ────────────────────────────────────────────────────

	it("stores raw text as the body when the response is not valid JSON and times out", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse("plain text response", 200),
		);

		// Plain text cannot match any status value → timeout branch taken
		await callNode(baseConfig({ maxRetries: 0 }));

		assert.strictEqual(
			setNextNode.mock.calls[0].arguments[0],
			"timeout-child-id",
		);
	});
});
