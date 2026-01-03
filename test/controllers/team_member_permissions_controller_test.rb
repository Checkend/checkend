require 'test_helper'

class TeamMemberPermissionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @member_user = users(:two)
    @team = teams(:one)

    # Set up admin membership
    @admin_membership = @team.team_members.find_or_create_by!(user: @admin)
    @admin_membership.update!(role: 'admin')

    # Set up regular member
    @member_membership = @team.team_members.find_or_create_by!(user: @member_user)
    @member_membership.update!(role: 'member')

    sign_in_as(@admin)
  end

  test 'edit shows permissions slide-over' do
    get edit_team_team_member_permissions_path(@team, @member_membership)
    assert_response :success
    assert_match 'Permissions', response.body
  end

  test 'edit requires team admin' do
    sign_in_as(@member_user)
    get edit_team_team_member_permissions_path(@team, @admin_membership)
    assert_response :not_found
  end

  test 'update grants additional permissions' do
    permission = permissions(:apps_delete)

    assert_difference 'UserPermission.count', 1 do
      patch team_team_member_permissions_path(@team, @member_membership), params: {
        grants: { permission.id.to_s => '1' },
        expirations: { "grant_#{permission.id}" => 'never' }
      }
    end

    assert_redirected_to team_team_members_path(@team)
    user_permission = @member_user.user_permissions.last
    assert_equal permission, user_permission.permission
    assert_equal 'grant', user_permission.grant_type
    assert_nil user_permission.expires_at
  end

  test 'update revokes permissions' do
    permission = permissions(:apps_read)

    patch team_team_member_permissions_path(@team, @member_membership), params: {
      revokes: { permission.id.to_s => '1' }
    }

    assert_redirected_to team_team_members_path(@team)
    user_permission = @member_user.user_permissions.last
    assert_equal permission, user_permission.permission
    assert_equal 'revoke', user_permission.grant_type
  end

  test 'update with expiration sets expires_at' do
    permission = permissions(:apps_delete)

    patch team_team_member_permissions_path(@team, @member_membership), params: {
      grants: { permission.id.to_s => '1' },
      expirations: { "grant_#{permission.id}" => '1_week' }
    }

    user_permission = @member_user.user_permissions.last
    assert_not_nil user_permission.expires_at
    assert user_permission.expires_at > Time.current
    assert user_permission.expires_at < 8.days.from_now
  end

  test 'update clears previous permissions for team' do
    permission = permissions(:apps_read)
    @member_user.user_permissions.create!(
      permission: permission,
      team: @team,
      grant_type: 'grant',
      granted_by: @admin
    )

    assert_difference 'UserPermission.count', -1 do
      patch team_team_member_permissions_path(@team, @member_membership), params: {
        grants: {},
        revokes: {}
      }
    end
  end

  test 'update requires team admin' do
    sign_in_as(@member_user)
    patch team_team_member_permissions_path(@team, @admin_membership), params: {
      grants: {}
    }
    assert_response :not_found
  end
end
