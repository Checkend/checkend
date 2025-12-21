# Checkend

Self-hosted error monitoring for your applications. Track, group, and resolve errors with a clean web interface.

## Features

- **Error Ingestion** - Simple REST API to receive errors from your apps
- **Smart Grouping** - Automatic fingerprinting groups similar errors together
- **Web Dashboard** - View, search, and resolve errors
- **Email Notifications** - Get notified when new errors occur
- **Multi-App Support** - Monitor multiple applications from one dashboard

## Tech Stack

- Ruby on Rails 8
- PostgreSQL
- Tailwind CSS
- Solid Queue (background jobs)

## Getting Started

### Requirements

- Ruby 3.3+
- PostgreSQL 14+
- Node.js 18+ (for Tailwind)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/checkend.git
cd checkend

# Install dependencies
bundle install

# Setup database
bin/rails db:setup

# Start the server
bin/dev
```

Visit `http://localhost:3000` and create your account.

### Create Your First App

1. Log in to the dashboard
2. Click "New App"
3. Copy the API key

### Send an Error

```bash
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "error": {
      "class": "NoMethodError",
      "message": "undefined method foo for nil:NilClass",
      "backtrace": [
        {"file": "app/models/user.rb", "line": 42, "function": "save"}
      ]
    },
    "context": {
      "environment": "production"
    }
  }'
```

## API Reference

### POST /api/v1/errors

Report an error to Checkend.

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: your_app_api_key`

**Payload:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error.class` | string | Yes | Error class name |
| `error.message` | string | Yes | Error message |
| `error.backtrace` | array | Yes | Stack trace frames |
| `error.tags` | array | No | Tags for filtering |
| `error.fingerprint` | string | No | Custom grouping key |
| `context.environment` | string | No | e.g., "production" |
| `context.hostname` | string | No | Server hostname |
| `request.url` | string | No | Request URL |
| `request.method` | string | No | HTTP method |
| `request.params` | object | No | Request parameters |
| `user.id` | string | No | User identifier |
| `user.email` | string | No | User email |

**Response (201 Created):**

```json
{
  "id": "abc123",
  "url": "https://checkend.example.com/problems/456/notices/abc123"
}
```

## Development

```bash
# Run tests
bin/rails test

# Run linter
bin/rubocop

# Run the server
bin/dev
```

## License

MIT
