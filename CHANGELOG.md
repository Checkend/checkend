# Changelog

All notable changes to Checkend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Profile & Settings
- Profile settings page with card-based layout at `/settings/profile`
- Admin badge display for site administrators
- Avatar with user initials in sidebar navigation

#### Password Security
- Password history tracking (prevents reuse of last 5 passwords)
- Real-time current password verification with debounce
- Client-side validation for new password (minimum 8 characters)
- Password confirmation matching validation
- Submit button disabled until all validations pass

#### Session Management
- View all active sessions with device and browser detection
- Revoke individual sessions
- "Revoke All Other" to terminate all sessions except current
- Session details including IP address and last activity

### Changed

- Password change form now opens as slide-over drawer
- Updated checkboxes across app to use design system pattern with SVG checkmark

## [1.0.0] - 2024-12-28

### Added

#### Error Ingestion
- REST API endpoint (`POST /ingest/v1/errors`) for receiving errors from client applications
- Authentication via `Checkend-Ingestion-Key` header
- Error class, message, and backtrace capture
- Context, request, and user info capture
- Custom fingerprint support for error grouping
- Notifier metadata (SDK name, version, language)
- Occurred timestamp support

#### Error Grouping & Management
- Automatic fingerprinting based on error class and first backtrace line
- Problem model for grouped errors
- Notice model for individual occurrences
- Backtrace deduplication to save storage
- Resolve/unresolve problems
- Auto-unresolve on error reoccurrence
- Bulk operations (resolve, unresolve, add/remove tags)

#### Web Dashboard
- Apps CRUD with slug-based URLs
- Problems list with pagination (Pagy)
- Problem detail view with occurrence chart
- Notice detail view with full context
- Status filtering (unresolved/resolved)
- Date range filtering (last seen)
- Minimum notices filter
- Tag-based filtering
- Setup wizard for new apps
- Sticky breadcrumb navigation
- Slide-over modals for forms
- Dark mode support

#### Tagging System
- Tag model with uniqueness validation
- Problem-tag many-to-many relationship
- Add/remove tags via UI with autocomplete
- Bulk tag operations
- Filter problems by tags

#### Notifications
- Email notifications for new problems and reoccurrences
- Slack webhook integration
- Discord webhook integration
- Generic webhook integration
- GitHub issue creation
- Per-app notification settings
- Per-user notification preferences

#### Teams & Access Control
- Team model with owner
- Team members with roles (admin, member)
- Team invitations via email
- Team-app assignments
- Access control (users see only their team's apps)
- Site admin role for system-wide management

#### Application API (v1)
- API key authentication with scoped permissions
- Health endpoint
- Apps CRUD
- Problems list/show with resolve/unresolve
- Bulk problem operations
- Notices list/show
- Tags management
- Teams and team members CRUD
- Users management (admin only)

#### Admin Features
- Site admin users
- User management (CRUD)
- SMTP configuration
- Session management

#### Client SDKs
- Ruby SDK ([checkend-ruby](https://github.com/furvur/checkend-ruby))
- JavaScript Browser SDK ([checkend-browser](https://github.com/furvur/checkend-browser))
- JavaScript Node.js SDK ([checkend-node](https://github.com/furvur/checkend-node))
- Python SDK ([checkend-python](https://github.com/furvur/checkend-python))
- Go SDK ([checkend-go](https://github.com/furvur/checkend-go))
- PHP SDK ([checkend-php](https://github.com/furvur/checkend-php))
- Elixir SDK ([checkend-elixir](https://github.com/furvur/checkend-elixir))
- Java SDK ([checkend-java](https://github.com/furvur/checkend-java))
- .NET SDK ([checkend-dotnet](https://github.com/furvur/checkend-dotnet))

#### Infrastructure
- PostgreSQL with separate databases (main, cache, queue, cable)
- Solid Queue for background jobs
- Solid Cache for caching
- Solid Cable for WebSockets
- Docker and Docker Compose deployment
- Pre-commit hook for secret detection
- CI/CD with GitHub Actions

#### Documentation
- Marketing site with Astro
- SDK documentation for all client libraries
- API documentation
- Self-hosting guide with Docker

[Unreleased]: https://github.com/furvur/checkend/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/furvur/checkend/releases/tag/v1.0.0
