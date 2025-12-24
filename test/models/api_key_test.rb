require 'test_helper'

class ApiKeyTest < ActiveSupport::TestCase
  test 'requires name' do
    api_key = ApiKey.new(permissions: [ 'apps:read' ])
    assert_not api_key.valid?
    assert_includes api_key.errors[:name], "can't be blank"
  end

  test 'requires permissions' do
    api_key = ApiKey.new(name: 'Test Key')
    assert_not api_key.valid?
    assert_includes api_key.errors[:permissions], "can't be blank"
  end

  test 'generates key automatically' do
    api_key = ApiKey.new(name: 'Test Key', permissions: [ 'apps:read' ])
    assert_not_nil api_key.key
    assert api_key.key.length >= 24
  end

  test 'key must be unique' do
    existing = ApiKey.create!(name: 'Existing', permissions: [ 'apps:read' ])
    # has_secure_token generates keys automatically, so we need to manually set it
    api_key = ApiKey.new(name: 'Test Key', permissions: [ 'apps:read' ])
    api_key.key = existing.key
    # The uniqueness is enforced at the database level via unique index
    assert_raises(ActiveRecord::RecordNotUnique) do
      api_key.save(validate: false)
    end
  end

  test 'valid api_key can be created' do
    api_key = ApiKey.new(name: 'Test Key', permissions: [ 'apps:read' ])
    assert api_key.valid?
    assert api_key.save
  end

  test 'permissions must be an array' do
    api_key = ApiKey.new(name: 'Test Key', permissions: 'not-an-array')
    assert_not api_key.valid?
    assert_includes api_key.errors[:permissions], 'must be an array'
  end

  test 'permissions must contain only strings' do
    api_key = ApiKey.new(name: 'Test Key', permissions: [ 'apps:read', 123 ])
    assert_not api_key.valid?
    assert_includes api_key.errors[:permissions], 'must contain only strings'
  end

  test 'has_permission? returns true for active key with permission' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read', 'apps:write' ])
    assert api_key.has_permission?('apps:read')
    assert api_key.has_permission?('apps:write')
  end

  test 'has_permission? returns false for permission not in list' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert_not api_key.has_permission?('apps:write')
    assert_not api_key.has_permission?('problems:read')
  end

  test 'has_permission? returns false for revoked key' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    api_key.revoke!
    assert_not api_key.has_permission?('apps:read')
  end

  test 'has_any_permission? returns true if any permission matches' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert api_key.has_any_permission?('apps:read', 'apps:write')
    assert api_key.has_any_permission?('apps:write', 'apps:read')
  end

  test 'has_any_permission? returns false if no permissions match' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert_not api_key.has_any_permission?('apps:write', 'problems:read')
  end

  test 'active? returns true for non-revoked key' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert api_key.active?
  end

  test 'active? returns false for revoked key' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    api_key.revoke!
    assert_not api_key.active?
  end

  test 'revoke! sets revoked_at timestamp' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert_nil api_key.revoked_at

    api_key.revoke!
    assert_not_nil api_key.revoked_at
    assert api_key.revoked_at <= Time.current
  end

  test 'touch_last_used_at! updates timestamp' do
    api_key = ApiKey.create!(name: 'Test Key', permissions: [ 'apps:read' ])
    assert_nil api_key.last_used_at

    travel 1.hour do
      api_key.touch_last_used_at!
      assert_not_nil api_key.reload.last_used_at
    end
  end

  test 'active scope returns only non-revoked keys' do
    active_key = ApiKey.create!(name: 'Active', permissions: [ 'apps:read' ])
    revoked_key = ApiKey.create!(name: 'Revoked', permissions: [ 'apps:read' ])
    revoked_key.revoke!

    active_keys = ApiKey.active
    assert_includes active_keys, active_key
    assert_not_includes active_keys, revoked_key
  end

  test 'revoked scope returns only revoked keys' do
    active_key = ApiKey.create!(name: 'Active', permissions: [ 'apps:read' ])
    revoked_key = ApiKey.create!(name: 'Revoked', permissions: [ 'apps:read' ])
    revoked_key.revoke!

    revoked_keys = ApiKey.revoked
    assert_includes revoked_keys, revoked_key
    assert_not_includes revoked_keys, active_key
  end
end
