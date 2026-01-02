# Checkend

[![CI](https://github.com/furvur/checkend/actions/workflows/ci.yml/badge.svg)](https://github.com/furvur/checkend/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Self-hosted error monitoring for your applications. Track, group, and resolve errors with a clean web interface.

> **Note:** The documentation site is located in a separate repository at `../checkend-site`.

## Features

- **Error Ingestion** - Simple REST API to receive errors from any language or framework
- **Smart Grouping** - Automatic fingerprinting groups similar errors together as "problems"
- **Web Dashboard** - View, search, and resolve errors with a clean UI
- **Multi-App Support** - Monitor multiple applications from one dashboard
- **Backtrace Deduplication** - Efficient storage by deduplicating identical stack traces
- **Self-Hosted** - Your data stays on your infrastructure

## Client SDKs

Official SDKs are available for popular languages and frameworks:

| Language | Package | Repository |
|----------|---------|------------|
| **Ruby** | `checkend` | [checkend-ruby](https://github.com/furvur/checkend-ruby) |
| **JavaScript (Browser)** | `@checkend/browser` | [checkend-browser](https://github.com/furvur/checkend-browser) |
| **JavaScript (Node.js)** | `@checkend/node` | [checkend-node](https://github.com/furvur/checkend-node) |
| **Python** | `checkend` | [checkend-python](https://github.com/furvur/checkend-python) |
| **Go** | `github.com/furvur/checkend-go` | [checkend-go](https://github.com/furvur/checkend-go) |
| **PHP** | `checkend/checkend` | [checkend-php](https://github.com/furvur/checkend-php) |
| **Elixir** | `checkend` | [checkend-elixir](https://github.com/furvur/checkend-elixir) |
| **Java** | `com.checkend:checkend` | [checkend-java](https://github.com/furvur/checkend-java) |
| **.NET** | `Checkend` | [checkend-dotnet](https://github.com/furvur/checkend-dotnet) |

### Framework Integrations

Each SDK includes integrations for popular frameworks:

- **Ruby**: Rails (Railtie), Rack middleware, Sidekiq, Solid Queue
- **Node.js**: Express, Koa, Fastify
- **Python**: Django, Flask, FastAPI/ASGI
- **Go**: net/http, Gin, Echo
- **PHP**: Laravel, generic error handler
- **Elixir**: Plug middleware, Phoenix
- **Java**: Spring Boot, Servlet filter
- **.NET**: ASP.NET Core middleware

### Quick Install

```bash
# Ruby
gem install checkend

# JavaScript (Browser)
npm install @checkend/browser

# JavaScript (Node.js)
npm install @checkend/node

# Python
pip install checkend

# Go
go get github.com/furvur/checkend-go

# PHP
composer require checkend/checkend

# Elixir (add to mix.exs)
{:checkend, "~> 0.1.0"}

# Java (Maven)
<dependency>
  <groupId>com.checkend</groupId>
  <artifactId>checkend</artifactId>
  <version>0.1.0</version>
</dependency>

# .NET
dotnet add package Checkend
```

## Tech Stack

- Ruby on Rails 8.1
- PostgreSQL
- Tailwind CSS
- Hotwire (Turbo + Stimulus)
- Solid Queue for background jobs
- Docker for deployment

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

# Generate credentials (required for encryption)
bin/rails credentials:edit

# Add the following to your credentials file:
# secret_key_base: (run `bin/rails secret` to generate)
# active_record_encryption:
#   primary_key: (run `bin/rails db:encryption:init` to generate all three)
#   deterministic_key:
#   key_derivation_salt:

# Setup database (creates and migrates, but does NOT seed)
bin/rails db:prepare

# Start the server
bin/dev
```

Visit `http://localhost:3000` to complete the onboarding wizard.

> **Note:** Use `db:prepare` (not `db:setup`) to avoid seeding demo data. For development with sample data, run `bin/rails db:seed` after setup.

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

### Community Edition (Recommended for Self-Hosting)

The easiest way to self-host Checkend is with our [Community Edition](https://github.com/Checkend/community-edition):

```bash
git clone https://github.com/Checkend/community-edition.git checkend
cd checkend
./setup.sh
docker compose up -d
```

The interactive setup can install Docker automatically on Ubuntu/Debian, handles secret generation, and supports both direct SSL (Let's Encrypt) and reverse proxy configurations.

---

### Option 1: Docker (Manual Setup)

Build and run Checkend with Docker:

```bash
# Clone and build
git clone https://github.com/checkend/checkend.git
cd checkend
docker build -t checkend .
```

**Quick start with Docker Compose:**

```yaml
# docker-compose.yml
services:
  checkend:
    build: .
    ports:
      - "80:80"
    environment:
      - RAILS_MASTER_KEY=${RAILS_MASTER_KEY}
      - DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@db/checkend
      - SOLID_QUEUE_IN_PUMA=true
    depends_on:
      - db

  db:
    image: postgres:17
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=checkend
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

```bash
# Generate secrets
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export RAILS_MASTER_KEY=$(openssl rand -hex 32)

# Build and start the services
docker compose up -d --build
```

Visit `http://localhost` and create your account.

> **Note:** Building locally ensures the image is native to your architecture (AMD64, ARM64, etc.) for optimal performance.

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
