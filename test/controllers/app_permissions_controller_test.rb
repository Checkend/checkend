require 'test_helper'

class AppPermissionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @other_user = users(:two)
    @app = apps(:one)
    @team = teams(:one)

    # Set up admin membership with owner role
    @team.team_members.find_or_create_by!(user: @admin).update!(role: 'owner')
    TeamAssignment.find_or_create_by!(team: @team, app: @app)

    sign_in_as(@admin)
  end

  test 'new shows grant access form' do
    get new_app_permission_path(@app)
    assert_response :success
    assert_match 'Grant Access', response.body
  end

  test 'new requires app manage permission' do
    # Create a member with no manage permission
    @team.team_members.find_or_create_by!(user: @other_user).update!(role: 'member')
    sign_in_as(@other_user)

    get new_app_permission_path(@app)
    assert_redirected_to root_path
  end

  test 'create grants access to user' do
    permission = permissions(:apps_read)

    assert_difference 'RecordPermission.count', 1 do
      post app_permissions_path(@app), params: {
        user_id: @other_user.id,
        permission_ids: [ permission.id ],
        expires_at: 'never'
      }
    end

    assert_redirected_to app_path(@app)
    record_permission = RecordPermission.last
    assert_equal @other_user, record_permission.user
    assert_equal permission, record_permission.permission
    assert_equal @app, record_permission.record
    assert_equal 'grant', record_permission.grant_type
  end

  test 'create with multiple permissions' do
    read_perm = permissions(:apps_read)
    write_perm = permissions(:apps_write)

    assert_difference 'RecordPermission.count', 2 do
      post app_permissions_path(@app), params: {
        user_id: @other_user.id,
        permission_ids: [ read_perm.id, write_perm.id ],
        expires_at: 'never'
      }
    end

    assert_redirected_to app_path(@app)
  end

  test 'create with expiration' do
    permission = permissions(:apps_read)

    post app_permissions_path(@app), params: {
      user_id: @other_user.id,
      permission_ids: [ permission.id ],
      expires_at: '1_month'
    }

    record_permission = RecordPermission.last
    assert_not_nil record_permission.expires_at
    assert record_permission.expires_at > Time.current
    assert record_permission.expires_at < 32.days.from_now
  end

  test 'create requires app manage permission' do
    @team.team_members.find_or_create_by!(user: @other_user).update!(role: 'member')
    sign_in_as(@other_user)

    post app_permissions_path(@app), params: {
      user_id: @admin.id,
      permission_ids: [ permissions(:apps_read).id ]
    }

    assert_redirected_to root_path
  end

  test 'destroy revokes all access for user' do
    permission = permissions(:apps_read)
    RecordPermission.create!(
      user: @other_user,
      permission: permission,
      record: @app,
      grant_type: 'grant',
      granted_by: @admin
    )

    assert_difference 'RecordPermission.count', -1 do
      delete app_permission_path(@app, @other_user.id)
    end

    assert_redirected_to app_path(@app)
  end

  test 'destroy requires app manage permission' do
    @team.team_members.find_or_create_by!(user: @other_user).update!(role: 'member')
    sign_in_as(@other_user)

    delete app_permission_path(@app, @admin.id)
    assert_redirected_to root_path
  end
end
