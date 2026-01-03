module Authorizable
  extend ActiveSupport::Concern

  # Custom error for authorization failures
  class NotAuthorizedError < StandardError; end

  included do
    helper_method :can_access_app?, :can_manage_team_assignment?, :site_admin?,
                  :viewing_as_site_admin?, :viewing_unassigned_app?, :can?
  end

  private

  # Returns the permission checker instance for the current user
  # Uses cached version for better performance
  def permission_checker
    @permission_checker ||= CachedPermissionChecker.new(Current.user)
  end

  # Check if the current user has a specific permission
  # @param permission_key [String] The permission key (e.g., 'apps:read')
  # @param record [ActiveRecord::Base, nil] Optional record to check permission against
  # @param team [Team, nil] Optional team context
  # @return [Boolean] Whether the user has the permission
  def can?(permission_key, record: nil, team: nil)
    return false unless Current.user
    return true if site_admin?

    permission_checker.can?(permission_key, record: record, team: team)
  end

  # Enforce a permission, raising NotAuthorizedError if denied
  # @param permission_key [String] The permission key
  # @param record [ActiveRecord::Base, nil] Optional record
  # @param team [Team, nil] Optional team context
  # @raise [NotAuthorizedError] If the user lacks the permission
  def authorize!(permission_key, record: nil, team: nil)
    return if can?(permission_key, record: record, team: team)

    raise NotAuthorizedError, "Not authorized to perform #{permission_key}"
  end

  # Enforce a permission, handling the error gracefully
  # Returns false and renders error response if denied
  # @return [Boolean] true if authorized, false if denied (and response rendered)
  def require_permission!(permission_key, record: nil, team: nil)
    authorize!(permission_key, record: record, team: team)
    true
  rescue NotAuthorizedError
    handle_authorization_error(permission_key)
    false
  end

  # Handle authorization errors based on request format
  def handle_authorization_error(permission_key = nil)
    message = 'You do not have permission to perform this action.'

    if request.format.json?
      render json: { error: 'forbidden', message: message }, status: :forbidden
    else
      redirect_back fallback_location: root_path, alert: message
    end
  end

  # Legacy method - now uses permission system for unassigned apps
  # but keeps backwards compatibility
  def can_access_app?(app)
    return false unless Current.user
    # Site admins can access all apps
    return true if site_admin?
    # Unassigned apps are viewable by everyone
    return true if app.teams.empty?
    # Use new permission system for team-based access
    can?('apps:read', record: app)
  end

  def require_app_access!(app = nil)
    app ||= @app
    return if app && can_access_app?(app)

    raise ActiveRecord::RecordNotFound, 'App not found or access denied'
  end

  def accessible_apps
    return App.none unless Current.user
    # Site admins can see all apps
    return App.all if site_admin?
    # Include user's team apps plus unassigned apps (using subqueries for compatibility)
    user_app_ids = Current.user.accessible_apps.select(:id)
    unassigned_app_ids = App.left_joins(:team_assignments).where(team_assignments: { id: nil }).select(:id)
    App.where(id: user_app_ids).or(App.where(id: unassigned_app_ids))
  end

  def can_manage_team_assignment?(team)
    return false unless Current.user
    return true if site_admin?
    # Use new permission system
    can?('teams:manage_members', team: team)
  end

  def require_team_admin!(team = nil)
    team ||= @team
    return if team && can_manage_team_assignment?(team)

    raise ActiveRecord::RecordNotFound, 'Team not found or you are not an admin'
  end

  def site_admin?
    return false unless Current.user
    Current.user.site_admin?
  end

  def require_site_admin!
    return if site_admin?

    raise ActiveRecord::RecordNotFound, 'Access denied. Site admin required.'
  end

  # Returns true if user is viewing app only because they're a site admin
  # (not a team member)
  def viewing_as_site_admin?(app)
    return false unless site_admin?
    return false if app.teams.empty?
    !app.accessible_by?(Current.user)
  end

  # Returns true if app has no team assignments
  def viewing_unassigned_app?(app)
    app.teams.empty?
  end
end
