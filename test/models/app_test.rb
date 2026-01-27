require 'test_helper'

class AppTest < ActiveSupport::TestCase
  test 'requires name' do
    app = App.new
    assert_not app.valid?
    assert_includes app.errors[:name], "can't be blank"
  end

  test 'generates ingestion_key automatically' do
    app = App.new(name: 'Test App')
    # has_secure_token generates on initialize
    assert_not_nil app.ingestion_key
    assert app.ingestion_key.length >= 24
  end

  test 'ingestion_key must be unique' do
    existing = apps(:one)
    app = App.new(name: 'Test App', ingestion_key: existing.ingestion_key)
    assert_not app.valid?
    assert_includes app.errors[:ingestion_key], 'has already been taken'
  end

  test 'valid app can be created' do
    app = App.new(name: 'New App')
    assert app.valid?
  end

  test 'environment is optional' do
    app = App.new(name: 'Test App')
    assert app.valid?
    assert_nil app.environment
  end

  test 'slug must be unique globally' do
    existing = apps(:one)
    app = App.new(name: existing.name)
    app.valid? # trigger slug generation
    if app.slug == existing.slug
      assert_not app.valid?
      assert_includes app.errors[:slug], 'has already been taken'
    else
      # If slug is different (e.g., with counter), it should be valid
      assert app.valid?
    end
  end

  test 'accessible_by? returns true for team members' do
    user = users(:one)
    team = Team.create!(name: 'Test Team', owner: user)
    team.team_members.create!(user: user, role: 'admin')
    app = App.create!(name: 'Test App', slug: 'test-app')
    team.team_assignments.create!(app: app)

    assert app.accessible_by?(user)
  end

  test 'accessible_by? returns false for non-members' do
    user = users(:one)
    other_user = users(:two) || User.create!(email_address: 'other@example.com', password: 'password123')
    team = Team.create!(name: 'Test Team', owner: user)
    team.team_members.create!(user: user, role: 'admin')
    app = App.create!(name: 'Test App', slug: 'test-app')
    team.team_assignments.create!(app: app)

    assert_not app.accessible_by?(other_user)
  end

  test 'direct_access_users returns users with active record permissions' do
    user = users(:one)
    app = App.create!(name: 'Test App')
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'grant'
    )

    assert_includes app.direct_access_users, user
  end

  test 'direct_access_users excludes users with revoked permissions' do
    user = users(:one)
    app = App.create!(name: 'Test App')
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'revoke'
    )

    assert_not_includes app.direct_access_users, user
  end

  test 'direct_access_users excludes users with expired permissions' do
    user = users(:one)
    app = App.create!(name: 'Test App')
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'grant',
      expires_at: 1.day.ago
    )

    assert_not_includes app.direct_access_users, user
  end

  test 'notification_recipients includes team members' do
    user = users(:one)
    team = Team.create!(name: 'Test Team', owner: user)
    team.team_members.create!(user: user, role: 'admin')
    app = App.create!(name: 'Test App', notify_on_new_problem: true)
    team.team_assignments.create!(app: app)

    assert_includes app.notification_recipients(:new_problem), user
  end

  test 'notification_recipients includes direct access users' do
    user = users(:one)
    app = App.create!(name: 'Test App', notify_on_new_problem: true)
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'grant'
    )

    assert_includes app.notification_recipients(:new_problem), user
  end

  test 'notification_recipients deduplicates users with both team and direct access' do
    user = users(:one)
    team = Team.create!(name: 'Test Team', owner: user)
    team.team_members.create!(user: user, role: 'admin')
    app = App.create!(name: 'Test App', notify_on_new_problem: true)
    team.team_assignments.create!(app: app)
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'grant'
    )

    recipients = app.notification_recipients(:new_problem)
    assert_equal 1, recipients.count { |r| r.id == user.id }
  end

  test 'notification_recipients respects user notification preferences' do
    user = users(:one)
    app = App.create!(name: 'Test App', notify_on_new_problem: true)
    permission = permissions(:apps_read)

    RecordPermission.create!(
      user: user,
      permission: permission,
      record: app,
      grant_type: 'grant'
    )

    # User opts out of new problem notifications
    UserNotificationPreference.create!(
      user: user,
      app: app,
      notify_on_new_problem: false
    )

    assert_not_includes app.notification_recipients(:new_problem), user
  end

  test 'created_by association works' do
    user = users(:one)
    app = App.create!(name: 'Test App', created_by: user)

    assert_equal user, app.created_by
  end
end
