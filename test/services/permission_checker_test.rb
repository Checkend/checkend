require 'test_helper'

class PermissionCheckerTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @other_user = users(:two)
    @app = apps(:one)
    @team = teams(:one)

    # Set up team membership with owner role
    @team_member = @team.team_members.find_by(user: @user)
    @team_member&.update!(role: 'owner')

    # Ensure app is assigned to team
    TeamAssignment.find_or_create_by!(team: @team, app: @app)

    @checker = PermissionChecker.new(@user)
  end

  # Site admin tests
  test 'site admin has all permissions' do
    admin = users(:one)
    admin.update!(site_admin: true)
    checker = PermissionChecker.new(admin)

    assert checker.can?('apps:read')
    assert checker.can?('apps:write')
    assert checker.can?('apps:delete')
    assert checker.can?('nonexistent:permission') # Even invalid permissions
  end

  test 'site admin has permissions for any record' do
    admin = users(:one)
    admin.update!(site_admin: true)
    checker = PermissionChecker.new(admin)

    assert checker.can?('apps:read', record: @app)
    assert checker.can?('apps:delete', record: @app)
  end

  # Nil user tests
  test 'nil user has no permissions' do
    checker = PermissionChecker.new(nil)
    assert_not checker.can?('apps:read')
  end

  # Role-based permission tests
  test 'owner has all role permissions' do
    @team_member.update!(role: 'owner')

    assert @checker.can?('apps:read', record: @app)
    assert @checker.can?('apps:write', record: @app)
    assert @checker.can?('apps:delete', record: @app)
    assert @checker.can?('teams:manage_members', team: @team)
  end

  test 'admin has admin role permissions' do
    @team_member.update!(role: 'admin')

    assert @checker.can?('apps:read', record: @app)
    assert @checker.can?('apps:write', record: @app)
    assert @checker.can?('apps:delete', record: @app)
    assert @checker.can?('teams:manage_members', team: @team)
  end

  test 'developer has developer role permissions' do
    @team_member.update!(role: 'developer')

    assert @checker.can?('apps:read', record: @app)
    assert @checker.can?('apps:write', record: @app)
    assert_not @checker.can?('apps:delete', record: @app)
    assert_not @checker.can?('teams:manage_members', team: @team)
  end

  test 'member has member role permissions' do
    @team_member.update!(role: 'member')

    assert @checker.can?('apps:read', record: @app)
    assert_not @checker.can?('apps:write', record: @app)
    assert_not @checker.can?('apps:delete', record: @app)
  end

  test 'viewer has limited permissions' do
    @team_member.update!(role: 'viewer')

    assert @checker.can?('apps:read', record: @app)
    assert @checker.can?('problems:read', record: @app)
    assert_not @checker.can?('apps:write', record: @app)
    assert_not @checker.can?('problems:write', record: @app)
  end

  # User without team membership
  test 'user without team membership has no permissions for app' do
    # Create a new user with no team memberships
    new_user = User.create!(
      email_address: 'no_team@example.com',
      password: 'password123'
    )
    checker = PermissionChecker.new(new_user)
    assert_not checker.can?('apps:read', record: @app)
  end

  # User permission override tests
  test 'user permission grant overrides role default' do
    @team_member.update!(role: 'viewer') # Viewers can't write

    # Grant apps:write to this user
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      grant_type: 'grant'
    )

    assert @checker.can?('apps:write', record: @app)
  end

  test 'user permission revoke overrides role default' do
    @team_member.update!(role: 'owner') # Owners can delete

    # Revoke apps:delete from this user
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_delete),
      grant_type: 'revoke'
    )

    assert_not @checker.can?('apps:delete', record: @app)
  end

  test 'team-specific user permission takes precedence over global' do
    # Global grant
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_delete),
      grant_type: 'grant',
      team: nil
    )

    # Team-specific revoke
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_delete),
      grant_type: 'revoke',
      team: @team
    )

    # When checking with team context, team-specific wins
    assert_not @checker.can?('apps:delete', team: @team)
  end

  test 'expired user permission is ignored' do
    @team_member.update!(role: 'viewer')

    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      grant_type: 'grant',
      expires_at: 1.day.ago
    )

    assert_not @checker.can?('apps:write', record: @app)
  end

  test 'non-expired user permission is applied' do
    @team_member.update!(role: 'viewer')

    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      grant_type: 'grant',
      expires_at: 1.day.from_now
    )

    assert @checker.can?('apps:write', record: @app)
  end

  # Record permission override tests
  test 'record permission grant overrides everything' do
    @team_member.update!(role: 'viewer')

    # Revoke at user level
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      grant_type: 'revoke'
    )

    # But grant at record level
    RecordPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      record: @app,
      grant_type: 'grant'
    )

    assert @checker.can?('apps:write', record: @app)
  end

  test 'record permission revoke overrides everything' do
    @team_member.update!(role: 'owner')

    # Grant at user level
    UserPermission.create!(
      user: @user,
      permission: permissions(:apps_delete),
      grant_type: 'grant'
    )

    # But revoke at record level
    RecordPermission.create!(
      user: @user,
      permission: permissions(:apps_delete),
      record: @app,
      grant_type: 'revoke'
    )

    assert_not @checker.can?('apps:delete', record: @app)
  end

  test 'expired record permission is ignored' do
    @team_member.update!(role: 'viewer')

    RecordPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      record: @app,
      grant_type: 'grant',
      expires_at: 1.day.ago
    )

    assert_not @checker.can?('apps:write', record: @app)
  end

  # can_any? and can_all? tests
  test 'can_any? returns true if any permission is granted' do
    @team_member.update!(role: 'viewer')

    assert @checker.can_any?('apps:read', 'apps:write', record: @app)
    assert_not @checker.can_any?('apps:write', 'apps:delete', record: @app)
  end

  test 'can_all? returns true only if all permissions are granted' do
    @team_member.update!(role: 'owner')

    assert @checker.can_all?('apps:read', 'apps:write', record: @app)
    assert @checker.can_all?('apps:read', 'apps:write', 'apps:delete', record: @app)
  end

  test 'can_all? returns false if any permission is missing' do
    @team_member.update!(role: 'developer')

    assert_not @checker.can_all?('apps:read', 'apps:write', 'apps:delete', record: @app)
  end

  # Invalid permission tests
  test 'nonexistent permission returns false' do
    assert_not @checker.can?('nonexistent:permission')
  end

  # Highest role tests
  test 'user with multiple team memberships uses highest role' do
    other_team = teams(:two)
    TeamMember.create!(team: other_team, user: @user, role: 'viewer')
    TeamAssignment.find_or_create_by!(team: other_team, app: @app)

    @team_member.update!(role: 'owner')

    # Should use owner role (highest) for the app
    assert @checker.can?('apps:delete', record: @app)
  end
end
