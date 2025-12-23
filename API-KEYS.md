# Checkend API Keys

## Overview

API keys allow external applications to manage resources in Checkend via REST API. API keys are system-wide (can access all resources) and support granular permissions for different resource types and operations.

---

## Creating API Keys

API keys can be created through the web interface:

1. Navigate to **API Keys** in the navigation menu
2. Click **New API Key**
3. Enter a name for the key
4. Select the permissions you want to grant
5. Click **Create API Key**
6. **Important:** Copy and save the API key immediately - it will only be shown once!

---

## Authentication

All API requests must include the `Checkend-API-Key` header with a valid API key.

```http
Checkend-API-Key: your_api_key_here
```

> **Note:** This header follows [RFC 6648](https://tools.ietf.org/html/rfc6648) conventions by using a vendor-prefixed header name (`Checkend-`) instead of the deprecated `X-` prefix.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 401 | Missing or invalid API key |
| 403 | API key is valid but missing required permission |

---

## Permissions

Permissions follow a `resource:action` pattern:

### Available Permissions

| Permission | Description |
|------------|-------------|
| `apps:read` | List and view apps |
| `apps:write` | Create, update, delete apps |
| `problems:read` | List and view problems |
| `problems:write` | Resolve/unresolve problems, bulk operations |
| `notices:read` | View notices |
| `tags:read` | List tags |
| `tags:write` | Create and delete tags |
| `teams:read` | List and view teams |
| `teams:write` | Create, update, delete teams, manage members and app assignments |
| `users:read` | List and view users |
| `users:write` | Create, update, delete users |

---

## API Endpoints

All endpoints are under the `/api/v1/` namespace.

### Apps

#### List Apps
```http
GET /api/v1/apps
```

**Required Permission:** `apps:read`

**Response:**
```json
[
  {
    "id": 1,
    "slug": "my-app",
    "name": "My App",
    "environment": "production",
    "notify_on_new_problem": true,
    "notify_on_reoccurrence": true,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

#### Show App
```http
GET /api/v1/apps/:id
```

**Required Permission:** `apps:read`

#### Create App
```http
POST /api/v1/apps
Content-Type: application/json

{
  "app": {
    "name": "My New App",
    "environment": "production",
    "notify_on_new_problem": true,
    "notify_on_reoccurrence": true
  }
}
```

**Required Permission:** `apps:write`

#### Update App
```http
PATCH /api/v1/apps/:id
Content-Type: application/json

{
  "app": {
    "name": "Updated App Name",
    "environment": "staging"
  }
}
```

**Required Permission:** `apps:write`

#### Delete App
```http
DELETE /api/v1/apps/:id
```

**Required Permission:** `apps:write`

---

### Problems

#### List Problems
```http
GET /api/v1/apps/:app_id/problems?status=unresolved&tags[]=critical&page=1&per_page=25
```

**Query Parameters:**
- `status` - Filter by status: `resolved`, `unresolved`, or omit for all
- `search` - Search by error class or message
- `tags[]` - Filter by tags (array)
- `date_from` - Filter by last noticed date (YYYY-MM-DD)
- `date_to` - Filter by last noticed date (YYYY-MM-DD)
- `min_notices` - Minimum number of notices
- `sort` - Sort order: `notices` (by notice count), `oldest` (by last noticed), or default (most recent)
- `page` - Page number (default: 1)
- `per_page` - Items per page (default: 25, max: 100)

**Required Permission:** `problems:read`

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "app_id": 1,
      "error_class": "NoMethodError",
      "error_message": "undefined method `foo' for nil:NilClass",
      "fingerprint": "abc123...",
      "status": "unresolved",
      "notices_count": 42,
      "first_noticed_at": "2024-01-15T10:30:00Z",
      "last_noticed_at": "2024-01-20T14:22:00Z",
      "resolved_at": null,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-20T14:22:00Z",
      "tags": [
        { "id": 1, "name": "critical" }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 25,
    "total": 100,
    "total_pages": 4
  }
}
```

#### Show Problem
```http
GET /api/v1/apps/:app_id/problems/:id
```

**Required Permission:** `problems:read`

#### Resolve Problem
```http
POST /api/v1/apps/:app_id/problems/:id/resolve
```

**Required Permission:** `problems:write`

#### Unresolve Problem
```http
POST /api/v1/apps/:app_id/problems/:id/unresolve
```

**Required Permission:** `problems:write`

#### Bulk Resolve Problems
```http
POST /api/v1/apps/:app_id/problems/bulk_resolve
Content-Type: application/json

{
  "problem_ids": [1, 2, 3]
}
```

**Required Permission:** `problems:write`

---

### Notices

#### List Notices
```http
GET /api/v1/apps/:app_id/problems/:problem_id/notices?page=1&per_page=25
```

**Query Parameters:**
- `date_from` - Filter by occurred date (YYYY-MM-DD)
- `date_to` - Filter by occurred date (YYYY-MM-DD)
- `page` - Page number (default: 1)
- `per_page` - Items per page (default: 25, max: 100)

**Required Permission:** `notices:read`

#### Show Notice
```http
GET /api/v1/apps/:app_id/problems/:problem_id/notices/:id
```

**Required Permission:** `notices:read`

---

### Tags

#### List Tags
```http
GET /api/v1/apps/:app_id/problems/:problem_id/tags
```

**Required Permission:** `tags:read`

#### Add Tag
```http
POST /api/v1/apps/:app_id/problems/:problem_id/tags
Content-Type: application/json

{
  "name": "critical"
}
```

**Required Permission:** `tags:write`

#### Remove Tag
```http
DELETE /api/v1/apps/:app_id/problems/:problem_id/tags/:id
```

**Required Permission:** `tags:write`

---

### Teams

#### List Teams
```http
GET /api/v1/teams
```

**Required Permission:** `teams:read`

#### Show Team
```http
GET /api/v1/teams/:id
```

**Required Permission:** `teams:read`

#### Create Team
```http
POST /api/v1/teams
Content-Type: application/json

{
  "team": {
    "name": "Engineering Team",
    "owner_id": 1
  }
}
```

**Required Permission:** `teams:write`

**Note:** The owner will automatically be added as an admin team member.

#### Update Team
```http
PATCH /api/v1/teams/:id
Content-Type: application/json

{
  "team": {
    "name": "Updated Team Name"
  }
}
```

**Required Permission:** `teams:write`

#### Delete Team
```http
DELETE /api/v1/teams/:id
```

**Required Permission:** `teams:write`

#### List Team Members
```http
GET /api/v1/teams/:team_id/members
```

**Required Permission:** `teams:read`

#### Add Team Member
```http
POST /api/v1/teams/:team_id/members
Content-Type: application/json

{
  "user_id": 2,
  "role": "member"
}
```

**Alternative (by email):**
```json
{
  "email_address": "user@example.com",
  "role": "admin"
}
```

**Required Permission:** `teams:write`

**Roles:** `admin` or `member` (default: `member`)

#### Update Team Member
```http
PATCH /api/v1/teams/:team_id/members/:id
Content-Type: application/json

{
  "role": "admin"
}
```

**Required Permission:** `teams:write`

#### Remove Team Member
```http
DELETE /api/v1/teams/:team_id/members/:id
```

**Required Permission:** `teams:write`

**Note:** Cannot remove the last admin from a team.

#### List Team Apps
```http
GET /api/v1/teams/:team_id/apps
```

**Required Permission:** `teams:read`

#### Assign App to Team
```http
POST /api/v1/teams/:team_id/apps
Content-Type: application/json

{
  "app_id": "my-app-slug"
}
```

**Required Permission:** `teams:write`

#### Remove App from Team
```http
DELETE /api/v1/teams/:team_id/apps/:app_id
```

**Required Permission:** `teams:write`

---

### Users

#### List Users
```http
GET /api/v1/users
```

**Required Permission:** `users:read`

#### Show User
```http
GET /api/v1/users/:id
```

**Required Permission:** `users:read`

#### Create User
```http
POST /api/v1/users
Content-Type: application/json

{
  "user": {
    "email_address": "user@example.com",
    "password": "secure_password",
    "password_confirmation": "secure_password"
  }
}
```

**Required Permission:** `users:write`

#### Update User
```http
PATCH /api/v1/users/:id
Content-Type: application/json

{
  "user": {
    "email_address": "newemail@example.com"
  }
}
```

To update password:
```json
{
  "user": {
    "password": "new_password",
    "password_confirmation": "new_password"
  }
}
```

**Required Permission:** `users:write`

#### Delete User
```http
DELETE /api/v1/users/:id
```

**Required Permission:** `users:write`

---

### Health Check

#### Health Status
```http
GET /api/v1/health
```

**No authentication required.**

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Error Responses

### 400 Bad Request
Invalid payload or validation errors.

```json
{
  "error": "validation_failed",
  "messages": [
    "Name can't be blank",
    "Email address is invalid"
  ]
}
```

### 401 Unauthorized
Missing or invalid API key.

```json
{
  "error": "unauthorized",
  "message": "Invalid or revoked API key"
}
```

### 403 Forbidden
API key is valid but missing required permission.

```json
{
  "error": "forbidden",
  "message": "Missing required permission: apps:write"
}
```

### 404 Not Found
Resource not found.

```json
{
  "error": "not_found",
  "message": "Couldn't find App with 'id'=123"
}
```

### 422 Unprocessable Entity
Valid JSON but semantic errors.

```json
{
  "error": "validation_failed",
  "message": "Cannot remove the last admin from the team"
}
```

---

## Example: cURL

```bash
# List apps
curl -X GET https://checkend.example.com/api/v1/apps \
  -H "Checkend-API-Key: your_api_key_here"

# Create a problem resolution
curl -X POST https://checkend.example.com/api/v1/apps/my-app/problems/123/resolve \
  -H "Checkend-API-Key: your_api_key_here"

# Create a team
curl -X POST https://checkend.example.com/api/v1/teams \
  -H "Content-Type: application/json" \
  -H "Checkend-API-Key: your_api_key_here" \
  -d '{
    "team": {
      "name": "Engineering",
      "owner_id": 1
    }
  }'
```

---

## Example: Ruby Client

```ruby
require "net/http"
require "json"

class CheckendApiClient
  def initialize(api_key, base_url = "https://checkend.example.com")
    @api_key = api_key
    @base_url = base_url
  end

  def get_apps
    get("/api/v1/apps")
  end

  def get_problems(app_slug, filters = {})
    get("/api/v1/apps/#{app_slug}/problems", filters)
  end

  def resolve_problem(app_slug, problem_id)
    post("/api/v1/apps/#{app_slug}/problems/#{problem_id}/resolve")
  end

  def create_team(name, owner_id)
    post("/api/v1/teams", {
      team: {
        name: name,
        owner_id: owner_id
      }
    })
  end

  private

  def get(path, params = {})
    uri = URI("#{@base_url}#{path}")
    uri.query = URI.encode_www_form(params) if params.any?

    request = Net::HTTP::Get.new(uri)
    request["Checkend-API-Key"] = @api_key

    response = http.request(request)
    JSON.parse(response.body)
  end

  def post(path, body = {})
    uri = URI("#{@base_url}#{path}")

    request = Net::HTTP::Post.new(uri)
    request["Content-Type"] = "application/json"
    request["Checkend-API-Key"] = @api_key
    request.body = body.to_json

    response = http.request(request)
    JSON.parse(response.body)
  end

  def http
    @http ||= begin
      http = Net::HTTP.new(URI(@base_url).host, URI(@base_url).port)
      http.use_ssl = true if @base_url.start_with?("https")
      http
    end
  end
end

# Usage
client = CheckendApiClient.new("your_api_key_here")
apps = client.get_apps
problems = client.get_problems("my-app", { status: "unresolved" })
client.resolve_problem("my-app", 123)
```

---

## Best Practices

### 1. Store Keys Securely
- Never commit API keys to version control
- Use environment variables or secure key management systems
- Rotate keys regularly

### 2. Use Minimal Permissions
- Grant only the permissions needed for the specific use case
- Use read-only keys when possible
- Separate keys for different environments

### 3. Handle Errors Gracefully
- Check response status codes
- Implement retry logic with exponential backoff
- Log errors for debugging

### 4. Rate Limiting
- Be mindful of API usage
- Implement client-side rate limiting if needed
- Monitor your API key usage in the dashboard

### 5. Revoke Compromised Keys
- Immediately revoke keys if compromised
- Regularly audit active API keys
- Remove unused keys

---

## Revoking API Keys

API keys can be revoked through the web interface:

1. Navigate to **API Keys**
2. Click on the API key you want to revoke
3. Click **Revoke**

Revoked keys cannot be used for authentication and will return 401 Unauthorized responses.

---

## Versioning

The API is versioned via URL path (`/api/v1/`). Breaking changes will increment the version number. Non-breaking additions (new optional fields) may be added without version change.

