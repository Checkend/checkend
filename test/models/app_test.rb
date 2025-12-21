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
end
