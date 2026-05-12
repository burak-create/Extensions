# Polling HTTP Request Extension

A Cognigy.AI Extension that provides a **Polling HTTP Request** node. Unlike the native HTTP Request node (which is subject to Cognigy's 4-iteration flow loop limit), this node performs the entire retry loop inside the Extension's async execution context.

## Node: Polling HTTP Request

### What it does

1. Sends an HTTP request to the configured URL (method, URL, headers, body).
2. Evaluates a JSONPath expression against the response body to extract a **status** string.
3. If the status matches a **Success Value**, it routes to **On Success** and stores the response.
4. If the status matches a **Failure Value**, it routes to **On Failure** and stores the response.
5. If the status is eligible to **retry** (see **Retry Values** below), it waits for **Retry Interval** and polls again, until **Max Retries** is reached.
6. If **Max Retries** is exhausted without success or failure, it routes to **On Timeout**.

### Retry Values behavior

- **Retry Values is empty** (after Cognigy evaluates the field): any status that is **not** in Success Values and **not** in Failure Values is treated as non-terminal and the node keeps polling until max retries, then **On Timeout**.
- **Retry Values is non-empty**: the node only continues polling when the extracted status is **in** that list, or when the extracted status is an **empty string** (e.g. non-JSON body, path miss, or empty match — so ambiguous cases still time out rather than failing immediately). If the status is not success, not failure, not in Retry Values, and not empty, the node routes to **On Failure** with the last response stored.

### Output paths

| Path        | When |
|-------------|------|
| On Success  | Extracted status is in Success Values |
| On Failure  | Extracted status is in Failure Values, or (strict retry list) unexpected status |
| On Timeout  | Max retries exhausted while still in a retrying state |

### Configuration

#### HTTP Request

| Field | Description |
|-------|-------------|
| Method | GET, POST, PUT, DELETE |
| URL | Target URL (`cognigyText` — CognigyScript supported) |
| Request Headers | Up to **6** Key / Value pairs (`cognigyText`). Empty keys are ignored. Merged with auth headers and `Content-Type` when a body is sent. |
| Body Type | none / json / text / formData (hidden for GET) |
| Body | **Text**: single `cognigyText` body. **JSON** / **Form Data**: up to **6** Key / Value pairs; JSON is serialised as an object, form data as `application/x-www-form-urlencoded`. |

#### Authentication

| Field | Description |
|-------|-------------|
| Auth Type | none / Basic Auth / API Key |
| Username / Password | Basic Auth (`cognigyText`) |
| Header Name / API Key | API Key mode (`cognigyText`) |

#### Polling configuration

| Field | Description |
|-------|-------------|
| Retry Interval (ms) | Wait between attempts (default 2000). |
| Max Retries | Upper bound on polling attempts before **On Timeout** (default 5). |
| Termination Path | JSONPath to the status field (e.g. `$.data.status`). `cognigyText`. |
| Success Values | Comma-separated tokens (`cognigyText`). CognigyScript supported, e.g. `COMPLETED,{{cc.doneStatuses}}`. |
| Retry Values | Comma-separated tokens (`cognigyText`). Same script support. See **Retry Values behavior** above. |
| Failure Values | Comma-separated tokens (`cognigyText`). Same script support. |

Use the CognigyScript syntax your platform version documents (e.g. `{{ context.x }}`, `{{ input.x }}`, `{{ profile.x }}` — sometimes abbreviated as `cc` / `ci` / `cp` in tooling).

#### Result storage

| Field | Description |
|-------|-------------|
| Store Location | `input` or `context` |
| Input Key / Context Key | Property name for the stored result (`cognigyText`) |

### Timeout budget

Wall-clock time is roughly bounded by **Max Retries × Retry Interval** (plus request latency). Cognigy's Extension runtime limit is on the order of **~20 seconds**; keep the product within a safe margin.

### Stored result shape

```json
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": {}
}
```

## Build

From `extensions/polling-http-request`:

```bash
npm install
npm run build
```

Produces `polling-http-request.tar.gz` (also tracked in git per repo `.gitignore` exception) for upload to Cognigy.
