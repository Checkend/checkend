module Authorizable
  extend ActiveSupport::Concern

  included do
    helper_method :can_access_app?, :can_manage_team_assignment?, :site_admin?
  end

  private

  def can_access_app?(app)
    return false unless Current.user
    # Allow access to apps with no teams only if they were created very recently
    # This covers the "newly created app" workflow before team assignment
    if app.teams.empty?
      return app.created_at > 5.minutes.ago
    end
    app.accessible_by?(Current.user)
  end

  def require_app_access!(app = nil)
    app ||= @app
    return if app && can_access_app?(app)

    raise ActiveRecord::RecordNotFound, 'App not found or access denied'
  end

  def accessible_apps
    return App.none unless Current.user
    Current.user.accessible_apps
  end

  def can_manage_team_assignment?(team)
    return false unless Current.user
    Current.user.admin_of_team?(team)
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
end
