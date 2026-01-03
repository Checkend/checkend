require 'test_helper'

class RecordPermissionTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @permission = permissions(:apps_read)
    @app = apps(:one)
  end

  test 'valid record permission' do
    record_permission = RecordPermission.new(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'grant'
    )
    assert record_permission.valid?
  end

  test 'grant_type must be present' do
    record_permission = RecordPermission.new(
      user: @user,
      permission: @permission,
      record: @app
    )
    assert_not record_permission.valid?
    assert_includes record_permission.errors[:grant_type], "can't be blank"
  end

  test 'grant_type must be valid' do
    invalid_types = [ 'allow', 'deny', 'yes', 'no' ]
    invalid_types.each do |type|
      rp = RecordPermission.new(
        user: @user,
        permission: @permission,
        record: @app,
        grant_type: type
      )
      assert_not rp.valid?, "Expected grant_type '#{type}' to be invalid"
    end
  end

  test 'record_type must be present' do
    record_permission = RecordPermission.new(
      user: @user,
      permission: @permission,
      record_id: @app.id,
      grant_type: 'grant'
    )
    assert_not record_permission.valid?
  end

  test 'record_id must be present' do
    record_permission = RecordPermission.new(
      user: @user,
      permission: @permission,
      record_type: 'App',
      grant_type: 'grant'
    )
    assert_not record_permission.valid?
  end

  test 'permission is unique per user and record' do
    RecordPermission.create!(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'grant'
    )

    duplicate = RecordPermission.new(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'revoke'
    )
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:permission_id], 'has already been taken'
  end

  test 'same permission can exist for different records' do
    RecordPermission.create!(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'grant'
    )

    other_app = apps(:two)
    other_permission = RecordPermission.new(
      user: @user,
      permission: @permission,
      record: other_app,
      grant_type: 'revoke'
    )
    assert other_permission.valid?
  end

  test 'grants scope returns only grants' do
    RecordPermission.create!(user: @user, permission: @permission, record: @app, grant_type: 'grant')
    RecordPermission.create!(user: @user, permission: permissions(:apps_write), record: @app, grant_type: 'revoke')

    grants = RecordPermission.grants
    assert grants.all?(&:grant?)
  end

  test 'revocations scope returns only revocations' do
    RecordPermission.create!(user: @user, permission: @permission, record: @app, grant_type: 'grant')
    RecordPermission.create!(user: @user, permission: permissions(:apps_write), record: @app, grant_type: 'revoke')

    revocations = RecordPermission.revocations
    assert revocations.all?(&:revoke?)
  end

  test 'active scope excludes expired permissions' do
    active = RecordPermission.create!(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'grant',
      expires_at: 1.day.from_now
    )
    expired = RecordPermission.create!(
      user: @user,
      permission: permissions(:apps_write),
      record: @app,
      grant_type: 'grant',
      expires_at: 1.day.ago
    )

    active_perms = RecordPermission.active
    assert_includes active_perms, active
    assert_not_includes active_perms, expired
  end

  test 'for_record scope returns permissions for specific record' do
    app_perm = RecordPermission.create!(user: @user, permission: @permission, record: @app, grant_type: 'grant')
    other_app = apps(:two)
    other_perm = RecordPermission.create!(user: @user, permission: @permission, record: other_app, grant_type: 'grant')

    app_perms = RecordPermission.for_record(@app)
    assert_includes app_perms, app_perm
    assert_not_includes app_perms, other_perm
  end

  test 'for_record_type scope returns permissions for specific type' do
    app_perm = RecordPermission.create!(user: @user, permission: @permission, record: @app, grant_type: 'grant')

    app_type_perms = RecordPermission.for_record_type('App')
    assert_includes app_type_perms, app_perm
  end

  test 'grant? returns true for grants' do
    rp = RecordPermission.new(grant_type: 'grant')
    assert rp.grant?
    assert_not rp.revoke?
  end

  test 'revoke? returns true for revocations' do
    rp = RecordPermission.new(grant_type: 'revoke')
    assert rp.revoke?
    assert_not rp.grant?
  end

  test 'polymorphic association works correctly' do
    record_permission = RecordPermission.create!(
      user: @user,
      permission: @permission,
      record: @app,
      grant_type: 'grant'
    )

    assert_equal 'App', record_permission.record_type
    assert_equal @app.id, record_permission.record_id
    assert_equal @app, record_permission.record
  end
end
