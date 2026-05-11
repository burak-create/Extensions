# Polling HTTP Request Extension

A Cognigy.AI Extension that provides a **Polling HTTP Request** node. Unlike the native HTTP Request node (which is subject to Cognigy's 4-iteration flow loop limit), this node performs the entire retry loop within the Extension's async execution context.

## Node: Polling HTTP Request

### What it does

1. Sends an HTTP request to the configured URL.
2. Evaluates a JSONPath expression against the response body to extract a status value.
3. If the status matches a **Success Value**, it routes to the `On Success` output and stores the response.
4. If the status matches a **Failure Value**, it routes to the `On Failure` output and stores the response.
5. If the status matches a **Retry Value**, it waits for the configured interval and repeats.
6. If all retries are exhausted without a terminal status, it routes to the `On Timeout` output.

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
| Retry Interval (ms) | Wait time between attempts. Default: 2000 ms |
| Max Retries | Maximum number of retries before Timeout exit. Default: 5 |
| Termination Path | JSONPath to the status field, e.g. `$.data.status` |
| Success Values | Comma-separated chip values that trigger On Success |
| Retry Values | Comma-separated chip values that trigger a retry |
| Failure Values | Comma-separated chip values that trigger On Failure |

#### Result Storage

| Field | Description |
|---|---|
| Store Location | Save response to `input` or `context` |
| Key | Property name under which the result is stored |

### Timeout Budget

The total execution time is bounded by `maxRetries × retryInterval`. Cognigy's Extension timeout is approximately **20 seconds**. For example, 5 retries × 2000 ms = 10 seconds, which is safe. Exceeding the timeout will cause an Extension error.

### Response Shape Stored

```json
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { "...": "..." }
}
```
