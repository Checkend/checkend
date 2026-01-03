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
    ActiveRecord::Base.transaction do
      # Process permission overrides
      grants = params[:grants] || {}
      revokes = params[:revokes] || {}
      expirations = params[:expirations] || {}

      # Get all permissions for processing
      all_permissions = Permission.all.index_by(&:id)

      # Clear existing user permissions for this team
      @team_member.user.user_permissions.where(team: @team).destroy_all

      # Create grants
      grants.each do |permission_id, value|
        next unless value == '1'

        permission = all_permissions[permission_id.to_i]
        next unless permission

        expires_at = parse_expiration(expirations["grant_#{permission_id}"])

        @team_member.user.user_permissions.create!(
          permission: permission,
          team: @team,
          grant_type: 'grant',
          granted_by: Current.user,
          expires_at: expires_at
        )
      end

      # Create revokes
      revokes.each do |permission_id, value|
        next unless value == '1'

        permission = all_permissions[permission_id.to_i]
        next unless permission

        @team_member.user.user_permissions.create!(
          permission: permission,
          team: @team,
          grant_type: 'revoke',
          granted_by: Current.user,
          expires_at: nil
        )
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

  def parse_expiration(value)
    return nil if value.blank? || value == 'never'

    case value
    when '1_day'
      1.day.from_now
    when '1_week'
      1.week.from_now
    when '1_month'
      1.month.from_now
    when '3_months'
      3.months.from_now
    else
      # Try to parse as date
      Date.parse(value).end_of_day
    end
  rescue ArgumentError
    nil
  end
end
