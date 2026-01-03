# Seeds default permissions and role mappings
# Run with: bin/rails db:seed or bin/rails runner "load 'db/seeds/permissions.rb'"

puts 'Seeding permissions...'

# Define all system permissions
PERMISSIONS = [
  # Apps
  { key: 'apps:read', resource: 'apps', action: 'read', description: 'View app details and settings', system: true },
  { key: 'apps:write', resource: 'apps', action: 'write', description: 'Create and update apps', system: true },
  { key: 'apps:delete', resource: 'apps', action: 'delete', description: 'Delete apps', system: true },
  { key: 'apps:manage', resource: 'apps', action: 'manage', description: 'Full app management (assign teams, regenerate keys)', system: true },

  # Problems
  { key: 'problems:read', resource: 'problems', action: 'read', description: 'View problems list and details', system: true },
  { key: 'problems:write', resource: 'problems', action: 'write', description: 'Update problem status (resolve/unresolve)', system: true },
  { key: 'problems:delete', resource: 'problems', action: 'delete', description: 'Delete problems', system: true },

  # Notices
  { key: 'notices:read', resource: 'notices', action: 'read', description: 'View individual error notices', system: true },
  { key: 'notices:delete', resource: 'notices', action: 'delete', description: 'Delete notices', system: true },

  # Teams
  { key: 'teams:read', resource: 'teams', action: 'read', description: 'View team details', system: true },
  { key: 'teams:write', resource: 'teams', action: 'write', description: 'Update team settings', system: true },
  { key: 'teams:delete', resource: 'teams', action: 'delete', description: 'Delete teams', system: true },
  { key: 'teams:manage_members', resource: 'teams', action: 'manage_members', description: 'Add/remove/update team members', system: true },
  { key: 'teams:manage_invitations', resource: 'teams', action: 'manage_invitations', description: 'Send and manage team invitations', system: true },

  # Tags
  { key: 'tags:read', resource: 'tags', action: 'read', description: 'View tags', system: true },
  { key: 'tags:write', resource: 'tags', action: 'write', description: 'Create and update tags', system: true },
  { key: 'tags:delete', resource: 'tags', action: 'delete', description: 'Delete tags', system: true },

  # Users (site admin only by default)
  { key: 'users:read', resource: 'users', action: 'read', description: 'View user profiles', system: true },
  { key: 'users:write', resource: 'users', action: 'write', description: 'Update user details', system: true },
  { key: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users', system: true },
  { key: 'users:manage', resource: 'users', action: 'manage', description: 'Full user management', system: true },

  # API Keys (site admin only by default)
  { key: 'api_keys:read', resource: 'api_keys', action: 'read', description: 'View API keys', system: true },
  { key: 'api_keys:write', resource: 'api_keys', action: 'write', description: 'Create API keys', system: true },
  { key: 'api_keys:delete', resource: 'api_keys', action: 'delete', description: 'Delete/revoke API keys', system: true },

  # Settings (site admin only by default)
  { key: 'settings:read', resource: 'settings', action: 'read', description: 'View system settings', system: true },
  { key: 'settings:write', resource: 'settings', action: 'write', description: 'Modify system settings', system: true }
].freeze

# Create all permissions
PERMISSIONS.each do |attrs|
  Permission.find_or_create_by!(key: attrs[:key]) do |p|
    p.resource = attrs[:resource]
    p.action = attrs[:action]
    p.description = attrs[:description]
    p.system = attrs[:system]
  end
end

puts "Created #{Permission.count} permissions"

# Define role permissions matrix
# Y = permission granted, - = not granted
ROLE_PERMISSIONS = {
  'owner' => %w[
    apps:read apps:write apps:delete apps:manage
    problems:read problems:write problems:delete
    notices:read notices:delete
    teams:read teams:write teams:delete teams:manage_members teams:manage_invitations
    tags:read tags:write tags:delete
  ],
  'admin' => %w[
    apps:read apps:write apps:delete apps:manage
    problems:read problems:write problems:delete
    notices:read notices:delete
    teams:read teams:write teams:manage_members teams:manage_invitations
    tags:read tags:write tags:delete
  ],
  'developer' => %w[
    apps:read apps:write
    problems:read problems:write
    notices:read
    teams:read
    tags:read tags:write
  ],
  'member' => %w[
    apps:read
    problems:read problems:write
    notices:read
    teams:read
    tags:read tags:write
  ],
  'viewer' => %w[
    apps:read
    problems:read
    notices:read
    teams:read
    tags:read
  ]
}.freeze

# Create role permissions
puts 'Seeding role permissions...'

ROLE_PERMISSIONS.each do |role, permission_keys|
  permission_keys.each do |key|
    permission = Permission.find_by!(key: key)
    RolePermission.find_or_create_by!(role: role, permission: permission)
  end
  puts "  #{role}: #{permission_keys.count} permissions"
end

puts "Created #{RolePermission.count} role permissions"
puts 'Permission seeding complete!'
