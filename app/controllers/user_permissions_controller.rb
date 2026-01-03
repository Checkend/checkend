class UserPermissionsController < ApplicationController
  before_action :require_site_admin!
  before_action :set_user

  def edit
    @permissions = Permission.order(:resource, :action)
    @user_permissions = @user.user_permissions.where(team: nil).includes(:permission)

    render layout: false
  end

  def update
    checked_ids = (params[:permissions] || {}).keys.map(&:to_i)

    ActiveRecord::Base.transaction do
      # Clear existing site-wide user permissions (not team-scoped ones)
      @user.user_permissions.where(team: nil).destroy_all

      Permission.find_each do |perm|
        is_checked = checked_ids.include?(perm.id)

        # For site-wide permissions, we only create grants (no role defaults to compare against)
        if is_checked
          @user.user_permissions.create!(
            permission: perm,
            team: nil,
            grant_type: 'grant',
            granted_by: Current.user
          )
        end
      end
    end

    redirect_to @user, notice: 'Permissions updated successfully.'
  rescue ActiveRecord::RecordInvalid => e
    redirect_to @user, alert: "Failed to update permissions: #{e.message}"
  end

  private

  def set_user
    @user = User.friendly.find(params[:user_id])
  end
end
