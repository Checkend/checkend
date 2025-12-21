# Checkend Roadmap

## Version 1.0 - Core Error Monitoring

### Phase 1: Foundation
- [ ] Rails 8 project setup with PostgreSQL, Tailwind, Importmap
- [ ] User authentication (Rails 8 built-in)
- [ ] Core models: App, Problem, Notice, Backtrace

### Phase 2: Error Ingestion API
- [ ] POST /api/v1/errors endpoint
- [ ] API key authentication
- [ ] Error processing service
- [ ] Fingerprinting for error grouping
- [ ] Backtrace deduplication

### Phase 3: Web Dashboard
- [ ] Apps management (CRUD)
- [ ] Problems list with filtering/search
- [ ] Notice detail view with backtrace
- [ ] Resolve/unresolve errors

### Phase 4: Notifications
- [ ] Email notifications on new errors
- [ ] Notification on error re-occurrence
- [ ] Solid Queue for background jobs

---

## Future Versions

### Version 1.1 - Enhanced Filtering
- [ ] Tags support and filtering
- [ ] Custom fingerprint override
- [ ] Search improvements

### Version 1.2 - Integrations
- [ ] Slack notifications
- [ ] Webhook notifications
- [ ] Issue tracker integration (GitHub)

### Version 2.0 - Client SDKs
- [ ] checkend-ruby gem
- [ ] Breadcrumbs support
- [ ] Source map support (JavaScript)

### Version 2.1 - Advanced Features
- [ ] Team/organization support
- [ ] User roles and permissions
- [ ] Error trends and analytics
- [ ] Airbrake API compatibility layer
