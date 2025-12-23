require "test_helper"

class TeamMembersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @other_user = users(:two)
    sign_in_as(@user)
    @team = teams(:one)
    # Ensure user is admin
    @team.team_members.find_or_create_by!(user: @user, role: 'admin')
  end

  test "should get index" do
    get team_team_members_url(@team)
    assert_response :success
  end

  test "should create team member" do
    # Ensure user is not already a member
    @team.team_members.where(user: @other_user).destroy_all

    assert_difference("TeamMember.count") do
      post team_team_members_url(@team), params: { email_address: @other_user.email_address, role: 'member' }
    end

    assert_redirected_to team_team_members_url(@team)
    assert @team.team_members.exists?(user: @other_user)
  end

  test "should update team member role" do
    # Ensure user is not already a member
    @team.team_members.where(user: @other_user).destroy_all
    member = @team.team_members.create!(user: @other_user, role: 'member')
    patch team_team_member_url(@team, member), params: { role: 'admin' }
    assert_redirected_to team_team_members_url(@team)
    member.reload
    assert_equal 'admin', member.role
  end

  test "should destroy team member" do
    # Ensure user is not already a member
    @team.team_members.where(user: @other_user).destroy_all
    member = @team.team_members.create!(user: @other_user, role: 'member')
    assert_difference("TeamMember.count", -1) do
      delete team_team_member_url(@team, member)
    end

    assert_redirected_to team_team_members_url(@team)
  end

  test "should not allow non-admin to manage members" do
    sign_in_as(@other_user)
    @team.team_members.find_or_create_by!(user: @other_user, role: 'member')

    assert_no_difference("TeamMember.count") do
      post team_team_members_url(@team), params: { email_address: "new@example.com", role: 'member' }
    end
  end

  private

  def sign_in_as(user)
    post session_path, params: { email_address: user.email_address, password: "password" }
  end
end

