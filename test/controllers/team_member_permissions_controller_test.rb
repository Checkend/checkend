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

  test 'update grants permission when checked and role does not provide' do
    # apps:delete is not granted by member role
    permission = permissions(:apps_delete)
    role_permission_ids = RolePermission.where(role: 'member').pluck(:permission_id)

    # Include role defaults + the extra permission we want to grant
    permissions_to_check = role_permission_ids.index_with { '1' }
    permissions_to_check[permission.id.to_s] = '1'

    assert_difference 'UserPermission.count', 1 do
      patch team_team_member_permissions_path(@team, @member_membership), params: {
        permissions: permissions_to_check
      }
    end

    assert_redirected_to team_team_members_path(@team)
    user_permission = @member_user.user_permissions.last
    assert_equal permission, user_permission.permission
    assert_equal 'grant', user_permission.grant_type
  end

  test 'update revokes permission when unchecked and role provides' do
    # apps:read is granted by member role
    read_permission = permissions(:apps_read)

    # Submit with apps:read unchecked (not in params)
    patch team_team_member_permissions_path(@team, @member_membership), params: {
      permissions: {}
    }

    assert_redirected_to team_team_members_path(@team)

    # Should have revoke records for all role-granted permissions
    revoke = @member_user.user_permissions.find_by(permission: read_permission, team: @team)
    assert_not_nil revoke
    assert_equal 'revoke', revoke.grant_type
  end

  test 'update creates no permission when checkbox matches role default' do
    # apps:read is granted by member role, so checking it should create no record
    read_permission = permissions(:apps_read)
    role_permission_ids = RolePermission.where(role: 'member').pluck(:permission_id)

    # Submit with exactly what role grants
    patch team_team_member_permissions_path(@team, @member_membership), params: {
      permissions: role_permission_ids.index_with { '1' }
    }

    assert_redirected_to team_team_members_path(@team)
    # No user permissions should be created when matching role defaults
    assert_equal 0, @member_user.user_permissions.where(team: @team).count
  end

  test 'update clears previous permissions for team' do
    permission = permissions(:apps_read)
    @member_user.user_permissions.create!(
      permission: permission,
      team: @team,
      grant_type: 'grant',
      granted_by: @admin
    )

    role_permission_ids = RolePermission.where(role: 'member').pluck(:permission_id)

    # Submit with role defaults (which includes apps:read)
    patch team_team_member_permissions_path(@team, @member_membership), params: {
      permissions: role_permission_ids.index_with { '1' }
    }

    # Previous grant should be cleared, no new permissions needed
    assert_equal 0, @member_user.user_permissions.where(team: @team).count
  end

  test 'update requires team admin' do
    sign_in_as(@member_user)
    patch team_team_member_permissions_path(@team, @admin_membership), params: {
      permissions: {}
    }
    assert_response :not_found
  end
end
