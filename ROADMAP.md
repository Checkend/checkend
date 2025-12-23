# Checkend Roadmap

## Version 1.0 - Core Error Monitoring

### Phase 1: Foundation ✅
- [x] Rails 8 project setup with PostgreSQL, Tailwind, Importmap
- [x] User authentication (Rails 8 built-in)
- [x] Core models: App, Problem, Notice, Backtrace

### Phase 2: Error Ingestion API ✅
- [x] POST /api/v1/errors endpoint
- [x] API key authentication
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
