# View helpers for authorization checks
#
# These helpers wrap the permission system for use in views,
# allowing conditional rendering based on user permissions.
#
# Usage in views:
#   <% if can?('apps:write', record: @app) %>
#     <%= link_to 'Edit', edit_app_path(@app) %>
#   <% end %>
#
#   <%= show_if_permitted('apps:delete', record: @app) do %>
#     <%= button_to 'Delete', @app, method: :delete %>
#   <% end %>
#
module AuthorizationHelper
  # Convenience methods for common permission checks

  def can_edit_app?(app)
    can?('apps:write', record: app)
  end

  def can_delete_app?(app)
    can?('apps:delete', record: app)
  end

  def can_manage_app?(app)
    can?('apps:manage', record: app)
  end

  def can_edit_problem?(problem)
    can?('problems:write', record: problem.app)
  end

  def can_delete_problem?(problem)
    can?('problems:delete', record: problem.app)
  end

  def can_manage_team?(team)
    can?('teams:manage_members', team: team)
  end

  def can_invite_to_team?(team)
    can?('teams:manage_invitations', team: team)
  end

  # Renders content only if the user has the specified permission
  # @param permission_key [String] The permission to check
  # @param record [ActiveRecord::Base, nil] Optional record context
  # @param team [Team, nil] Optional team context
  # @yield The content to render if permitted
  # @return [String, nil] The rendered content or nil
  def show_if_permitted(permission_key, record: nil, team: nil, &block)
    return unless can?(permission_key, record: record, team: team)

    capture(&block)
  end

  # Renders content only if the user lacks the specified permission
  # Useful for showing "request access" or "upgrade" prompts
  def show_unless_permitted(permission_key, record: nil, team: nil, &block)
    return if can?(permission_key, record: record, team: team)

    capture(&block)
  end

  # Returns CSS classes based on permission
  # Useful for disabling buttons or changing styles
  def permission_classes(permission_key, record: nil, team: nil, permitted: '', denied: 'opacity-50 cursor-not-allowed')
    can?(permission_key, record: record, team: team) ? permitted : denied
  end

  # Returns disabled attribute if user lacks permission
  def disabled_unless_permitted(permission_key, record: nil, team: nil)
    can?(permission_key, record: record, team: team) ? {} : { disabled: true }
  end
end
