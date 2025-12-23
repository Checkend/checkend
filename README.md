# Checkend

[![CI](https://github.com/furvur/checkend/actions/workflows/ci.yml/badge.svg)](https://github.com/furvur/checkend/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Self-hosted error monitoring for your applications. Track, group, and resolve errors with a clean web interface.

## Features

- **Error Ingestion** - Simple REST API to receive errors from any language or framework
- **Smart Grouping** - Automatic fingerprinting groups similar errors together as "problems"
- **Web Dashboard** - View, search, and resolve errors with a clean UI
- **Multi-App Support** - Monitor multiple applications from one dashboard
- **Backtrace Deduplication** - Efficient storage by deduplicating identical stack traces
- **Self-Hosted** - Your data stays on your infrastructure

## Tech Stack

- Ruby on Rails 8.1
- PostgreSQL
- Tailwind CSS
- Hotwire (Turbo + Stimulus)
- Solid Queue for background jobs
- Kamal for deployment

## Getting Started

### Requirements

- Ruby 3.3+
- PostgreSQL 14+
- Node.js 20+ (for Tailwind CSS)

### Installation

```bash
# Clone the repository
git clone https://github.com/furvur/checkend.git
cd checkend

# Install dependencies
bundle install

# Setup database
bin/rails db:setup

# Start the server
bin/dev
```

Visit `http://localhost:3000` and create your account.

### Quick Start

1. **Create an app** - Log in and click "New App" to get an ingestion key
2. **Send errors** - Use the API to report errors from your application
3. **Monitor** - View grouped errors in the dashboard and mark them resolved

### Sending Your First Error

```bash
curl -X POST http://localhost:3000/ingest/v1/errors \
  -H "Content-Type: application/json" \
  -H "Checkend-Ingestion-Key: your_ingestion_key" \
  -d '{
    "error": {
      "class": "NoMethodError",
      "message": "undefined method `foo` for nil:NilClass",
      "backtrace": [
        {"file": "app/models/user.rb", "line": 42, "function": "save"}
      ]
    }
  }'
```

## API Reference

### POST /ingest/v1/errors

Report an error to Checkend.

**Headers:**
- `Content-Type: application/json`
- `Checkend-Ingestion-Key: your_app_ingestion_key`

**Payload:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error.class` | string | Yes | Error class name |
| `error.message` | string | Yes | Error message |
| `error.backtrace` | array | Yes | Stack trace frames |
| `error.tags` | array | No | Tags for filtering |
| `error.fingerprint` | string | No | Custom grouping key |
| `context` | object | No | Additional context (environment, hostname, etc.) |
| `request` | object | No | Request info (url, method, params) |
| `user` | object | No | User info (id, email, name) |

**Backtrace frame format:**

```json
{"file": "app/models/user.rb", "line": 42, "function": "save"}
```

**Response (201 Created):**

```json
{
  "id": "abc123",
  "url": "https://checkend.example.com/problems/456/notices/abc123"
}
```

## Deployment

Checkend includes [Kamal](https://kamal-deploy.org/) configuration for easy deployment.

### Prerequisites

- A server with Docker installed
- PostgreSQL database
- Domain name (optional, for SSL)

### Deploy

```bash
# Edit config/deploy.yml with your server details
# Set up secrets
export RAILS_MASTER_KEY=$(cat config/master.key)
export CHECKEND_DATABASE_PASSWORD=your_db_password

# Deploy
bin/kamal setup
```

See `config/deploy.yml` for configuration options.

## Development

```bash
# Run tests
bin/rails test

# Run system tests
bin/rails test:system

# Linting
bin/rubocop

# Security scans
bin/brakeman --no-pager
bin/bundler-audit

# Start development server
bin/dev
```

## Project Structure

```
app/
├── controllers/
│   └── ingest/v1/       # Ingestion API endpoints
├── models/
│   ├── app.rb           # Client applications
│   ├── problem.rb       # Grouped errors
│   ├── notice.rb        # Individual error occurrences
│   └── backtrace.rb     # Deduplicated stack traces
└── views/               # Dashboard UI
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please make sure tests pass and code is linted before submitting:

```bash
bin/rails test
bin/rubocop
```

## License

Copyright (c) 2025 Simon Chiu

This project is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0) (AGPL-3.0).

This means you can freely use, modify, and distribute this software, but if you run a modified version as a network service (e.g., SaaS), you must make your source code available to users of that service.

### Commercial License

For organizations that want to use Checkend without the obligations of the AGPL (for example, to keep proprietary modifications private), a commercial license is available. Contact checkend@furvur.com for details.
