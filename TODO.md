# TODO - Phase 4: Notifications

## Overview
Implement email notifications for error events using the `noticed` gem, leveraging the existing Solid Queue infrastructure.

---

## 1. Setup & Configuration

### 1.1 Install Noticed Gem
- [x] Add `gem "noticed", "~> 2.0"` to Gemfile
- [x] Run `bundle install`
- [x] Run `rails noticed:install:migrations`
- [x] Run `rails db:migrate`

### 1.2 Add Notification Settings to Apps
- [x] Generate migration: `AddNotificationSettingsToApps`
  - `notify_on_new_problem:boolean` (default: true)
  - `notify_on_reoccurrence:boolean` (default: true)
- [x] Run migration

---

## 2. Models

### 2.1 Update User Model
- [x] Add `has_many :notifications, as: :recipient, dependent: :destroy, class_name: "Noticed::Notification"`

### 2.2 Update App Model
- [x] Notification settings auto-available via migration columns

---

## 3. Notifiers

### 3.1 NewProblemNotifier
- [x] Create `app/notifiers/new_problem_notifier.rb`
- [x] Configure email delivery with conditional (`notify_on_new_problem?`)
- [x] Add `message` and `url` helper methods

### 3.2 ProblemReoccurredNotifier
- [x] Create `app/notifiers/problem_reoccurred_notifier.rb`
- [x] Configure email delivery with conditional (`notify_on_reoccurrence?`)
- [x] Add `message` and `url` helper methods

---

## 4. Mailer

### 4.1 ProblemsMailer
- [x] Create `app/mailers/problems_mailer.rb`
- [x] Implement `new_problem` action
- [x] Implement `problem_reoccurred` action

### 4.2 Mailer Views
- [x] Create `app/views/problems_mailer/new_problem.html.erb`
- [x] Create `app/views/problems_mailer/new_problem.text.erb`
- [x] Create `app/views/problems_mailer/problem_reoccurred.html.erb`
- [x] Create `app/views/problems_mailer/problem_reoccurred.text.erb`

---

## 5. Error Ingestion Integration

### 5.1 Modify ErrorIngestionService
- [x] Track if problem was resolved before new notice (`@problem_was_resolved`)
- [x] Auto-unresolve resolved problems when new notice arrives
- [x] Add `notify_if_needed` method
- [x] Trigger `NewProblemNotifier` on first notice
- [x] Trigger `ProblemReoccurredNotifier` when resolved problem gets new notice

---

## 6. Settings UI

### 6.1 App Form Updates
- [x] Add checkbox for "Notify on new problems"
- [x] Add checkbox for "Notify on reoccurrence"
- [x] Update `apps_controller` to permit new params

### 6.2 App Show Page
- [x] Display current notification settings

---

## 7. Testing

### 7.1 Unit Tests
- [x] `test/notifiers/new_problem_notifier_test.rb`
- [x] `test/notifiers/problem_reoccurred_notifier_test.rb`
- [x] `test/mailers/problems_mailer_test.rb`

### 7.2 Integration Tests
- [x] Test notification sent on new problem via API
- [x] Test notification sent when resolved problem reoccurs
- [x] Test auto-unresolve behavior

---

## 8. Current Progress

**Status:** Phase 4 Complete (All Items)

**Completed:**
- Noticed gem installed with migrations
- Notification settings added to apps (notify_on_new_problem, notify_on_reoccurrence)
- User model updated with notifications association
- NewProblemNotifier and ProblemReoccurredNotifier created
- ProblemsMailer with HTML and text email templates
- ErrorIngestionService modified for notification triggers
- Auto-unresolve behavior for resolved problems
- Notification settings UI in app edit form
- Notification settings display on app show page
- All tests passing

**Next Step:** Move to Version 1.1 (Enhanced Filtering) or other future enhancements
