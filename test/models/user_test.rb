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
    other_team = Team.create!(name: "Other Team", owner: other_user)
    other_team.team_members.create!(user: other_user, role: 'admin')
    other_app = App.create!(name: "Other App", slug: "other-app")
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
    other_team = Team.create!(name: "Other Team", owner: users(:two))

    assert_not user.admin_of_team?(other_team)
  end
end
