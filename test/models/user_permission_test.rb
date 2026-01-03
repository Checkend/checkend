require 'test_helper'

class UserPermissionTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @permission = permissions(:apps_read)
    @team = teams(:one)
  end

  test 'valid user permission with grant' do
    user_permission = UserPermission.new(
      user: @user,
      permission: @permission,
      grant_type: 'grant'
    )
    assert user_permission.valid?
  end

  test 'valid user permission with revoke' do
    user_permission = UserPermission.new(
      user: @user,
      permission: @permission,
      grant_type: 'revoke'
    )
    assert user_permission.valid?
  end

  test 'grant_type must be present' do
    user_permission = UserPermission.new(user: @user, permission: @permission)
    assert_not user_permission.valid?
    assert_includes user_permission.errors[:grant_type], "can't be blank"
  end

  test 'grant_type must be valid' do
    invalid_types = [ 'allow', 'deny', 'yes', 'no' ]
    invalid_types.each do |type|
      up = UserPermission.new(user: @user, permission: @permission, grant_type: type)
      assert_not up.valid?, "Expected grant_type '#{type}' to be invalid"
    end
  end

  test 'team is optional (global permission)' do
    user_permission = UserPermission.new(
      user: @user,
      permission: @permission,
      grant_type: 'grant',
      team: nil
    )
    assert user_permission.valid?
  end

  test 'team can be specified (team-scoped permission)' do
    user_permission = UserPermission.new(
      user: @user,
      permission: @permission,
      grant_type: 'grant',
      team: @team
    )
    assert user_permission.valid?
  end

  test 'permission is unique per user and team' do
    UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant', team: @team)

    duplicate = UserPermission.new(user: @user, permission: @permission, grant_type: 'revoke', team: @team)
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:permission_id], 'has already been taken'
  end

  test 'same permission can exist for different teams' do
    UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant', team: @team)

    other_team = teams(:two)
    other_permission = UserPermission.new(
      user: @user,
      permission: @permission,
      grant_type: 'revoke',
      team: other_team
    )
    assert other_permission.valid?
  end

  test 'grants scope returns only grants' do
    UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant')
    UserPermission.create!(user: @user, permission: permissions(:apps_write), grant_type: 'revoke')

    grants = UserPermission.grants
    assert grants.all?(&:grant?)
  end

  test 'revocations scope returns only revocations' do
    UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant')
    UserPermission.create!(user: @user, permission: permissions(:apps_write), grant_type: 'revoke')

    revocations = UserPermission.revocations
    assert revocations.all?(&:revoke?)
  end

  test 'active scope excludes expired permissions' do
    active = UserPermission.create!(
      user: @user,
      permission: @permission,
      grant_type: 'grant',
      expires_at: 1.day.from_now
    )
    expired = UserPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      grant_type: 'grant',
      expires_at: 1.day.ago
    )

    active_perms = UserPermission.active
    assert_includes active_perms, active
    assert_not_includes active_perms, expired
  end

  test 'active scope includes permissions without expiration' do
    no_expiry = UserPermission.create!(
      user: @user,
      permission: @permission,
      grant_type: 'grant',
      expires_at: nil
    )

    assert_includes UserPermission.active, no_expiry
  end

  test 'grant? returns true for grants' do
    up = UserPermission.new(grant_type: 'grant')
    assert up.grant?
    assert_not up.revoke?
  end

  test 'revoke? returns true for revocations' do
    up = UserPermission.new(grant_type: 'revoke')
    assert up.revoke?
    assert_not up.grant?
  end

  test 'active? returns true for non-expired permissions' do
    up = UserPermission.new(expires_at: 1.day.from_now)
    assert up.active?
    assert_not up.expired?
  end

  test 'active? returns true for permissions without expiration' do
    up = UserPermission.new(expires_at: nil)
    assert up.active?
    assert_not up.expired?
  end

  test 'expired? returns true for expired permissions' do
    up = UserPermission.new(expires_at: 1.day.ago)
    assert up.expired?
    assert_not up.active?
  end

  test 'global scope returns permissions without team' do
    global = UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant', team: nil)
    team_scoped = UserPermission.create!(user: @user, permission: permissions(:apps_write), grant_type: 'grant', team: @team)

    globals = UserPermission.global
    assert_includes globals, global
    assert_not_includes globals, team_scoped
  end

  test 'for_team scope returns permissions for specific team' do
    team_scoped = UserPermission.create!(user: @user, permission: @permission, grant_type: 'grant', team: @team)
    other_team = teams(:two)
    other_team_scoped = UserPermission.create!(user: @user, permission: permissions(:apps_write), grant_type: 'grant', team: other_team)

    team_perms = UserPermission.for_team(@team)
    assert_includes team_perms, team_scoped
    assert_not_includes team_perms, other_team_scoped
  end
end
