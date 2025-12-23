# Checkend Ingestion API

## Overview

The Ingestion API allows client applications to send error reports to Checkend. Errors are grouped into "problems" via fingerprinting, enabling efficient error tracking and resolution.

---

## Authentication

All API requests must include the `Checkend-Ingestion-Key` header with a valid app ingestion key.

```http
Checkend-Ingestion-Key: your_ingestion_key_here
```

> **Note:** This header follows [RFC 6648](https://tools.ietf.org/html/rfc6648) conventions by using a vendor-prefixed header name (`Checkend-`) instead of the deprecated `X-` prefix.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 401 | Missing or invalid ingestion key |
| 403 | Ingestion key is valid but app is disabled |

---

## Endpoints

### POST /ingest/v1/errors

Report a new error occurrence.

#### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Checkend-Ingestion-Key` | Yes | App ingestion key for authentication |
| `Content-Type` | Yes | Must be `application/json` |

#### Request Body

```json
{
  "error": {
    "class": "NoMethodError",
    "message": "undefined method `foo' for nil:NilClass",
    "backtrace": [
      "app/models/user.rb:42:in `validate_email'",
      "app/models/user.rb:10:in `save'",
      "app/controllers/users_controller.rb:25:in `create'"
    ],
    "fingerprint": null,
    "tags": ["critical", "payments"]
  },
  "context": {
    "user_id": "user_123",
    "account_id": "acc_456",
    "custom_key": "custom_value"
  },
  "request": {
    "url": "https://example.com/users/123",
    "method": "POST",
    "params": {
      "user": {
        "email": "[FILTERED]",
        "name": "John Doe"
      }
    },
    "headers": {
      "User-Agent": "Mozilla/5.0...",
      "Accept": "application/json"
    },
    "ip_address": "192.168.1.1"
  },
  "user": {
    "id": "user_123",
    "email": "john@example.com",
    "name": "John Doe"
  },
  "environment": "production",
  "notifier": {
    "name": "checkend-ruby",
    "version": "1.0.0",
    "language": "ruby",
    "language_version": "3.2.0"
  },
  "occurred_at": "2024-01-15T10:30:00Z"
}
```

#### Field Reference

##### error (required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `class` | string | Yes | Exception class name (e.g., `NoMethodError`) |
| `message` | string | Yes | Error message |
| `backtrace` | array | Yes | Array of backtrace lines (strings) |
| `fingerprint` | string | No | Custom fingerprint for grouping. If null, auto-generated |
| `tags` | array | No | Array of string tags for filtering |

##### context (optional)

Arbitrary key-value pairs for custom context. Useful for debugging.

```json
{
  "user_id": "123",
  "feature_flag": "new_checkout",
  "subscription_tier": "premium"
}
```

##### request (optional)

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Full request URL |
| `method` | string | HTTP method (GET, POST, etc.) |
| `params` | object | Request parameters (filtered for sensitive data) |
| `headers` | object | HTTP headers (filtered) |
| `ip_address` | string | Client IP address |

##### user (optional)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | User identifier |
| `email` | string | User email |
| `name` | string | User display name |

##### environment (optional)

String indicating the environment. Defaults to the app's default environment.

Examples: `production`, `staging`, `development`

##### notifier (optional)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Client library name |
| `version` | string | Client library version |
| `language` | string | Programming language |
| `language_version` | string | Language version |

##### occurred_at (optional)

ISO 8601 timestamp of when the error occurred. Defaults to server receipt time.

---

#### Success Response

**Status:** `201 Created`

```json
{
  "id": "notice_abc123",
  "problem_id": "problem_xyz789",
  "url": "https://checkend.example.com/apps/1/problems/problem_xyz789"
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier for this notice |
| `problem_id` | The problem this notice was grouped into |
| `url` | Direct link to view this problem in the dashboard |

---

#### Error Responses

**400 Bad Request** - Invalid payload

```json
{
  "error": "validation_failed",
  "messages": [
    "error.class is required",
    "error.message is required"
  ]
}
```

**401 Unauthorized** - Missing or invalid ingestion key

```json
{
  "error": "unauthorized",
  "message": "Invalid or missing ingestion key"
}
```

**422 Unprocessable Entity** - Valid JSON but semantic errors

```json
{
  "error": "unprocessable_entity",
  "message": "Backtrace must be an array of strings"
}
```

**429 Too Many Requests** - Rate limit exceeded

```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded. Retry after 60 seconds.",
  "retry_after": 60
}
```

---

## Fingerprinting

Fingerprints determine how errors are grouped into problems.

### Auto-Generated Fingerprint

If no custom fingerprint is provided, Checkend generates one from:

1. Error class name
2. First line of backtrace (file + line number)

```
SHA256("NoMethodError:app/models/user.rb:42")
```

### Custom Fingerprint

Provide a custom fingerprint to control grouping:

```json
{
  "error": {
    "class": "TimeoutError",
    "message": "Connection timed out after 30s",
    "backtrace": ["..."],
    "fingerprint": "external-api-timeout"
  }
}
```

Use cases for custom fingerprints:
- Group errors by feature rather than code location
- Combine similar errors with different messages
- Separate errors that would otherwise be grouped

---

## Rate Limiting

| Limit | Value |
|-------|-------|
| Requests per minute | 1000 per app |
| Burst limit | 100 requests |

Rate limit headers are included in all responses:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1705312800
```

---

## Best Practices

### 1. Filter Sensitive Data

Before sending, filter out:
- Passwords and tokens
- Credit card numbers
- Personal identification numbers
- Session cookies

### 2. Limit Backtrace Size

Send at most 100 backtrace lines. Truncate from the bottom (keep the top/most relevant lines).

### 3. Use Custom Fingerprints Sparingly

Auto-generated fingerprints work well for most cases. Use custom fingerprints only when you need specific grouping behavior.

### 4. Include Context

The more context you provide, the easier debugging becomes:
- User information
- Request details
- Feature flags
- Relevant IDs

### 5. Handle Failures Gracefully

If the API is unavailable:
- Queue errors locally
- Retry with exponential backoff
- Drop errors after max retries (don't crash your app)

---

## Example: cURL

```bash
curl -X POST https://checkend.example.com/ingest/v1/errors \
  -H "Content-Type: application/json" \
  -H "Checkend-Ingestion-Key: your_ingestion_key_here" \
  -d '{
    "error": {
      "class": "RuntimeError",
      "message": "Something went wrong",
      "backtrace": [
        "app/services/payment.rb:15:in `process'",
        "app/controllers/orders_controller.rb:42:in `create'"
      ]
    },
    "environment": "production"
  }'
```

---

## Example: Ruby Client

```ruby
require "net/http"
require "json"

class CheckendClient
  def initialize(ingestion_key)
    @ingestion_key = ingestion_key
    @uri = URI("https://checkend.example.com/ingest/v1/errors")
  end

  def report(exception, context: {}, request: nil, user: nil)
    payload = {
      error: {
        class: exception.class.name,
        message: exception.message,
        backtrace: exception.backtrace || []
      },
      context: context,
      request: request,
      user: user,
      environment: Rails.env,
      occurred_at: Time.current.iso8601
    }

    post(payload)
  end

  private

  def post(payload)
    http = Net::HTTP.new(@uri.host, @uri.port)
    http.use_ssl = true

    request = Net::HTTP::Post.new(@uri.path)
    request["Content-Type"] = "application/json"
    request["Checkend-Ingestion-Key"] = @ingestion_key
    request.body = payload.to_json

    response = http.request(request)
    JSON.parse(response.body)
  end
end
```

---

## Versioning

The API is versioned via URL path (`/ingest/v1/`). Breaking changes will increment the version number. Non-breaking additions (new optional fields) may be added without version change.

---

## Future Endpoints (Planned)

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/problems` | List problems for an app (Application API) |
| `GET /api/v1/problems/:id` | Get problem details (Application API) |
| `POST /api/v1/problems/:id/resolve` | Mark problem as resolved (Application API) |
| `GET /api/v1/health` | API health check (Application API) |
