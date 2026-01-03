require 'test_helper'

class TeamMemberTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @other_user = users(:two)
    @team = teams(:one) || Team.create!(name: 'Test Team', owner: @user)
    # Remove existing fixture to avoid conflicts
    TeamMember.where(team: @team, user: @other_user).destroy_all
    # Use a different user to avoid fixture conflicts
    @team_member = TeamMember.new(team: @team, user: @other_user, role: 'member')
  end

  test 'should be valid' do
    assert @team_member.valid?
  end

  test 'should require role' do
    @team_member.role = nil
    assert_not @team_member.valid?
  end

  test 'should validate role inclusion' do
    @team_member.role = 'invalid'
    assert_not @team_member.valid?
  end

  test 'should validate uniqueness of team and user' do
    @team_member.save!
    duplicate = TeamMember.new(team: @team, user: @other_user, role: 'admin')
    assert_not duplicate.valid?
  end

  test 'admin scope should return only admins' do
    # Remove existing members to get clean count
    TeamMember.where(team: @team, user: @other_user).destroy_all
    @team_member.role = 'admin'
    @team_member.save!
    # Create a member (non-admin) for comparison
    member_user = User.create!(email_address: 'member@example.com', password: 'password123')
    TeamMember.create!(team: @team, user: member_user, role: 'member')
    # Count admins for this team specifically
    admin_count = TeamMember.where(team: @team, role: 'admin').count
    assert admin_count >= 1
    # Verify the scope works - should only return admins
    assert TeamMember.admin.where(team: @team).include?(@team_member)
    assert_not TeamMember.admin.where(team: @team).include?(TeamMember.find_by(team: @team, user: member_user))
  end

  test 'admin? should return true for admin role' do
    @team_member.role = 'admin'
    assert @team_member.admin?
  end

  test 'member? should return true for member role' do
    @team_member.role = 'member'
    assert @team_member.member?
  end
end
