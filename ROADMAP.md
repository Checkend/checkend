# Checkend Roadmap

## Version 1.0 - Core Error Monitoring

### Phase 1: Foundation ✅
- [x] Rails 8 project setup with PostgreSQL, Tailwind, Importmap
- [x] User authentication (Rails 8 built-in)
- [x] Core models: App, Problem, Notice, Backtrace

### Phase 2: Error Ingestion API ✅
- [x] POST /ingest/v1/errors endpoint
- [x] Ingestion key authentication
- [x] Error processing service
- [x] Fingerprinting for error grouping
- [x] Backtrace deduplication

### Phase 3: Web Dashboard ✅
- [x] Apps management (CRUD)
- [x] Problems list with filtering/search
- [x] Notice detail view with backtrace
- [x] Resolve/unresolve errors
- [x] Occurrence chart (Chartkick)

### Phase 4: Notifications ✅
- [x] Email notifications on new errors (noticed gem)
- [x] Notification on error re-occurrence
- [x] Per-app notification settings
- [x] Database storage for future notification center
- [x] Auto-unresolve resolved problems on new errors

---

## Future Versions

### Version 1.1 - Enhanced Filtering ✅
- [x] Tags support (Tag/ProblemTag models, inline editor, filtering, bulk actions)
- [x] Search improvements (date range filtering, min notices filter, advanced filters UI)
- [x] Notifier tracking (SDK name, version, language info for v2.0 preparation)
- [~] Custom fingerprint override (skipped - client-side already supported via API)

### Version 1.2 - Integrations ✅
- [x] Slack notifications (Block Kit formatting, encrypted webhook URLs)
- [x] Discord notifications (webhook integration)
- [x] Webhook notifications (generic webhook support)
- [x] Issue tracker integration (GitHub Issues with automatic creation)
- [x] SMTP configuration management (database-backed, encrypted passwords)

### Version 2.0 - Core Client SDKs
Each SDK will be maintained in a separate repository for idiomatic packaging and release cycles.

**Ruby** (`checkend-ruby`)
- [ ] Core error reporting library
- [ ] Rails middleware integration
- [ ] Rack integration
- [ ] Sidekiq/Solid Queue hooks
- [ ] Breadcrumbs support

**JavaScript/TypeScript**
- [ ] Browser SDK (`@checkend/browser`) - unhandled errors, rejections, source maps
- [ ] Node.js SDK (`@checkend/node`) - Express/Koa/Fastify middleware

### Version 2.1 - Backend SDKs

**Python** (`checkend-python`)
- [ ] Core error reporting library
- [ ] Django middleware
- [ ] Flask integration
- [ ] FastAPI/ASGI support

**Go** (`checkend-go`)
- [ ] Core error reporting library
- [ ] net/http middleware
- [ ] Gin/Echo/Fiber adapters

### Version 2.2 - Extended SDKs

**PHP** (`checkend/checkend-php`)
- [ ] Core error reporting library
- [ ] Laravel integration
- [ ] PSR-15 middleware

**Elixir** (`checkend` on Hex)
- [ ] Core error reporting library
- [ ] Plug middleware
- [ ] Phoenix integration

**Java** (`com.checkend:checkend-java`)
- [ ] Core error reporting library
- [ ] Spring Boot starter
- [ ] Servlet filter

**.NET** (`Checkend.NET` on NuGet)
- [ ] Core error reporting library
- [ ] ASP.NET Core middleware

### Version 2.3 - Common SDK Features
All SDKs will support:
- [ ] Automatic exception capture
- [ ] Manual error reporting API
- [ ] Breadcrumbs (user actions leading to error)
- [ ] Context enrichment (user info, tags, custom data)
- [ ] Environment detection (production/staging/dev)
- [ ] Configurable filtering (ignore certain errors)
- [ ] Async/batched sending
- [ ] Offline queueing with retry

### Version 3.0 - Advanced Features
- [x] Team/organization support (Team, TeamMember, TeamAssignment models, team-based authorization)
- [x] User roles and permissions (team ownership, member management, invitation system)
- [ ] Error trends and analytics
- [ ] Airbrake API compatibility layer
