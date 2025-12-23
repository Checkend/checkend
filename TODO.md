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

## 2. Custom Fingerprint Override ⏭️ SKIPPED

**Decision:** Skip server-side fingerprint override. Client-side fingerprints are already supported via the API (`fingerprint` parameter). Server-side merging adds complexity for a rarely-used feature.

---

## 3. Search Improvements ✅

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

### 3.1 Extended Search Fields ⏭️ DEFERRED
- [ ] Search in `context` JSONB field (notices)
- [ ] Search in `user_info` JSONB field (notices)
- [ ] Search by environment (if tracked in context)
- [ ] Option to search notice-level data (slower but more thorough)

*Note: Deferred to future version. Requires more complex query optimization.*

### 3.2 Date Range Filtering ✅
- [x] Add "From Date" and "To Date" inputs to filter form
- [x] Filter by `last_noticed_at` date range
- [x] Add quick filters: "Today", "Last 7 days", "Last 30 days"

### 3.3 Advanced Filters ✅
- [x] Filter by notice count range (min_notices filter)
- [ ] Filter by app (for multi-app view, future consideration)
- [ ] Save filter presets (optional, stretch goal)

### 3.4 UI Improvements ✅
- [x] Collapsible "Advanced Filters" section
- [x] Show active filter count badge
- [ ] Keyboard shortcut for search focus (Cmd+K or /) - deferred

---

## 4. Notifier Tracking ✅

Track which client SDK sent each error to prepare for v2.0 client libraries.

### 4.1 Database Changes ✅
- [x] Add `notifier` jsonb column to notices table
- [x] Run migration

### 4.2 API Changes ✅
- [x] Add `notifier_params` to ErrorsController
- [x] Permit notifier fields: `name`, `version`, `language`, `language_version`
- [x] Pass notifier params to ErrorIngestionService
- [x] Store notifier data on Notice creation

### 4.3 UI Display ✅
- [x] Display notifier info on notice detail page (if present)
- [x] Show SDK name/version badge in notice list

### 4.4 Testing ✅
- [x] Test notifier params are stored correctly
- [x] Test backward compatibility (notifier is optional)

---

## 5. Testing

### 5.1 Tag Tests
- [x] `test/models/tag_test.rb` - validations, uniqueness
- [x] `test/models/problem_tag_test.rb` - associations
- [x] `test/models/problem_test.rb` - tagged_with scope
- [x] `test/controllers/problem_tags_controller_test.rb` - CRUD operations (16 tests)
- [x] `test/controllers/problems_controller_test.rb` - tag filtering (4 tests)
- [ ] `test/system/tags_test.rb` - tag management UI

### 5.2 Search Tests ✅
- [x] Test date range filtering (controller + model tests)
- [ ] Test extended field search (deferred with feature)
- [x] Test filter combinations (bulk action preserves filters)

---

## 6. Current Progress

**Status:** v1.1 Complete! All sections finished.

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
- Date range filtering (From/To dates with quick filters)
- Minimum notices filter
- Collapsible "Advanced Filters" section with badge
- Notifier tracking (SDK name, version, language info)
- Notifier display in UI (detail page section + list badge)
- Full test coverage (247 tests passing)

**Next Step:** v1.1 release or start v1.2 planning

---

## Implementation Order

1. ~~Tags (1.1 → 1.5) - Most user-visible feature~~ ✅ Complete
2. ~~Custom Fingerprint (2.1 → 2.4)~~ ⏭️ Skipped
3. ~~Search Improvements (3.2 → 3.4)~~ ✅ Complete
4. ~~Notifier Tracking (4.1 → 4.4) - Small, prepares for v2.0 SDKs~~ ✅ Complete
