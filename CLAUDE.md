# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Checkend is a self-hosted error monitoring application built with Rails 8. It provides a REST API to receive errors from client applications, groups similar errors together via fingerprinting, and offers a web dashboard for viewing and resolving errors.

## Common Commands

```bash
# Development server (runs Rails + Tailwind watcher)
bin/dev

# Run all tests
bin/rails test

# Run a single test file
bin/rails test test/models/user_test.rb

# Run a specific test by line number
bin/rails test test/models/user_test.rb:42

# Run system tests
bin/rails test:system

# Linting
bin/rubocop
bin/rubocop -a          # auto-fix safe violations
bin/rubocop -A          # auto-fix all violations (including unsafe)
bin/rubocop -f github   # CI format

# Security scanning
bin/brakeman --no-pager
bin/bundler-audit
bin/importmap audit

# Database
bin/rails db:setup      # create, migrate, seed
bin/rails db:migrate
bin/rails db:test:prepare

# Background jobs (Solid Queue)
bin/jobs
```

## Architecture

### Tech Stack
- Rails 8.1 with Propshaft asset pipeline
- PostgreSQL (primary database)
- Tailwind CSS via tailwindcss-rails
- Hotwire (Turbo + Stimulus) for frontend interactivity
- Importmap for JavaScript ESM modules (no Node.js bundler)
- Solid Queue for background jobs (database-backed)
- Solid Cache for caching (database-backed)
- Solid Cable for WebSockets (database-backed)
- Kamal for deployment

### Database Structure
Production uses separate PostgreSQL databases for different concerns:
- Primary: `checkend_production` - main application data
- Cache: `checkend_production_cache` - Solid Cache storage
- Queue: `checkend_production_queue` - Solid Queue jobs
- Cable: `checkend_production_cable` - Action Cable messages

### Core Domain Models (Planned)
Per ROADMAP.md, the core models will be:
- **App** - Client applications sending errors
- **Problem** - Grouped errors (via fingerprinting)
- **Notice** - Individual error occurrences
- **Backtrace** - Deduplicated stack traces

### API Design
The primary API endpoint is `POST /ingest/v1/errors`:
- Authentication via `Checkend-Ingestion-Key` header
- Accepts error class, message, backtrace, context, request info, and user info
- Supports custom fingerprints for error grouping

## Code Style

Uses rubocop-rails-omakase (Rails default style guide). Run `bin/rubocop` before committing.
