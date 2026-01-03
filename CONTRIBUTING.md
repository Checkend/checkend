# Contributing to Checkend

Thank you for your interest in contributing to Checkend! This guide will help you get started with development and submit high-quality contributions.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Development Setup](#development-setup)
  - [Database Configuration](#database-configuration)
  - [Environment Variables](#environment-variables)
- [Development Workflow](#development-workflow)
  - [Running the Application](#running-the-application)
  - [Running Tests](#running-tests)
  - [Code Style](#code-style)
  - [Security Scanning](#security-scanning)
- [Architecture Overview](#architecture-overview)
  - [Domain Models](#domain-models)
  - [API Structure](#api-structure)
  - [Key Technologies](#key-technologies)
- [Making Changes](#making-changes)
  - [Branch Naming](#branch-naming)
  - [Commit Messages](#commit-messages)
  - [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)
- [Adding New Features](#adding-new-features)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind, constructive, and professional in all interactions.

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Ruby | 3.3+ | We recommend using [asdf](https://asdf-vm.com/) or [rbenv](https://github.com/rbenv/rbenv) |
| PostgreSQL | 14+ | Required for all databases |
| Git | 2.0+ | For version control |

**Not required:**
- Node.js - We use Importmap for JavaScript (no bundler needed)
- Redis - We use Solid Queue/Cache/Cable (database-backed)

### Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/checkend.git
cd checkend

# 2. Install Ruby dependencies
bundle install

# 3. Generate credentials (required for encryption)
bin/rails credentials:edit

# Add the following to your credentials file:
# secret_key_base: (run `bin/rails secret` to generate)
# active_record_encryption:
#   primary_key: (run `bin/rails db:encryption:init` to generate all three)
#   deterministic_key:
#   key_derivation_salt:

# 4. Setup database
bin/rails db:prepare

# 5. Run the test suite to verify setup
bin/rails test

# 6. Start the development server
bin/dev
```

Visit `http://localhost:3000` to complete the onboarding wizard.

### Database Configuration

Checkend uses a multi-database setup with PostgreSQL:

| Database | Purpose | Development Name |
|----------|---------|------------------|
| Primary | Main application data | `checkend_development` |
| Cache | Solid Cache storage | `checkend_development_cache` |
| Queue | Solid Queue jobs | `checkend_development_queue` |
| Cable | Action Cable messages | `checkend_development_cable` |

All databases are created automatically by `bin/rails db:prepare`.

### Environment Variables

For development, credentials are managed via Rails encrypted credentials. For CI/testing, you can use environment variables:

```bash
# Required for Active Record Encryption (CI only)
ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=<hex string>
ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY=<hex string>
ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT=<hex string>

# Database (optional, defaults to socket connection)
DATABASE_URL=postgres://localhost/checkend_development
```

---

## Development Workflow

### Running the Application

```bash
# Start Rails server + Tailwind CSS watcher
bin/dev

# Or run components separately:
bin/rails server           # Rails only
bin/rails tailwindcss:watch  # Tailwind watcher
```

The app runs at `http://localhost:3000`.

### Running Tests

```bash
# Run all tests
bin/rails test

# Run a specific test file
bin/rails test test/models/user_test.rb

# Run a specific test by line number
bin/rails test test/models/user_test.rb:42

# Run system tests (requires browser)
bin/rails test:system

# Run tests with verbose output
bin/rails test -v
```

**Test Coverage Goals:**
- All models should have tests
- All controllers should have tests
- Critical user flows should have system tests

### Code Style

We use [Rubocop](https://rubocop.org/) with the `rubocop-rails-omakase` configuration (Rails default style).

```bash
# Check for violations
bin/rubocop

# Auto-fix safe violations
bin/rubocop -a

# Auto-fix all violations (including unsafe)
bin/rubocop -A

# Check specific files
bin/rubocop app/models/user.rb
```

**Before submitting a PR, ensure:**
```bash
bin/rubocop  # No violations
```

### Security Scanning

Run these before submitting PRs:

```bash
# Static analysis for Rails security vulnerabilities
bin/brakeman --no-pager

# Check for known vulnerabilities in gems
bin/bundler-audit

# Check JavaScript dependencies
bin/importmap audit
```

All three should report no warnings or vulnerabilities.

---

## Architecture Overview

### Domain Models

```
User
├── owns Teams
├── belongs to Teams (through TeamMembers)
└── has Sessions, PasswordHistories, NotificationPreferences

Team
├── has TeamMembers (Users with roles: admin, member)
├── has TeamInvitations
└── has TeamAssignments → Apps

App (client application)
├── has ingestion_key (for API auth)
├── has notification settings (Slack, Discord, webhook, GitHub)
└── has Problems

Problem (grouped error)
├── has fingerprint (unique per app)
├── has status (unresolved/resolved)
├── has Tags (many-to-many)
└── has Notices

Notice (individual error occurrence)
├── has context, request, user_info (JSONB)
└── belongs to Backtrace

Backtrace (deduplicated)
├── has fingerprint (hash of lines)
└── has lines (JSONB array)
```

### API Structure

```
/ingest/v1/errors          # Error ingestion (SDK use)
  - POST: Report an error

/api/v1/                   # Application API (API key auth)
  ├── health               # Health check
  ├── apps                 # App management
  │   └── :app_id/problems # Problem management
  │       └── :problem_id/notices
  │       └── :problem_id/tags
  ├── teams                # Team management
  │   └── :team_id/members
  └── users                # User management (admin only)
```

### Key Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Rails 8.1 | Web application |
| Database | PostgreSQL | Primary data store |
| CSS | Tailwind CSS | Styling (via tailwindcss-rails) |
| JavaScript | Hotwire (Turbo + Stimulus) | Frontend interactivity |
| JS Bundling | Importmap | ESM modules (no Node.js) |
| Background Jobs | Solid Queue | Database-backed job queue |
| Caching | Solid Cache | Database-backed cache |
| WebSockets | Solid Cable | Database-backed Action Cable |
| Notifications | Noticed gem | Multi-channel notifications |
| Deployment | Kamal | Docker-based deployment |

---

## Making Changes

### Branch Naming

Use descriptive branch names with a prefix:

```
feature/add-slack-notifications
fix/problem-grouping-bug
docs/update-api-reference
refactor/extract-fingerprint-service
test/add-session-model-tests
```

### Commit Messages

Write clear, concise commit messages:

```
Add Slack notification support for new problems

- Integrate Slack webhook API
- Add slack_webhook_url to App model
- Create SlackNotifier class
- Add tests for notification delivery
```

**Guidelines:**
- Use present tense ("Add feature" not "Added feature")
- First line: 50 characters or less, summarize the change
- Body: Explain what and why (not how)
- Reference issues: "Fixes #123" or "Closes #456"

### Pull Request Process

1. **Create a feature branch** from `main`
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature
   ```

2. **Make your changes** with tests

3. **Ensure all checks pass**
   ```bash
   bin/rails test              # All tests pass
   bin/rubocop                 # No linting errors
   bin/brakeman --no-pager     # No security warnings
   bin/bundler-audit           # No gem vulnerabilities
   ```

4. **Push and create a PR**
   ```bash
   git push origin feature/your-feature
   ```

5. **PR Description** should include:
   - Summary of changes
   - Why the change is needed
   - How to test it
   - Screenshots (for UI changes)

6. **Address review feedback** promptly

7. **Squash and merge** once approved

---

## Reporting Issues

When reporting bugs, please include:

1. **Environment** - Ruby version, Rails version, OS
2. **Steps to reproduce** - Minimal steps to trigger the bug
3. **Expected behavior** - What should happen
4. **Actual behavior** - What actually happens
5. **Error messages** - Full stack traces if available
6. **Screenshots** - For UI issues

Use the GitHub issue template when available.

---

## Feature Requests

We welcome feature requests! Please:

1. **Search existing issues** to avoid duplicates
2. **Describe the problem** you're trying to solve
3. **Propose a solution** if you have one in mind
4. **Consider alternatives** you've thought about

Tag your issue with `enhancement`.

---

## Adding New Features

### Before You Start

1. **Check the roadmap** - See [ROADMAP.md](ROADMAP.md) for planned features
2. **Open an issue** - Discuss your idea before implementing
3. **Get feedback** - Ensure the feature aligns with project goals

### Implementation Checklist

- [ ] Add model/migration if needed
- [ ] Add controller actions
- [ ] Add views (follow existing Tailwind patterns)
- [ ] Add model tests
- [ ] Add controller tests
- [ ] Add system tests for user-facing features
- [ ] Update API documentation if applicable
- [ ] Run full test suite
- [ ] Run security scans

### Adding a New Notification Channel

Checkend uses the [Noticed gem](https://github.com/excid3/noticed) for notifications. To add a new channel:

1. Add delivery method to `app/notifiers/new_problem_notifier.rb`
2. Add configuration fields to the `App` model
3. Add UI for configuration in app settings
4. Add tests for the new delivery method

### Adding a New SDK

See [ROADMAP.md](ROADMAP.md) for SDK guidelines. Each SDK should:

1. Live in its own repository (`checkend-{language}`)
2. Follow the language's conventions
3. Support the full ingestion API
4. Include framework integrations where applicable
5. Have comprehensive documentation

---

## Questions?

- Open a [GitHub Discussion](https://github.com/furvur/checkend/discussions) for questions
- Check existing issues and PRs for similar topics
- Review [ROADMAP.md](ROADMAP.md) for project direction

Thank you for contributing to Checkend!
