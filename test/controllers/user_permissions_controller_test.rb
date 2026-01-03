require 'test_helper'

class UserPermissionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:admin)
    @regular_user = users(:one)
    @target_user = users(:two)

    sign_in_as(@admin)
  end

  test 'edit requires site admin' do
    sign_in_as(@regular_user)

    get edit_user_permissions_path(@target_user)
    assert_response :not_found
  end

  test 'edit shows permissions slide-over' do
    get edit_user_permissions_path(@target_user)
    assert_response :success
    assert_match 'Permissions', response.body
  end

  test 'update requires site admin' do
    sign_in_as(@regular_user)

    patch user_permissions_path(@target_user), params: {
      permissions: {}
    }
    assert_response :not_found
  end

  test 'update grants permissions' do
    permission = permissions(:apps_read)

    assert_difference 'UserPermission.count', 1 do
      patch user_permissions_path(@target_user), params: {
        permissions: { permission.id.to_s => '1' }
      }
    end

    assert_redirected_to user_path(@target_user)
    user_permission = @target_user.user_permissions.where(team: nil).last
    assert_equal permission, user_permission.permission
    assert_equal 'grant', user_permission.grant_type
    assert_nil user_permission.team
  end

  test 'update with multiple permissions' do
    read_perm = permissions(:apps_read)
    write_perm = permissions(:apps_write)

    assert_difference 'UserPermission.count', 2 do
      patch user_permissions_path(@target_user), params: {
        permissions: {
          read_perm.id.to_s => '1',
          write_perm.id.to_s => '1'
        }
      }
    end

    assert_redirected_to user_path(@target_user)
  end

  test 'update clears previous site-wide permissions' do
    permission = permissions(:apps_read)
    @target_user.user_permissions.create!(
      permission: permission,
      team: nil,
      grant_type: 'grant',
      granted_by: @admin
    )

    # Submit with no permissions checked
    patch user_permissions_path(@target_user), params: {
      permissions: {}
    }

    assert_redirected_to user_path(@target_user)
    assert_equal 0, @target_user.user_permissions.where(team: nil).count
  end

  test 'update does not affect team-scoped permissions' do
    team = teams(:one)
    permission = permissions(:apps_read)

    # Create a team-scoped permission
    team_permission = @target_user.user_permissions.create!(
      permission: permission,
      team: team,
      grant_type: 'grant',
      granted_by: @admin
    )

    # Update site-wide permissions
    patch user_permissions_path(@target_user), params: {
      permissions: {}
    }

    assert_redirected_to user_path(@target_user)
    # Team-scoped permission should still exist
    assert UserPermission.exists?(team_permission.id)
  end
end
