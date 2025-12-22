# TODO - Phase 2: Error Ingestion API

## Overview
Build the REST API endpoint that receives error reports from client applications, processes them, and stores them in the database.

---

## 1. API Endpoint

### POST /api/v1/errors

Receives error reports from client applications.

**Request Headers:**
- `X-API-Key: <app_api_key>` - Required for authentication
- `Content-Type: application/json`

**Request Body:**
```json
{
  "error": {
    "class": "NoMethodError",
    "message": "undefined method 'foo' for nil:NilClass",
    "backtrace": [
      "app/models/user.rb:42:in `validate_email'",
      "app/controllers/users_controller.rb:15:in `create'"
    ],
    "fingerprint": "optional-custom-fingerprint"
  },
  "context": {
    "environment": "production",
    "hostname": "web-01",
    "custom_key": "custom_value"
  },
  "request": {
    "url": "https://example.com/users",
    "method": "POST",
    "params": { "user": { "email": "..." } },
    "headers": { "User-Agent": "..." },
    "ip_address": "192.168.1.1"
  },
  "user": {
    "id": "123",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "occurred_at": "2025-01-15T10:30:00Z"
}
```

**Response (201 Created):**
```json
{
  "id": "notice_uuid",
  "problem_id": "problem_uuid",
  "url": "https://checkend.example.com/problems/123"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid or missing API key
- `422 Unprocessable Entity` - Invalid payload

---

## 2. Tasks

### 2.1 API Infrastructure
- [x] Create `Api::V1::BaseController` with JSON error handling
- [x] Implement API key authentication via `X-API-Key` header
- [ ] Add request rate limiting (per API key)
- [x] Write controller tests for auth scenarios

### 2.2 Errors Controller
- [x] Create `Api::V1::ErrorsController` with `create` action
- [x] Parse and validate incoming error payload
- [x] Return appropriate success/error responses
- [x] Write controller tests for valid/invalid payloads (16 tests)

### 2.3 Error Processing Service
- [x] Create `ErrorIngestionService` to orchestrate processing
- [x] Parse raw backtrace strings into structured format
- [x] Generate fingerprint (or use custom if provided)
- [x] Find or create Problem by fingerprint
- [x] Find or create Backtrace by content
- [x] Create Notice with all data
- [x] Update Problem timestamps and counter
- [x] Write service tests (14 tests)

### 2.4 Backtrace Parser
- [x] Create `BacktraceParser` service
- [x] Parse Ruby backtrace format: `file:line:in 'method'`
- [x] Extract file, line number, method name
- [x] Handle edge cases (non-standard formats)
- [x] Write parser tests (9 tests)

### 2.5 Fingerprint Generator
- [x] Uses `Problem.generate_fingerprint` (already exists from Phase 1)
- [x] Default: SHA256 of error_class + first backtrace line
- [x] Support custom fingerprint override

---

## 3. Routes

```ruby
namespace :api do
  namespace :v1 do
    resources :errors, only: [:create]
  end
end
```

---

## 4. Testing Plan

### Controller Tests
- [x] Valid error submission returns 201
- [x] Missing API key returns 401
- [x] Invalid API key returns 401
- [x] Missing required fields returns 422
- [ ] Rate limiting works correctly

### Service Tests
- [x] New problem created for new fingerprint
- [x] Existing problem found for matching fingerprint
- [x] Backtrace deduplicated correctly
- [x] Notice counter incremented
- [x] Problem timestamps updated
- [x] Custom fingerprint respected

### Integration Tests
- [x] Full flow: API request → Problem + Notice created
- [x] Duplicate error groups correctly
- [x] Different errors create separate problems

---

## 5. Current Progress

**Status:** Phase 2 Complete ✓

**Completed:**
- `Api::V1::BaseController` with API key authentication
- `Api::V1::ErrorsController` with create action
- `ErrorIngestionService` orchestrating full flow
- `BacktraceParser` for Ruby backtrace parsing
- Fingerprint generation with custom override support
- **101 tests passing** (36 new tests for Phase 2)

**Remaining:**
- Rate limiting (optional enhancement)

**Next Step:** Phase 3 - Web Dashboard
