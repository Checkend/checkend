# frozen_string_literal: true

# Route constraint that matches when setup is needed or in progress.
# Setup is considered "complete" when a user has been created AND logged in (has sessions).
# This allows the multi-step wizard to continue even after the admin user is created.
class SetupRequiredConstraint
  def self.matches?(request)
    # Allow if no users exist (fresh install)
    return true if User.count.zero?

    # Allow if users exist but no one has logged in yet (setup in progress)
    # The complete step creates a session, so once that happens, setup is done
    return true if Session.count.zero?

    # Allow authenticated site admins to view the complete page (read-only)
    request.path == '/setup/complete' && authenticated_site_admin?(request)
  end

  def self.authenticated_site_admin?(request)
    session_id = request.cookie_jar.signed[:session_id]
    return false unless session_id

    session = Session.find_by(id: session_id)
    session&.user&.site_admin?
  end
end
