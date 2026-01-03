class TeamMemberPermissionsController < ApplicationController
  before_action :set_team
  before_action :set_team_member
  before_action :require_team_admin!

  def edit
    @permissions = Permission.order(:resource, :action)
    @role_permissions = RolePermission.where(role: @team_member.role).pluck(:permission_id)
    @user_permissions = @team_member.user.user_permissions.where(team: @team).includes(:permission)

    render layout: false
  end

  def update
    role_permission_ids = RolePermission.where(role: @team_member.role).pluck(:permission_id)
    checked_ids = (params[:permissions] || {}).keys.map(&:to_i)

    ActiveRecord::Base.transaction do
      # Clear existing user permissions for this team
      @team_member.user.user_permissions.where(team: @team).destroy_all

      Permission.find_each do |perm|
        is_checked = checked_ids.include?(perm.id)
        role_grants = role_permission_ids.include?(perm.id)

        if is_checked && !role_grants
          # Grant: checked but role doesn't provide
          create_user_permission(perm, 'grant')
        elsif !is_checked && role_grants
          # Revoke: unchecked but role would provide
          create_user_permission(perm, 'revoke')
        end
        # Otherwise: matches role default, no override needed
      end
    end

    redirect_to team_team_members_path(@team), notice: 'Permissions updated successfully.'
  rescue ActiveRecord::RecordInvalid => e
    redirect_to team_team_members_path(@team), alert: "Failed to update permissions: #{e.message}"
  end

  private

  def set_team
    @team = Team.friendly.find(params[:team_id])
  end

  def set_team_member
    @team_member = @team.team_members.find(params[:team_member_id])
  end

  def create_user_permission(permission, grant_type)
    @team_member.user.user_permissions.create!(
      permission: permission,
      team: @team,
      grant_type: grant_type,
      granted_by: Current.user
    )
  end

  def effective_permission?(perm)
    role_grants = @role_permissions.include?(perm.id)
    grant = @user_permissions.find { |up| up.permission_id == perm.id && up.grant? }
    revoke = @user_permissions.find { |up| up.permission_id == perm.id && up.revoke? }

    return false if revoke
    return true if grant
    role_grants
  end
  helper_method :effective_permission?
end
