# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2025_12_24_005421) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "api_keys", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "key", null: false
    t.datetime "last_used_at"
    t.string "name", null: false
    t.jsonb "permissions", default: [], null: false
    t.datetime "revoked_at"
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_api_keys_on_key", unique: true
  end

  create_table "apps", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "environment"
    t.string "ingestion_key", null: false
    t.string "name", null: false
    t.boolean "notify_on_new_problem", default: true, null: false
    t.boolean "notify_on_reoccurrence", default: true, null: false
    t.string "slug"
    t.datetime "updated_at", null: false
    t.index ["ingestion_key"], name: "index_apps_on_ingestion_key", unique: true
    t.index ["slug"], name: "index_apps_on_slug", unique: true
  end

  create_table "backtraces", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "fingerprint", null: false
    t.jsonb "lines", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["fingerprint"], name: "index_backtraces_on_fingerprint", unique: true
  end

  create_table "noticed_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "notifications_count"
    t.jsonb "params"
    t.bigint "record_id"
    t.string "record_type"
    t.string "type"
    t.datetime "updated_at", null: false
    t.index ["record_type", "record_id"], name: "index_noticed_events_on_record"
  end

  create_table "noticed_notifications", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "event_id", null: false
    t.datetime "read_at", precision: nil
    t.bigint "recipient_id", null: false
    t.string "recipient_type", null: false
    t.datetime "seen_at", precision: nil
    t.string "type"
    t.datetime "updated_at", null: false
    t.index ["event_id"], name: "index_noticed_notifications_on_event_id"
    t.index ["recipient_type", "recipient_id"], name: "index_noticed_notifications_on_recipient"
  end

  create_table "notices", force: :cascade do |t|
    t.bigint "backtrace_id"
    t.jsonb "context", default: {}
    t.datetime "created_at", null: false
    t.string "error_class", null: false
    t.text "error_message"
    t.jsonb "notifier"
    t.datetime "occurred_at", null: false
    t.bigint "problem_id", null: false
    t.jsonb "request", default: {}
    t.datetime "updated_at", null: false
    t.jsonb "user_info", default: {}
    t.index ["backtrace_id"], name: "index_notices_on_backtrace_id"
    t.index ["occurred_at"], name: "index_notices_on_occurred_at"
    t.index ["problem_id"], name: "index_notices_on_problem_id"
  end

  create_table "problem_tags", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "problem_id", null: false
    t.bigint "tag_id", null: false
    t.datetime "updated_at", null: false
    t.index ["problem_id", "tag_id"], name: "index_problem_tags_on_problem_id_and_tag_id", unique: true
    t.index ["problem_id"], name: "index_problem_tags_on_problem_id"
    t.index ["tag_id"], name: "index_problem_tags_on_tag_id"
  end

  create_table "problems", force: :cascade do |t|
    t.bigint "app_id", null: false
    t.datetime "created_at", null: false
    t.string "error_class", null: false
    t.text "error_message"
    t.string "fingerprint", null: false
    t.datetime "first_noticed_at"
    t.datetime "last_noticed_at"
    t.integer "notices_count", default: 0, null: false
    t.datetime "resolved_at"
    t.string "status", default: "unresolved", null: false
    t.datetime "updated_at", null: false
    t.index ["app_id", "fingerprint"], name: "index_problems_on_app_id_and_fingerprint", unique: true
    t.index ["app_id"], name: "index_problems_on_app_id"
    t.index ["last_noticed_at"], name: "index_problems_on_last_noticed_at"
    t.index ["status"], name: "index_problems_on_status"
  end

  create_table "sessions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "ip_address"
    t.datetime "updated_at", null: false
    t.string "user_agent"
    t.bigint "user_id", null: false
    t.index ["user_id"], name: "index_sessions_on_user_id"
  end

  create_table "tags", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name"
    t.datetime "updated_at", null: false
    t.index ["name"], name: "index_tags_on_name", unique: true
  end

  create_table "team_assignments", force: :cascade do |t|
    t.bigint "app_id", null: false
    t.datetime "created_at", null: false
    t.bigint "team_id", null: false
    t.datetime "updated_at", null: false
    t.index ["app_id"], name: "index_team_assignments_on_app_id"
    t.index ["team_id", "app_id"], name: "index_team_assignments_on_team_id_and_app_id", unique: true
    t.index ["team_id"], name: "index_team_assignments_on_team_id"
  end

  create_table "team_invitations", force: :cascade do |t|
    t.datetime "accepted_at"
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.datetime "expires_at"
    t.bigint "invited_by_id", null: false
    t.bigint "team_id", null: false
    t.string "token", null: false
    t.datetime "updated_at", null: false
    t.index ["invited_by_id"], name: "index_team_invitations_on_invited_by_id"
    t.index ["team_id"], name: "index_team_invitations_on_team_id"
    t.index ["token"], name: "index_team_invitations_on_token", unique: true
  end

  create_table "team_members", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "role", default: "member", null: false
    t.bigint "team_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["team_id", "user_id"], name: "index_team_members_on_team_id_and_user_id", unique: true
    t.index ["team_id"], name: "index_team_members_on_team_id"
    t.index ["user_id"], name: "index_team_members_on_user_id"
  end

  create_table "teams", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "owner_id", null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["owner_id"], name: "index_teams_on_owner_id"
    t.index ["slug"], name: "index_teams_on_slug", unique: true
  end

  create_table "user_notification_preferences", force: :cascade do |t|
    t.bigint "app_id", null: false
    t.datetime "created_at", null: false
    t.boolean "notify_on_new_problem", default: true
    t.boolean "notify_on_reoccurrence", default: true
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["app_id"], name: "index_user_notification_preferences_on_app_id"
    t.index ["user_id", "app_id"], name: "index_user_notification_preferences_on_user_id_and_app_id", unique: true
    t.index ["user_id"], name: "index_user_notification_preferences_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email_address", null: false
    t.datetime "last_logged_in_at"
    t.string "password_digest", null: false
    t.boolean "site_admin", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["email_address"], name: "index_users_on_email_address", unique: true
    t.index ["site_admin"], name: "index_users_on_site_admin"
  end

  add_foreign_key "notices", "backtraces"
  add_foreign_key "notices", "problems"
  add_foreign_key "problem_tags", "problems"
  add_foreign_key "problem_tags", "tags"
  add_foreign_key "problems", "apps"
  add_foreign_key "sessions", "users"
  add_foreign_key "team_assignments", "apps"
  add_foreign_key "team_assignments", "teams"
  add_foreign_key "team_invitations", "teams"
  add_foreign_key "team_invitations", "users", column: "invited_by_id"
  add_foreign_key "team_members", "teams"
  add_foreign_key "team_members", "users"
  add_foreign_key "teams", "users", column: "owner_id"
  add_foreign_key "user_notification_preferences", "apps"
  add_foreign_key "user_notification_preferences", "users"
end
