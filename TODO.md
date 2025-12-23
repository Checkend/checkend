# TODO - Version 1.1: Enhanced Filtering

## Overview
Add tags support, custom fingerprint override, and improved search capabilities to the Problems dashboard.

---

## 1. Tags Support ✅

### Approach Options

**Option A: Custom Implementation (Recommended)**
- Build simple `tags` and `problem_tags` tables
- Lightweight, no gem dependencies
- Full control over behavior
- Pros: Simple, fast, no bloat
- Cons: Manual implementation of common features

**Option B: acts-as-taggable-on Gem**
- Popular tagging gem with many features
- Pros: Feature-rich, tag clouds, tag counts, context tagging
- Cons: Heavy dependency, may be overkill for our needs

**Decision:** Option A - Custom implementation for simplicity

### 1.1 Database Setup ✅
- [x] Generate Tag model: `name:string:uniq`
- [x] Generate ProblemTag join model: `problem:references tag:references`
- [x] Add unique index on `[problem_id, tag_id]`
- [x] Run migrations

### 1.2 Models ✅
- [x] Create `Tag` model with validations (name presence, uniqueness, format)
- [x] Create `ProblemTag` model
- [x] Add `has_many :problem_tags` and `has_many :tags, through: :problem_tags` to Problem
- [x] Add `has_many :problem_tags` and `has_many :problems, through: :problem_tags` to Tag
- [x] Add scope `Problem.tagged_with(tag_names)` for filtering

### 1.3 Tags Management UI ✅
- [x] Add tags display to problem list items (colored badges)
- [x] Add tags display to problem show page
- [x] Create inline tag editor on problem show page (add/remove tags)
- [x] Add Stimulus controller for tag autocomplete and management
- [x] Create `/tags` endpoint for autocomplete suggestions (JSON)
- [x] ProblemTagsController with full test coverage (16 tests)

### 1.4 Tag Filtering ✅
- [x] Add tag filter dropdown/multi-select to problems index
- [x] Update ProblemsController to filter by tags
- [x] Preserve tag filter in pagination and bulk actions
- [x] Show active tag filters as removable chips (toggle selection)

### 1.5 Bulk Tagging ✅
- [x] Add "Add Tags" bulk action to selected problems
- [x] Add "Remove Tags" bulk action
- [x] Dropdown Stimulus controller for action menus
- [x] Controller tests for bulk tagging (6 tests)

---

## 2. Custom Fingerprint Override

### 2.1 Database Changes
- [ ] Add `custom_fingerprint:string` column to problems
- [ ] Add `fingerprint_locked:boolean` column (default: false)
- [ ] Migrate existing data

### 2.2 Fingerprint Override Logic
- [ ] Modify Problem model: use `custom_fingerprint` if present, else generated
- [ ] Update ErrorIngestionService to respect locked fingerprints
- [ ] When fingerprint is locked, new notices still match by custom fingerprint

### 2.3 Problem Merging
- [ ] Create `ProblemMergeService` to combine two problems
  - Move all notices from source to target
  - Update counter caches
  - Delete source problem
  - Lock target fingerprint to prevent re-splitting
- [ ] Add merge UI on problem show page
- [ ] Add problem search/select modal for merge target

### 2.4 Fingerprint UI
- [ ] Display current fingerprint on problem show page
- [ ] Add "Edit Fingerprint" form (with warning about implications)
- [ ] Add "Lock Fingerprint" toggle
- [ ] Add "Merge with Another Problem" action

---

## 3. Search Improvements

### Approach Options

**Option A: Enhanced ILIKE (Recommended for v1.1)**
- Extend current ILIKE search to more fields
- Add date range filtering
- Simple, no additional setup
- Pros: Works now, no dependencies
- Cons: Limited full-text capabilities

**Option B: PostgreSQL Full-Text Search**
- Use `tsvector` and `tsquery` for proper FTS
- Pros: Ranking, stemming, better relevance
- Cons: More complex, requires GIN indexes, migration work

**Option C: pg_search Gem**
- Wrapper around PostgreSQL FTS
- Pros: Easy Rails integration, multi-model search
- Cons: Another dependency

**Decision:** Option A for v1.1, consider Option B/C for future

### 3.1 Extended Search Fields
- [ ] Search in `context` JSONB field (notices)
- [ ] Search in `user_info` JSONB field (notices)
- [ ] Search by environment (if tracked in context)
- [ ] Option to search notice-level data (slower but more thorough)

### 3.2 Date Range Filtering
- [ ] Add "From Date" and "To Date" inputs to filter form
- [ ] Filter by `first_noticed_at` or `last_noticed_at` (user choice)
- [ ] Add quick filters: "Today", "Last 7 days", "Last 30 days"

### 3.3 Advanced Filters
- [ ] Filter by notice count range (e.g., "More than 10 occurrences")
- [ ] Filter by app (for multi-app view, future consideration)
- [ ] Save filter presets (optional, stretch goal)

### 3.4 UI Improvements
- [ ] Collapsible "Advanced Filters" section
- [ ] Show active filter count badge
- [ ] Keyboard shortcut for search focus (Cmd+K or /)

---

## 4. Testing

### 4.1 Tag Tests
- [x] `test/models/tag_test.rb` - validations, uniqueness
- [x] `test/models/problem_tag_test.rb` - associations
- [x] `test/models/problem_test.rb` - tagged_with scope
- [x] `test/controllers/problem_tags_controller_test.rb` - CRUD operations (16 tests)
- [x] `test/controllers/problems_controller_test.rb` - tag filtering (4 tests)
- [ ] `test/system/tags_test.rb` - tag management UI

### 4.2 Fingerprint Tests
- [ ] Test custom fingerprint override
- [ ] Test fingerprint locking
- [ ] `test/services/problem_merge_service_test.rb`
- [ ] Test merge UI flow

### 4.3 Search Tests
- [ ] Test date range filtering
- [ ] Test extended field search
- [ ] Test filter combinations

---

## 5. Current Progress

**Status:** Section 1 (Tags Support) Complete!

**Completed:**
- Tag and ProblemTag models with migrations
- Tag validations (name format, uniqueness, normalization)
- Many-to-many relationship between Problem and Tag
- `Problem.tagged_with(tag_names)` scope for filtering
- Tags display on problems index (colored badges)
- Tags display on problem show page with inline editor
- Stimulus controller for tag autocomplete and management
- ProblemTagsController with JSON endpoints for add/remove/search
- Tag filtering UI on problems index with toggle selection
- Filters preserved in pagination and bulk actions
- Bulk add/remove tags with dropdown menus
- Full test coverage (227 tests passing)

**Next Step:** Continue with Section 2 (Custom Fingerprint Override) or Section 3 (Search Improvements)

---

## Implementation Order

1. ~~Tags (1.1 → 1.5) - Most user-visible feature~~ ✅ Complete
2. Search Improvements (3.1 → 3.4) - Quick wins
3. Custom Fingerprint (2.1 → 2.4) - More complex, do last
