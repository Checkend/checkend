class TeamMembersController < ApplicationController
  before_action :set_team
  before_action :require_team_admin!, only: [ :create, :update, :destroy ]
  before_action :set_breadcrumbs, only: [ :index ]

  def index
    @team_members = @team.team_members.includes(:user).order(role: :desc, created_at: :asc)
  end

  def create
    user = User.find_by(email_address: params[:email_address])
    return redirect_to team_team_members_path(@team), alert: 'User not found.' unless user

    team_member = @team.team_members.build(user: user, role: params[:role] || 'member')

    if team_member.save
      redirect_to team_team_members_path(@team), notice: 'Team member added successfully.'
    else
      redirect_to team_team_members_path(@team), alert: team_member.errors.full_messages.join(', ')
    end
  end

  def update
    team_member = @team.team_members.find(params[:id])
    team_member.role = params[:role] if params[:role].present?

    if team_member.save
      redirect_to team_team_members_path(@team), notice: 'Team member updated successfully.'
    else
      redirect_to team_team_members_path(@team), alert: team_member.errors.full_messages.join(', ')
    end
  end

  def destroy
    team_member = @team.team_members.find(params[:id])
    # Prevent removing the last admin
    if team_member.admin? && @team.team_members.admin.count <= 1
      redirect_to team_team_members_path(@team), alert: 'Cannot remove the last admin from the team.'
    else
      team_member.destroy
      redirect_to team_team_members_path(@team), notice: 'Team member removed successfully.'
    end
  end

  private

  def set_team
    @team = Current.user.teams.friendly.find(params[:team_id])
  rescue ActiveRecord::RecordNotFound
    @team = Current.user.owned_teams.friendly.find(params[:team_id])
    raise ActiveRecord::RecordNotFound unless @team
  end

  def require_team_admin!
    return if can_manage_team_assignment?(@team)

    redirect_to team_path(@team), alert: 'You must be a team admin to perform this action.'
  end

  def set_breadcrumbs
    add_breadcrumb 'Teams', teams_path
    add_breadcrumb @team.name, team_path(@team)
    add_breadcrumb 'Members'
  end
end
