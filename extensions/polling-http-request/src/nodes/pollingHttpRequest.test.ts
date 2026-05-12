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
	{ type: "onPollingSuccess", id: "success-child-id" },
	{ type: "onPollingFailure", id: "failure-child-id" },
	{ type: "onPollingTimeout", id: "timeout-child-id" },
];

function baseConfig(
	overrides: Partial<IPollingHttpRequestConfig> = {},
): IPollingHttpRequestConfig {
	return {
		method: "GET",
		url: "https://api.example.com/jobs/42",
		headerKey1: "",
		headerValue1: "",
		headerKey2: "",
		headerValue2: "",
		headerKey3: "",
		headerValue3: "",
		headerKey4: "",
		headerValue4: "",
		headerKey5: "",
		headerValue5: "",
		headerKey6: "",
		headerValue6: "",
		bodyType: "none",
		bodyText: "",
		bodyKey1: "",
		bodyValue1: "",
		bodyKey2: "",
		bodyValue2: "",
		bodyKey3: "",
		bodyValue3: "",
		bodyKey4: "",
		bodyValue4: "",
		bodyKey5: "",
		bodyValue5: "",
		bodyKey6: "",
		bodyValue6: "",
		authType: "none",
		username: "",
		password: "",
		apiKeyHeader: "",
		apiKeyValue: "",
		retryInterval: 0,
		maxRetries: 3,
		terminationPath: "$.status",
		successValues: "COMPLETED,SUCCESS",
		retryValues: "PENDING,IN_PROGRESS",
		failureValues: "FAILED,CANCELLED",
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
		return pollingHttpRequest.function({
			// biome-ignore lint/suspicious/noExplicitAny: minimal cognigy mock for unit tests
			cognigy: { api: { setNextNode }, input, context } as any,
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
				bodyKey1: "foo",
				bodyValue1: "bar",
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
				bodyKey1: "name",
				bodyValue1: "alice",
				bodyKey2: "role",
				bodyValue2: "admin",
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

	// ── JSONPath Evaluation ──────────────────────────────────────────────────

	it("evaluates a deeply nested JSONPath expression to extract the status", async () => {
		mock.method(global, "fetch", async () =>
			makeMockResponse({ data: { job: { state: "SUCCESS" } } }),
		);

		await callNode(
			baseConfig({
				terminationPath: "$.data.job.state",
				successValues: "SUCCESS",
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
