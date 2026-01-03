require 'test_helper'

class PermissionTest < ActiveSupport::TestCase
  test 'valid permission' do
    permission = Permission.new(
      key: 'test:read',
      resource: 'test',
      action: 'read',
      description: 'Test permission'
    )
    assert permission.valid?
  end

  test 'key must be present' do
    permission = Permission.new(resource: 'test', action: 'read')
    assert_not permission.valid?
    assert_includes permission.errors[:key], "can't be blank"
  end

  test 'key must be unique' do
    permission = permissions(:apps_read)
    duplicate = Permission.new(
      key: permission.key,
      resource: 'apps',
      action: 'read'
    )
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:key], 'has already been taken'
  end

  test 'key must match resource:action format' do
    invalid_keys = [ 'invalid', 'APPS:READ', 'apps-read', 'apps:read:extra' ]
    invalid_keys.each do |key|
      permission = Permission.new(key: key, resource: 'apps', action: 'read')
      assert_not permission.valid?, "Expected #{key} to be invalid"
    end
  end

  test 'resource must be present' do
    permission = Permission.new(key: 'test:read', action: 'read')
    assert_not permission.valid?
    assert_includes permission.errors[:resource], "can't be blank"
  end

  test 'action must be present' do
    permission = Permission.new(key: 'test:read', resource: 'test')
    assert_not permission.valid?
    assert_includes permission.errors[:action], "can't be blank"
  end

  test 'for_resource scope returns permissions for specific resource' do
    apps_permissions = Permission.for_resource('apps')
    assert apps_permissions.all? { |p| p.resource == 'apps' }
  end

  test 'system_permissions scope returns system permissions' do
    system_perms = Permission.system_permissions
    assert system_perms.all?(&:system?)
  end

  test 'find_by_key! raises when not found' do
    assert_raises(ActiveRecord::RecordNotFound) do
      Permission.find_by_key!('nonexistent:permission')
    end
  end

  test 'find_by_key! returns permission when found' do
    permission = Permission.find_by_key!('apps:read')
    assert_equal 'apps:read', permission.key
  end

  test 'to_s returns key' do
    permission = permissions(:apps_read)
    assert_equal permission.key, permission.to_s
  end
end
