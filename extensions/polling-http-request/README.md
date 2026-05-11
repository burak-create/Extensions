# Polling HTTP Request Extension

A Cognigy.AI Extension that provides a **Polling HTTP Request** node. Unlike the native HTTP Request node (which is subject to Cognigy's 4-iteration flow loop limit), this node performs the entire retry loop within the Extension's async execution context.

## Node: Polling HTTP Request

### What it does

1. Validates that the configured `maxRetries × retryInterval` budget is within the safe Extension timeout limit (18 000 ms). If not, an error is thrown immediately before any network I/O.
2. Sends an HTTP request to the configured URL.
3. Evaluates a JSONPath expression against the response body to extract a status value.
4. If the status matches a **Success Value**, it routes to the `On Success` output and stores the response.
5. If the status matches a **Failure Value**, it routes to the `On Failure` output and stores the response.
6. If the status matches a **Retry Value** (or is an unknown transient value), it waits for the configured interval and repeats from step 2.
7. If all retries are exhausted without a terminal status, it stores the last received response and routes to the `On Timeout` output.

### Output Paths

| Path | Triggered when |
|---|---|
| On Success | Response status matches a Success Value |
| On Failure | Response status matches a Failure Value |
| On Timeout | Max retries exhausted without a terminal status |

### Configuration

#### HTTP Request

| Field | Description |
|---|---|
| Method | HTTP method: GET, POST, PUT, DELETE |
| URL | Target URL (CognigyScript supported) |
| Headers | JSON object of request headers |
| Body Type | none / json / text / formData |
| Body | Request body (shown based on Body Type) |

#### Authentication

| Field | Description |
|---|---|
| Auth Type | none / Basic Auth / API Key |
| Username / Password | Used when Auth Type = Basic Auth |
| Header Name / Value | Used when Auth Type = API Key |

#### Polling Configuration

| Field | Description |
|---|---|
| Retry Interval (ms) | Wait time between attempts. Default: 2000 ms. Min: 100 ms, Max: 15 000 ms |
| Max Retries | Maximum number of retries before Timeout exit. Default: 5. Min: 1, Max: 50 |
| Termination Path | JSONPath to the status field, e.g. `$.data.status` |
| Success Values | Chip values that trigger On Success (e.g. `COMPLETED`, `SUCCESS`) |
| Retry Values | Chip values that document expected looping statuses (e.g. `PENDING`, `IN_PROGRESS`) |
| Failure Values | Chip values that trigger On Failure (e.g. `FAILED`, `CANCELLED`) |

#### Result Storage

| Field | Description |
|---|---|
| Store Location | Save response to `input` or `context` |
| Key | Property name under which the result is stored |

---

### Retry Logic

The three value lists are evaluated in order each attempt:

1. **Success Values** — terminates the loop and takes the On Success exit.
2. **Failure Values** — terminates the loop and takes the On Failure exit.
3. **Retry Values** — explicitly consulted: a status present in this list loops back as expected (e.g. `PENDING`).
4. **Unknown Values** — a status not present in *any* of the three lists also loops back defensively. This prevents integrations from silently breaking when an API returns unexpected transient statuses (e.g. a new intermediate state added by the upstream service). The `maxRetries` cap remains the safety net.

### Timeout Budget

The node validates the execution budget at startup:

```
estimatedMs = maxRetries × retryInterval
```

If `estimatedMs > 18 000 ms`, the node throws an error immediately (before making any HTTP request) with a descriptive message. This protects against misconfiguration that would otherwise cause the Extension to be killed silently by the Cognigy platform's ~20-second timeout.

**Safe example:** 5 retries × 2 000 ms = 10 000 ms — well within the limit.  
**Rejected example:** 10 retries × 2 000 ms = 20 000 ms — throws at startup.

### Response Stored on Timeout

When all retries are exhausted, the **last received HTTP response** is stored in the configured location (`input` or `context`) before the On Timeout exit is taken. This means the Timeout branch always has access to the most recent response body for diagnostics or fallback logic.

### Response Shape

```json
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { "...": "..." }
}
```

---

## Known Limitations / Future Work

### Connection-based Authentication (Recommended by Cognigy)

The current implementation stores passwords and API keys as plain `cognigyText` fields. Cognigy.AI's recommended approach is to use encrypted **Connections** (see `docs/example/src/connections/apiKeyConnection.ts` for the pattern), which store credentials server-side and never expose them in the Flow editor.

Migrating to Connection-based auth requires a breaking change to the node's config schema — existing Flows that have already configured the node would need to remap their auth fields. This is deferred to a future version.

---

## Development

### Prerequisites

```bash
npm install
```

### Commands

| Command | Description |
|---|---|
| `npm test` | Run unit tests with coverage |
| `npm run transpile` | Compile TypeScript to `build/` |
| `npm run lint` | Run Biome linter |
| `npm run format` | Auto-format with Biome |
| `npm run build` | Full pipeline: test → transpile → lint → zip |

### Build Output

`npm run build` produces `polling-http-request.tar.gz`, ready to upload to Cognigy.AI via **Extensions → Upload**.
