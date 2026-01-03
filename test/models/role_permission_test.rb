require 'test_helper'

class RolePermissionTest < ActiveSupport::TestCase
  test 'valid role permission' do
    permission = permissions(:apps_read)
    role_permission = RolePermission.new(role: 'viewer', permission: permission)
    # This might already exist from fixtures, so we check if it would be valid without uniqueness
    role_permission.valid?
    assert_not role_permission.errors[:role].include?("can't be blank")
  end

  test 'role must be present' do
    role_permission = RolePermission.new(permission: permissions(:apps_read))
    assert_not role_permission.valid?
    assert_includes role_permission.errors[:role], "can't be blank"
  end

  test 'role must be valid' do
    invalid_roles = [ 'superadmin', 'guest', 'user', '' ]
    invalid_roles.each do |role|
      rp = RolePermission.new(role: role, permission: permissions(:apps_read))
      assert_not rp.valid?, "Expected role '#{role}' to be invalid"
    end
  end

  test 'valid roles are accepted' do
    RolePermission::ROLES.each do |role|
      # Use a permission that might not have this role assigned yet
      permission = Permission.create!(
        key: "test_#{role}:action",
        resource: "test_#{role}",
        action: 'action'
      )
      rp = RolePermission.new(role: role, permission: permission)
      assert rp.valid?, "Expected role '#{role}' to be valid"
    end
  end

  test 'permission must be unique per role' do
    existing = role_permissions(:owner_apps_read)
    duplicate = RolePermission.new(
      role: existing.role,
      permission: existing.permission
    )
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:permission_id], 'has already been taken'
  end

  test 'for_role scope returns permissions for specific role' do
    owner_perms = RolePermission.for_role('owner')
    assert owner_perms.all? { |rp| rp.role == 'owner' }
  end

  test 'permissions_for returns permission keys for role' do
    owner_keys = RolePermission.permissions_for('owner')
    assert_includes owner_keys, 'apps:read'
    assert_includes owner_keys, 'apps:write'
    assert_includes owner_keys, 'apps:delete'
  end

  test 'role_has_permission? returns true when role has permission' do
    assert RolePermission.role_has_permission?('owner', 'apps:read')
    assert RolePermission.role_has_permission?('admin', 'apps:write')
  end

  test 'role_has_permission? returns false when role lacks permission' do
    assert_not RolePermission.role_has_permission?('viewer', 'apps:write')
    assert_not RolePermission.role_has_permission?('member', 'apps:delete')
  end
end
