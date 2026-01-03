> The purpose of this document is to allow us to quickly understand what feature set this application has

# Checkend Features

A comprehensive self-hosted error monitoring application built with Rails 8. Checkend collects, groups, and manages errors from your applications with a modern web dashboard and flexible notification system.

## Table of Contents

- [Core Error Monitoring](#core-error-monitoring)
- [Error Ingestion API](#error-ingestion-api)
- [Web Dashboard](#web-dashboard)
- [Team & Access Management](#team--access-management)
- [Notification System](#notification-system)
- [API Access](#api-access)
- [User Account Features](#user-account-features)
- [Administration](#administration)
- [Technical Features](#technical-features)

---

## Core Error Monitoring

### Error Grouping via Fingerprinting

Errors are automatically grouped into **Problems** using intelligent fingerprinting:

- **Automatic fingerprinting**: Groups errors by error class + first line of backtrace location
- **Custom fingerprint support**: Override automatic grouping by providing your own fingerprint via the API
- **Deduplication**: Similar errors are grouped together, reducing noise and making triage easier

### Problems & Notices

The two-tier error model separates unique error types from individual occurrences:

| Concept | Description |
|---------|-------------|
| **Problem** | A unique error type identified by fingerprint, tracks aggregate statistics |
| **Notice** | An individual error occurrence with full context and backtrace |

**Problem Tracking:**
- Status tracking: `unresolved` or `resolved`
- Notice count aggregation
- First seen / Last seen timestamps
- Auto-unresolve when resolved problems recur
- Resolution timestamps

**Notice Data Captured:**
- Error class and message
- Full backtrace with file, line, and method information
- Request details (URL, HTTP method, headers, parameters)
- User information (ID, email, custom fields)
- Custom context data
- Notifier/SDK metadata (name, version, language, language version)
- Precise occurrence timestamp

### Backtrace Management

Backtraces are stored efficiently with deduplication:

- **Content-addressable storage**: Backtraces are fingerprinted by content
- **Shared across notices**: Identical backtraces are stored once and referenced by multiple notices
- **Ruby backtrace parsing**: Parses standard Ruby backtrace format (`file:line:in 'method'`)
- **Fallback support**: Non-standard formats are preserved with best-effort parsing

---

## Error Ingestion API

### REST Endpoint

**`POST /ingest/v1/errors`**

A single endpoint for receiving errors from any client application.

### Authentication

Authentication uses ingestion keys:
- Per-app unique ingestion key via `Checkend-Ingestion-Key` header
- Keys are automatically generated and can be regenerated from the dashboard
- Secure token storage using Rails `has_secure_token`

### Request Payload

```json
{
  "error": {
    "class": "NoMethodError",
    "message": "undefined method 'foo' for nil:NilClass",
    "backtrace": ["app/models/user.rb:42:in `validate'", "..."],
    "fingerprint": "optional-custom-fingerprint",
    "occurred_at": "2025-01-01T12:00:00Z"
  },
  "context": {
    "custom_key": "custom_value"
  },
  "request": {
    "method": "POST",
    "url": "https://example.com/api/endpoint",
    "params": {"key": "value"},
    "headers": {"Accept": "application/json"}
  },
  "user": {
    "id": 123,
    "email": "user@example.com"
  },
  "notifier": {
    "name": "checkend-ruby",
    "version": "1.0.0",
    "language": "ruby",
    "language_version": "3.2.0"
  }
}
```

### Response

```json
{
  "id": 12345,        // Notice ID
  "problem_id": 678   // Problem ID (new or existing)
}
```

---

## Web Dashboard

### Overview Dashboard

The home page provides at-a-glance monitoring:

- **Stats Grid**: Apps count, unresolved problems, problems today, notices today
- **Quick App Access**: Cards for each app showing unresolved problem count
- **Recent Problems**: Last 10 problems across all accessible apps with links

### Apps Management

Full CRUD operations for monitored applications:

- Create apps with name and environment (e.g., production, staging)
- Unique slug-based URLs for clean navigation
- Environment indicators displayed throughout the interface
- Setup wizard for new apps with team assignment
- Ingestion key viewing and regeneration
- Team assignment and removal

### Problems List

Rich filtering and search capabilities:

**Filters:**
- Status filter: All / Unresolved / Resolved
- Text search: Search by error class or message (case-insensitive)
- Tag filter: Click tags to filter problems
- **Advanced Filters** (collapsible panel):
  - Date range: Last seen from/to date pickers
  - Quick date buttons: Today, Last 7 days, Last 30 days
  - Minimum notices filter

**Sorting:**
- Most Recent (default)
- Oldest First
- Most Notices

**Pagination:**
- Pagy-powered pagination with Tailwind styling
- Page count and total results display

### Bulk Operations

Select multiple problems and perform actions in batch:

- **Bulk Resolve**: Mark multiple problems as resolved
- **Bulk Unresolve**: Mark multiple problems as unresolved
- **Bulk Add Tag**: Add a tag to selected problems (with autocomplete)
- **Bulk Remove Tag**: Remove a tag from selected problems
- Select All checkbox for quick selection

### Problem Detail View

Comprehensive error analysis interface:

- **Header**: Error class, message, status indicator, resolve/unresolve button
- **Tags Section**: View, add, and remove tags with autocomplete
- **Stats Cards**: Status, total notices, first seen, last seen
- **Occurrence Chart**: 30-day bar chart of error occurrences (via Groupdate gem)
- **Recent Notices List**: Last 10 notices with request method, URL, user info, and notifier badges

### Notice Detail View

Full error context for debugging:

- **Header**: Error class, message, occurrence timestamp
- **Notice Navigation**: Navigate between newer/older notices within the problem
- **Collapsible Sections**:
  - **Backtrace**: Syntax-highlighted with line numbers, app files highlighted
  - **Request**: HTTP method, URL, expandable params and headers
  - **User Info**: All captured user attributes
  - **Notifier**: SDK name, version, language details
  - **Context**: Custom context key-value pairs
  - **Raw JSON**: Complete notice data for debugging

### Dark Mode

Full dark mode support:

- Toggle button in sidebar/header
- Respects system preference (`prefers-color-scheme`)
- Persisted in localStorage
- Consistent styling across all views

### Responsive Design

Tailwind CSS-based responsive layouts:
- Mobile-friendly sidebar navigation
- Grid layouts adapt to screen size
- Collapsible panels for compact mobile views

---

## Team & Access Management

### Team Structure

Multi-tenant team-based access control:

- **Teams**: Named groups of users with slugs for clean URLs
- **Team Owner**: User who created the team, can delete the team
- **Team Members**: Users belonging to a team with role-based permissions

### Roles

Two-tier role system:

| Role | Permissions |
|------|-------------|
| **Admin** | Manage team members, send invitations, assign apps, all member permissions |
| **Member** | View apps assigned to team, view/manage problems and notices |

### App-Team Assignment

Flexible app access through team assignments:

- Apps can be assigned to multiple teams
- Users access apps through their team memberships
- Team admins can assign/remove apps from their teams
- Newly created apps can be immediately assigned during setup wizard

### Team Invitations

Email-based invitation workflow:

- Admins send invitations by email address
- Secure token-based invitation links (64-character hex token)
- 7-day expiration for security
- Email validation before sending
- Tracks invitation status: pending, accepted, expired
- Invitation acceptance requires account with matching email

---

## Notification System

### Multi-Channel Notifications

Powered by the [Noticed](https://github.com/excid3/noticed) gem with custom delivery methods:

| Channel | Configuration |
|---------|---------------|
| **Email** | Via configured SMTP (requires SMTP setup) |
| **Slack** | Webhook URL per app |
| **Discord** | Webhook URL per app |
| **Custom Webhook** | Generic webhook URL per app |
| **GitHub Issues** | Creates issues in configured repository |

### Notification Events

Two notification triggers per app:

1. **New Problem**: When a new error type is first seen
2. **Problem Reoccurred**: When a resolved problem gets a new notice

### App-Level Configuration

Per-app notification settings:

- `notify_on_new_problem`: Enable/disable new problem notifications
- `notify_on_reoccurrence`: Enable/disable reoccurrence notifications
- Slack webhook URL (encrypted)
- Discord webhook URL (encrypted)
- Custom webhook URL (encrypted)
- GitHub integration settings

### User Notification Preferences

Per-user, per-app notification overrides:

- Users can customize which apps they receive notifications for
- Override app defaults for new problems and reoccurrences
- Accessible from app settings page

### Notification Payloads

**Slack**: Rich Block Kit format with app info, error details, backtrace preview, action button

**Discord**: Rich embed with color-coded severity, error details, timestamps, and link

**Webhook**: Clean JSON payload with event type, problem details, app info, notice context

**GitHub Issues**: Creates formatted issues with error details, backtrace, and labels (`bug`, `error-report`, `reoccurred`)

### GitHub Integration

Automatic issue creation for errors:

- Configure repository (owner/repo format)
- GitHub personal access token (encrypted storage)
- Toggle enable/disable per app
- Issues labeled with `bug`, `error-report`
- Reoccurrences add `reoccurred` label

---

## API Access

### Application API

Full REST API for programmatic access:

**Base URL**: `/api/v1/`

**Authentication**: API key via `Checkend-API-Key` header

### Available Endpoints

| Resource | Endpoints |
|----------|-----------|
| **Health** | `GET /health` |
| **Apps** | `GET /apps`, `GET /apps/:id`, `POST /apps`, `PATCH /apps/:id`, `DELETE /apps/:id` |
| **Problems** | `GET /apps/:app_id/problems`, `GET /apps/:app_id/problems/:id`, `POST /apps/:app_id/problems/:id/resolve`, `POST /apps/:app_id/problems/:id/unresolve`, `POST /apps/:app_id/problems/bulk_resolve` |
| **Notices** | `GET /apps/:app_id/problems/:problem_id/notices`, `GET /apps/:app_id/problems/:problem_id/notices/:id` |
| **Tags** | `GET /apps/:app_id/problems/:problem_id/tags`, `POST /apps/:app_id/problems/:problem_id/tags`, `DELETE /apps/:app_id/problems/:problem_id/tags/:id` |
| **Teams** | `GET /teams`, `GET /teams/:id`, `POST /teams`, `PATCH /teams/:id`, `DELETE /teams/:id` |
| **Team Members** | `GET /teams/:team_id/members`, `POST /teams/:team_id/members`, `PATCH /teams/:team_id/members/:id`, `DELETE /teams/:team_id/members/:id` |
| **Users** | `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` |

### API Key Permissions

Fine-grained permission system:

| Resource | Permissions |
|----------|-------------|
| Apps | `apps:read`, `apps:write` |
| Problems | `problems:read`, `problems:write` |
| Notices | `notices:read` |
| Tags | `tags:read`, `tags:write` |
| Teams | `teams:read`, `teams:write` |
| Users | `users:read`, `users:write` |

### API Key Management

- Create keys with custom names and selected permissions
- View key usage (last used timestamp)
- Revoke keys (soft delete, preserves audit trail)
- Delete keys permanently
- Site admin only access

---

## User Account Features

### Authentication

Session-based authentication with security features:

- Secure password hashing with bcrypt (`has_secure_password`)
- Cookie-based sessions with httponly flag
- Session tracking with IP address and user agent
- Return-to URL after login

### Profile Settings

User account management at `/settings/profile`:

- View email address
- View last login timestamp
- Access password change
- View and manage active sessions

### Password Security

Enhanced password management:

- **Password History**: Prevents reuse of last 5 passwords
- **Current Password Verification**: Required to change password
- **Real-time Verification**: AJAX endpoint for verifying current password
- **bcrypt Hashing**: Secure password storage

### Session Management

Multi-session support with security controls:

- View all active sessions (device, IP, last active)
- Revoke individual sessions
- Revoke all other sessions at once
- Cannot revoke current session (must sign out)

---

## Administration

### Site Admins

Special administrative users:

- `site_admin` flag on user accounts
- Created during initial setup wizard
- Access to system-wide settings

### Admin-Only Features

| Feature | Description |
|---------|-------------|
| **API Keys** | Create, view, revoke API keys |
| **SMTP Configuration** | Configure email delivery settings |
| **User Management** | View and manage all users (via API) |

### SMTP Configuration

Email delivery configuration:

- SMTP server address and port
- Authentication method (plain, login, cram_md5)
- Username and password (encrypted storage)
- Domain configuration
- STARTTLS auto-enable toggle
- **Test Connection**: Send test email to verify configuration
- Enable/disable toggle for email notifications

### Setup Wizard

First-run configuration wizard:

1. **Create Admin Account**: Email and password for site admin
2. **Create Team**: First team for organizing access
3. **Create App**: First monitored application
4. **Complete**: Shows ingestion key and next steps

The wizard only appears when no users exist and locks out after first completion.

---

## Technical Features

### Database Architecture

PostgreSQL-based with separate databases for different concerns:

| Database | Purpose |
|----------|---------|
| Primary | Application data (apps, problems, notices, users, teams) |
| Cache | Solid Cache storage |
| Queue | Solid Queue background jobs |
| Cable | Action Cable WebSocket messages |

### Background Jobs

Solid Queue for reliable job processing:

- Notification delivery (email, Slack, Discord, webhooks, GitHub)
- Database-backed queue (no Redis required)
- Run via `bin/jobs` command

### Caching

Solid Cache for performance:

- Database-backed caching
- No Redis required
- Configurable via Rails credentials

### Real-time Updates

Solid Cable for WebSocket connections:

- Database-backed ActionCable
- No Redis required
- Future support for live dashboard updates

### Security Features

| Feature | Implementation |
|---------|----------------|
| **Encrypted Storage** | Webhook URLs, GitHub tokens, SMTP password via Active Record Encryption |
| **Secure Tokens** | Ingestion keys, API keys, invitation tokens via `has_secure_token` |
| **Session Security** | httponly cookies, same-site lax policy |
| **Password Security** | bcrypt hashing, password history checking |
| **CSRF Protection** | Rails authenticity tokens |

### Deployment

Kamal-ready deployment configuration:

- Docker containerization
- SSL/TLS via Let's Encrypt
- PostgreSQL accessory configuration
- Environment-based credentials
- Health check endpoint at `/up`

### Frontend Stack

Modern Rails frontend without Node.js:

| Technology | Purpose |
|------------|---------|
| **Hotwire/Turbo** | SPA-like navigation, form submissions |
| **Stimulus** | Lightweight JavaScript controllers |
| **Importmaps** | ES module loading without bundler |
| **Tailwind CSS** | Utility-first styling via tailwindcss-rails |
| **Alpine.js** | Inline interactivity (collapsibles, dropdowns) |

### Stimulus Controllers

| Controller | Purpose |
|------------|---------|
| `theme_controller` | Dark/light mode toggle with persistence |
| `tags_controller` | Tag autocomplete with add/remove |
| `bulk_select_controller` | Checkbox selection for bulk actions |
| `collapsible_controller` | Expandable/collapsible sections |
| `dropdown_controller` | Dropdown menu interactions |
| `flash_message_controller` | Auto-dismiss flash messages |
| `password_form_controller` | Password form validation |

### Charts & Visualization

Occurrence charts powered by Groupdate gem:

- 30-day occurrence history per problem
- Daily aggregation of notices
- Zero-fill for days without occurrences

### Pagination

Pagy gem with Tailwind theme:

- Efficient pagination for large datasets
- Page info with counts
- Customizable per-page limits
- Overflow error handling

---

## Summary

Checkend provides a complete, self-hosted error monitoring solution with:

- **Simple Integration**: Single REST endpoint with flexible payload
- **Smart Grouping**: Automatic fingerprinting with custom override support
- **Rich Context**: Full backtrace, request, user, and custom context capture
- **Team Collaboration**: Multi-team access control with role-based permissions
- **Flexible Notifications**: Email, Slack, Discord, webhooks, and GitHub integration
- **Modern Dashboard**: Dark mode, responsive design, bulk operations
- **API Access**: Full REST API with fine-grained permissions
- **Security**: Encrypted storage, secure tokens, password history
- **Self-Hosted**: Deploy anywhere with Kamal, no external services required
