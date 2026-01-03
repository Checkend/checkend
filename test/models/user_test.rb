require 'test_helper'

class UserTest < ActiveSupport::TestCase
  test 'downcases and strips email_address' do
    user = User.new(email_address: ' DOWNCASED@EXAMPLE.COM ')
    assert_equal('downcased@example.com', user.email_address)
  end

  test 'requires email_address' do
    user = User.new(password: 'password123')
    assert_not user.valid?
    assert_includes user.errors[:email_address], "can't be blank"
  end

  test 'requires unique email_address' do
    existing = users(:one)
    user = User.new(email_address: existing.email_address, password: 'password123')
    assert_not user.valid?
    assert_includes user.errors[:email_address], 'has already been taken'
  end

  test 'requires valid email format' do
    user = User.new(email_address: 'invalid-email', password: 'password123')
    assert_not user.valid?
    assert_includes user.errors[:email_address], 'is invalid'
  end

  test 'valid user can be created' do
    user = User.new(email_address: 'new@example.com', password: 'password123')
    assert user.valid?
  end

  test 'accessible_apps returns apps from teams' do
    user = users(:one)
    team = teams(:one)
    team.team_members.find_or_create_by!(user: user, role: 'admin')
    app = apps(:one)
    team.team_assignments.find_or_create_by!(app: app)

    assert_includes user.accessible_apps, app
  end

  test 'accessible_apps does not return apps from other teams' do
    user = users(:one)
    other_user = users(:two)
    other_team = Team.create!(name: 'Other Team', owner: other_user)
    other_team.team_members.create!(user: other_user, role: 'admin')
    other_app = App.create!(name: 'Other App', slug: 'other-app')
    other_team.team_assignments.create!(app: other_app)

    assert_not_includes user.accessible_apps, other_app
  end

  test 'wants_notification? uses app defaults when no preference' do
    user = users(:one)
    app = apps(:one)
    app.update!(notify_on_new_problem: true, notify_on_reoccurrence: false)

    assert user.wants_notification?(app, :new_problem)
    assert_not user.wants_notification?(app, :reoccurrence)
  end

  test 'wants_notification? uses user preference when set' do
    user = users(:one)
    app = apps(:one)
    pref = user.user_notification_preferences.create!(
      app: app,
      notify_on_new_problem: false,
      notify_on_reoccurrence: true
    )

    assert_not user.wants_notification?(app, :new_problem)
    assert user.wants_notification?(app, :reoccurrence)
  end

  test 'admin_of_team? returns true for admin members' do
    user = users(:one)
    team = teams(:one)
    team.team_members.find_or_create_by!(user: user, role: 'admin')

    assert user.admin_of_team?(team)
  end

  test 'admin_of_team? returns false for non-admin members' do
    user = users(:two)
    team = teams(:one)
    # Ensure user is a member but not admin
    team.team_members.where(user: user).destroy_all
    team.team_members.create!(user: user, role: 'member')

    assert_not user.admin_of_team?(team)
  end

  test 'admin_of_team? returns false for non-members' do
    user = users(:one)
    other_team = Team.create!(name: 'Other Team', owner: users(:two))

    assert_not user.admin_of_team?(other_team)
  end

  # Password History Tests
  test 'saves password to history when password changes' do
    user = users(:one)
    original_digest = user.password_digest

    user.update!(password: 'newpassword123', password_confirmation: 'newpassword123')

    assert_equal 1, user.password_histories.count
    assert_equal original_digest, user.password_histories.first.password_digest
  end

  test 'prevents reusing recently used password' do
    user = users(:one)
    original_password = 'password' # from fixtures

    # Change password first time
    user.update!(password: 'newpassword123', password_confirmation: 'newpassword123')

    # Try to reuse original password
    user.password = original_password
    user.password_confirmation = original_password

    assert_not user.valid?
    assert_includes user.errors[:password], 'has been used recently. Please choose a different password.'
  end

  test 'allows reusing password after history limit exceeded' do
    user = users(:one)
    original_password = 'password' # from fixtures

    # Change password PASSWORD_HISTORY_LIMIT + 1 times
    (User::PASSWORD_HISTORY_LIMIT + 1).times do |i|
      user.update!(password: "newpassword#{i}abc", password_confirmation: "newpassword#{i}abc")
    end

    # Now we should be able to reuse the original password
    user.password = original_password
    user.password_confirmation = original_password

    assert user.valid?, "Expected user to be valid but got errors: #{user.errors.full_messages}"
  end

  test 'keeps only last N passwords in history' do
    user = users(:one)

    # Change password more times than the limit
    (User::PASSWORD_HISTORY_LIMIT + 3).times do |i|
      user.update!(password: "testpassword#{i}x", password_confirmation: "testpassword#{i}x")
    end

    assert_equal User::PASSWORD_HISTORY_LIMIT, user.password_histories.count
  end

  test 'password_previously_used? returns true for recently used password' do
    user = users(:one)
    original_password = 'password'

    user.update!(password: 'newpassword123', password_confirmation: 'newpassword123')

    assert user.password_previously_used?(original_password)
  end

  test 'password_previously_used? returns false for never used password' do
    user = users(:one)

    assert_not user.password_previously_used?('neverusedpassword123')
  end
end
