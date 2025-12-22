# TODO - Phase 3: Web Dashboard

## Overview
Build the web interface for managing apps and viewing/resolving errors.

---

## 1. Apps Management

### 1.1 Apps Controller & Views
- [x] Create `AppsController` with full CRUD actions
- [x] Index page: list user's apps with error counts
- [x] Show page: app details with recent problems
- [x] New/Edit forms: name, environment fields
- [x] Delete with confirmation
- [x] Display API key (with copy button)
- [x] Regenerate API key functionality

### 1.2 Routes
```ruby
resources :apps do
  member do
    post :regenerate_api_key
  end
end
```

---

## 2. Problems List

### 2.1 Problems Controller & Views
- [x] Create `ProblemsController` (nested under apps)
- [x] Index page: paginated list of problems
- [x] Filter by status (unresolved/resolved/all)
- [x] Sort by last occurrence, error count
- [x] Search by error class or message
- [x] Bulk actions: resolve/unresolve selected

### 2.2 Problem List Item Display
- [x] Error class and truncated message
- [x] Notice count badge
- [x] First/last seen timestamps
- [x] Status indicator (resolved/unresolved)
- [x] Link to problem detail

---

## 3. Problem Detail & Notices

### 3.1 Problem Show Page
- [x] Error class and full message
- [x] Status with resolve/unresolve button
- [x] Timeline: first seen, last seen, resolved at
- [ ] Notice count and occurrence graph (optional)
- [x] List of recent notices

### 3.2 Notice Detail
- [x] Full backtrace with syntax highlighting
- [x] Context data (collapsible JSON)
- [x] Request info (URL, method, params, headers)
- [x] User info display
- [x] Occurred at timestamp

---

## 4. Navigation & Layout

### 4.1 App Layout Updates
- [x] Sidebar or top nav with app switcher
- [x] Breadcrumbs (App > Problems > Notice)
- [x] Flash messages styled for Violet Bold theme
- [x] Empty states for no apps/problems

### 4.2 Dashboard
- [x] Update root dashboard to show:
  - Total apps count
  - Total unresolved problems
  - Recent errors across all apps (clickable links to problem detail)
  - Quick links to each app (grid with unresolved count badges)

---

## 5. Styling

### 5.1 Apply Violet Bold Theme
- [x] Use approved design system components
- [x] Dark zinc-900 backgrounds
- [x] Violet-600 primary actions
- [x] Pink-500 for error indicators
- [x] Emerald-400 for resolved status
- [x] Inter font family

### 5.2 Components Needed
- [x] Data tables with sorting
- [x] Pagination controls (Pagy with Tailwind)
- [x] Status badges (resolved/unresolved)
- [x] Copy-to-clipboard buttons
- [x] Collapsible sections (Alpine.js)
- [x] Code/backtrace display

---

## 6. Testing Plan

### Controller Tests
- [x] Apps CRUD operations
- [x] Authorization (users can only see their apps)
- [x] Problems filtering and pagination
- [x] Resolve/unresolve actions
- [x] Notice detail view and authorization

### System Tests
- [ ] Create and manage an app
- [ ] View problems list with filters
- [ ] View problem and notice details
- [ ] Resolve and unresolve a problem

---

## 7. Current Progress

**Status:** Phase 3 Web Dashboard Complete

**Completed:**
- AppsController with full CRUD + regenerate API key
- Index page with error counts and status badges
- Show page with API key display, copy button, stats, recent problems
- New/Edit forms with environment select
- Delete with confirmation dialog
- ProblemsController with index and show pages
- Problems index with filtering (status), sorting (recent, oldest, notices), and search
- Bulk resolve/unresolve functionality with Stimulus controller
- Problem show page with status toggle and recent notices
- Pagy pagination with custom Tailwind styling
- NoticesController with full notice detail page
- Notice show page with backtrace, request, user, and context sections
- Collapsible sections using Alpine.js
- Navigation between notices (newer/older)
- Dashboard with stats, quick links to apps, and clickable recent problems
- 159 total tests passing

**Next Step:** Add system tests (Section 6) or move to Phase 4
