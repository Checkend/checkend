require "test_helper"

class TeamTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @team = Team.new(name: "Test Team", owner: @user)
  end

  test "should be valid" do
    assert @team.valid?
  end

  test "should require name" do
    @team.name = nil
    assert_not @team.valid?
    assert_includes @team.errors[:name], "can't be blank"
  end

  test "should belong to owner" do
    @team.save!
    assert_equal @user, @team.owner
  end

  test "should have many team members" do
    @team.save!
    user2 = users(:two) || User.create!(email_address: "test2@example.com", password: "password123")
    @team.team_members.create!(user: user2, role: 'member')
    assert_equal 1, @team.team_members.count
  end

  test "should have many apps through team assignments" do
    @team.save!
    app = App.create!(name: "Test App", slug: "test-app")
    @team.team_assignments.create!(app: app)
    assert_equal 1, @team.apps.count
  end
end

