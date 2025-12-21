# TODO - Phase 1: Foundation

## Overview
Complete the foundation phase of Checkend: user authentication and core domain models.

---

## 1. User Authentication

Rails 8 includes a built-in authentication generator that provides sessions, password resets, and secure password handling.

### Tasks
- [x] Run `bin/rails generate authentication`
- [x] Review and customize generated code
- [x] Run migrations
- [x] Add basic navigation with login/logout links
- [x] Test authentication flow

### Notes
- Generator creates: User model, Session model, controllers, views, mailer
- Uses `has_secure_password` (bcrypt)
- Includes password reset functionality via email
- Added email validation (presence, uniqueness, format)
- Fixed minitest 6.0 compatibility issue (pinned to ~> 5.25)

---

## 2. Core Models

### 2.1 App Model
Represents a client application that sends errors to Checkend.

**Fields:**
- `id` - Primary key (bigint)
- `name` - Application name (string, required)
- `api_key` - Unique API key for authentication (string, indexed, required)
- `environment` - Default environment filter (string, optional)
- `user_id` - Owner of the app (foreign key)
- `timestamps`

**Tasks:**
- [ ] Generate App model with migration
- [ ] Add `has_secure_token :api_key` for automatic key generation
- [ ] Add validations (name presence, api_key uniqueness)
- [ ] Add `belongs_to :user` association
- [ ] Write model tests

---

### 2.2 Problem Model
Groups similar errors together via fingerprinting. A "problem" is a unique error type.

**Fields:**
- `id` - Primary key (bigint)
- `app_id` - Parent application (foreign key, indexed)
- `fingerprint` - Unique hash for grouping (string, indexed)
- `error_class` - Exception class name (string)
- `message` - Error message (text)
- `first_seen_at` - When first occurrence happened (datetime)
- `last_seen_at` - When most recent occurrence happened (datetime)
- `notices_count` - Counter cache for notices (integer, default: 0)
- `resolved` - Whether the problem is resolved (boolean, default: false)
- `resolved_at` - When it was resolved (datetime, nullable)
- `timestamps`

**Tasks:**
- [ ] Generate Problem model with migration
- [ ] Add `belongs_to :app` association
- [ ] Add `has_many :notices` association
- [ ] Add fingerprint uniqueness validation scoped to app
- [ ] Add scopes: `resolved`, `unresolved`, `recent`
- [ ] Write model tests

---

### 2.3 Backtrace Model
Stores deduplicated stack traces. Multiple notices can share the same backtrace.

**Fields:**
- `id` - Primary key (bigint)
- `fingerprint` - Hash of the backtrace content (string, indexed, unique)
- `lines` - Parsed backtrace lines as JSON (jsonb)
- `timestamps`

**Backtrace Line Structure (JSON):**
```json
{
  "file": "app/models/user.rb",
  "line": 42,
  "method": "validate_email",
  "context": ["line 40 content", "line 41 content", ">> line 42 content", "line 43 content"]
}
```

**Tasks:**
- [ ] Generate Backtrace model with migration
- [ ] Add `has_many :notices` association
- [ ] Add class method for fingerprint generation from raw backtrace
- [ ] Add class method `find_or_create_by_content(raw_backtrace)`
- [ ] Write model tests

---

### 2.4 Notice Model
Represents a single error occurrence sent from a client application.

**Fields:**
- `id` - Primary key (bigint)
- `problem_id` - Parent problem (foreign key, indexed)
- `backtrace_id` - Associated backtrace (foreign key, indexed)
- `error_class` - Exception class name (string)
- `message` - Error message (text)
- `environment` - Rails env or similar (string, indexed)
- `hostname` - Server hostname (string)
- `context` - Custom context data (jsonb)
- `request` - Request information (jsonb)
- `user_info` - User information (jsonb)
- `notifier` - Client library info (jsonb)
- `occurred_at` - When the error occurred on client (datetime)
- `timestamps`

**Request JSON Structure:**
```json
{
  "url": "https://example.com/users/123",
  "method": "POST",
  "params": {},
  "headers": {},
  "ip_address": "192.168.1.1"
}
```

**User Info JSON Structure:**
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "name": "John Doe"
}
```

**Tasks:**
- [ ] Generate Notice model with migration
- [ ] Add `belongs_to :problem, counter_cache: true` association
- [ ] Add `belongs_to :backtrace` association
- [ ] Add `has_one :app, through: :problem` for convenience
- [ ] Add scopes: `recent`, `by_environment`
- [ ] Write model tests

---

## 3. Database Indexes Strategy

Ensure proper indexes for common query patterns:

- [ ] `apps.api_key` - Unique index for API authentication
- [ ] `apps.user_id` - For user's apps listing
- [ ] `problems.app_id` - For app's problems listing
- [ ] `problems.fingerprint, app_id` - Unique composite for deduplication
- [ ] `problems.resolved` - For filtering resolved/unresolved
- [ ] `problems.last_seen_at` - For sorting by recency
- [ ] `notices.problem_id` - For problem's notices listing
- [ ] `notices.occurred_at` - For time-based queries
- [ ] `notices.environment` - For environment filtering
- [ ] `backtraces.fingerprint` - Unique index for deduplication

---

## 4. Model Relationships Summary

```
User
  └── has_many :apps

App
  ├── belongs_to :user
  └── has_many :problems
        └── has_many :notices (through: :problems)

Problem
  ├── belongs_to :app
  └── has_many :notices

Notice
  ├── belongs_to :problem (counter_cache: true)
  └── belongs_to :backtrace

Backtrace
  └── has_many :notices
```

---

## 5. Fingerprinting Strategy

Fingerprints are used to group similar errors into problems.

**Default Fingerprint Generation:**
1. Take error class name
2. Take first line of backtrace (file + line number)
3. Generate SHA256 hash of combined string

**Example:**
```ruby
def generate_fingerprint(error_class, backtrace_lines)
  key = "#{error_class}:#{backtrace_lines.first}"
  Digest::SHA256.hexdigest(key)
end
```

**Custom Fingerprint:**
- API accepts optional `fingerprint` param
- If provided, use it instead of auto-generated one
- Allows clients to control grouping behavior

---

## Implementation Order

1. **Authentication** - Required first since App belongs_to User
2. **App model** - Foundation for everything else
3. **Backtrace model** - Independent, no foreign keys to other domain models
4. **Problem model** - Depends on App
5. **Notice model** - Depends on Problem and Backtrace
6. **Verify relationships** - Test all associations work correctly

---

## Testing Checklist

- [ ] User authentication flow works
- [ ] App can be created with auto-generated API key
- [ ] Problem fingerprint uniqueness within app
- [ ] Backtrace deduplication works correctly
- [ ] Notice creates/increments problem counter cache
- [ ] All model validations pass
- [ ] All associations work correctly

---

## Current Progress

**Status:** Authentication Complete

**Completed:**
- User authentication with login/logout
- Session management with rate limiting
- Password reset via email
- Dashboard with navigation
- User model validation tests (5 tests passing)

**Next Step:** Create App model
