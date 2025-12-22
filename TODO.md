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
- [ ] Error class and full message
- [ ] Status with resolve/unresolve button
- [ ] Timeline: first seen, last seen, resolved at
- [ ] Notice count and occurrence graph (optional)
- [ ] List of recent notices

### 3.2 Notice Detail
- [ ] Full backtrace with syntax highlighting
- [ ] Context data (collapsible JSON)
- [ ] Request info (URL, method, params, headers)
- [ ] User info display
- [ ] Occurred at timestamp

---

## 4. Navigation & Layout

### 4.1 App Layout Updates
- [ ] Sidebar or top nav with app switcher
- [ ] Breadcrumbs (App > Problems > Notice)
- [ ] Flash messages styled for Violet Bold theme
- [ ] Empty states for no apps/problems

### 4.2 Dashboard
- [ ] Update root dashboard to show:
  - Total apps count
  - Total unresolved problems
  - Recent errors across all apps
  - Quick links to each app

---

## 5. Styling

### 5.1 Apply Violet Bold Theme
- [ ] Use approved design system components
- [ ] Dark zinc-900 backgrounds
- [ ] Violet-600 primary actions
- [ ] Pink-500 for error indicators
- [ ] Emerald-400 for resolved status
- [ ] Inter font family

### 5.2 Components Needed
- [ ] Data tables with sorting
- [ ] Pagination controls
- [ ] Status badges (resolved/unresolved)
- [ ] Copy-to-clipboard buttons
- [ ] Collapsible sections
- [ ] Code/backtrace display

---

## 6. Testing Plan

### Controller Tests
- [x] Apps CRUD operations
- [x] Authorization (users can only see their apps)
- [x] Problems filtering and pagination
- [x] Resolve/unresolve actions

### System Tests
- [ ] Create and manage an app
- [ ] View problems list with filters
- [ ] View problem and notice details
- [ ] Resolve and unresolve a problem

---

## 7. Current Progress

**Status:** Problems List Complete

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
- 23 new controller tests for Problems (149 total tests)

**Next Step:** Implement Problem Detail page with full notice display (Section 3)
