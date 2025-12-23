require "test_helper"

class TeamAssignmentTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @team = teams(:one) || Team.create!(name: "Test Team", owner: @user)
    # Use a different app to avoid fixture conflicts
    @app = App.create!(name: "Test App", slug: "test-app-#{SecureRandom.hex(4)}")
    @team_assignment = TeamAssignment.new(team: @team, app: @app)
  end

  test "should be valid" do
    assert @team_assignment.valid?
  end

  test "should validate uniqueness of team and app" do
    @team_assignment.save!
    duplicate = TeamAssignment.new(team: @team, app: @app)
    assert_not duplicate.valid?
  end
end

