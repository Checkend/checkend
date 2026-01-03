# Checks if a user has a specific permission
#
# Permission checking follows this hierarchy (highest to lowest priority):
# 1. Site admin bypass - site admins have all permissions
# 2. Record-level permissions - explicit grant/revoke for specific records
# 3. User-level permissions - explicit grant/revoke for user (team-specific, then global)
# 4. Role-based permissions - default permissions based on team role
#
# Usage:
#   checker = PermissionChecker.new(user)
#   checker.can?('apps:read')                    # Check global permission
#   checker.can?('apps:write', record: app)      # Check permission for specific record
#   checker.can?('teams:manage_members', team: team)  # Check team-scoped permission
#
class PermissionChecker
  attr_reader :user

  def initialize(user)
    @user = user
  end

  # Main permission check method
  # @param permission_key [String] The permission key (e.g., 'apps:read')
  # @param record [ActiveRecord::Base, nil] Optional record to check permission against
  # @param team [Team, nil] Optional team context for the permission check
  # @return [Boolean] Whether the user has the permission
  def can?(permission_key, record: nil, team: nil)
    return false unless user

    # Site admins bypass all permission checks
    return true if user.site_admin?

    permission = find_permission(permission_key)
    return false unless permission

    # Check in order of specificity (most specific first)

    # 1. Record-level permissions (highest specificity)
    if record
      record_result = check_record_permission(permission, record)
      return record_result unless record_result.nil?
    end

    # 2. User-level overrides (team-specific, then global)
    user_result = check_user_permission(permission, team)
    return user_result unless user_result.nil?

    # 3. Fall back to role-based permissions
    check_role_permission(permission, team, record)
  end

  # Check multiple permissions (OR logic - any permission grants access)
  def can_any?(*permission_keys, record: nil, team: nil)
    permission_keys.any? { |key| can?(key, record: record, team: team) }
  end

  # Check multiple permissions (AND logic - all permissions required)
  def can_all?(*permission_keys, record: nil, team: nil)
    permission_keys.all? { |key| can?(key, record: record, team: team) }
  end

  # Get all permissions the user has for a given context
  def permissions_for(record: nil, team: nil)
    return [] unless user
    return Permission.pluck(:key) if user.site_admin?

    Permission.all.select do |permission|
      can?(permission.key, record: record, team: team)
    end.map(&:key)
  end

  private

  def find_permission(key)
    Permission.find_by(key: key)
  end

  # Check record-level permission override
  # @return [Boolean, nil] true for grant, false for revoke, nil for no override
  def check_record_permission(permission, record)
    override = user.record_permissions
                   .active
                   .find_by(
                     permission: permission,
                     record_type: record.class.name,
                     record_id: record.id
                   )

    return nil unless override
    override.grant?
  end

  # Check user-level permission override
  # @return [Boolean, nil] true for grant, false for revoke, nil for no override
  def check_user_permission(permission, team)
    # First check team-specific override (higher priority)
    if team
      team_override = user.user_permissions
                          .active
                          .find_by(permission: permission, team: team)
      return team_override.grant? if team_override
    end

    # Then check global override
    global_override = user.user_permissions
                          .active
                          .global
                          .find_by(permission: permission)
    return global_override.grant? if global_override

    nil
  end

  # Check role-based default permissions
  # @return [Boolean] Whether the user's role grants the permission
  def check_role_permission(permission, team, record)
    teams_to_check = determine_relevant_teams(team, record)
    return false if teams_to_check.empty?

    # Get user's highest role across relevant teams
    highest_role = find_highest_role(teams_to_check)
    return false unless highest_role

    # Check if role has this permission
    RolePermission.exists?(role: highest_role, permission: permission)
  end

  # Determine which teams are relevant for the permission check
  def determine_relevant_teams(team, record)
    if team
      [ team ]
    elsif record.respond_to?(:teams)
      record.teams.to_a
    elsif record.respond_to?(:team)
      [ record.team ].compact
    elsif record.respond_to?(:app) && record.app.respond_to?(:teams)
      # For nested resources like problems/notices
      record.app.teams.to_a
    else
      user.teams.to_a
    end
  end

  # Find the highest role the user has across the given teams
  def find_highest_role(teams)
    return nil if teams.empty?

    roles = user.team_members
                .where(team: teams)
                .pluck(:role)

    return nil if roles.empty?

    # Return the role with highest hierarchy level
    roles.min_by { |r| TeamMember::ROLE_HIERARCHY[r] ? -TeamMember::ROLE_HIERARCHY[r] : 0 }
  end
end
