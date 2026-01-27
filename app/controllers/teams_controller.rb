class TeamsController < ApplicationController
  before_action :set_team, only: [ :show, :edit, :update, :destroy, :assign_app, :remove_app_assignment ]
  before_action :set_breadcrumbs, only: [ :index, :show ]

  def index
    @teams = Current.user.teams.includes(:owner, :team_members).order(created_at: :desc)
    @owned_teams = Current.user.owned_teams.includes(:team_members).order(created_at: :desc)
  end

  def show
  end

  def new
    @team = Team.new
  end

  def create
    @team = Team.new(team_params)
    @team.owner = Current.user

    if @team.save
      # Add owner as admin team member
      @team.team_members.create!(user: Current.user, role: 'admin')
      redirect_to @team, notice: 'Team was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @team.update(team_params)
      redirect_to @team, notice: 'Team was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    if @team.owner == Current.user
      @team.destroy
      redirect_to teams_path, notice: 'Team was successfully deleted.'
    else
      redirect_to @team, alert: 'Only the team owner can delete the team.'
    end
  end

  def assign_app
    require_team_admin!(@team)

    app = accessible_apps.find_by!(slug: params[:app_id])
    @team.team_assignments.find_or_create_by!(app: app)
    redirect_to @team, notice: 'App assigned successfully.'
  rescue ActiveRecord::RecordNotFound
    redirect_to @team, alert: 'App not found or you do not have access.'
  end

  def remove_app_assignment
    require_team_admin!(@team)

    app = App.find_by!(slug: params[:app_id])
    @team.team_assignments.where(app: app).destroy_all
    redirect_to @team, notice: 'App removed from team.'
  rescue ActiveRecord::RecordNotFound
    redirect_to @team, alert: 'App not found.'
  end

  private

  def set_team
    @team = Current.user.teams.friendly.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    @team = Current.user.owned_teams.friendly.find(params[:id])
    raise ActiveRecord::RecordNotFound unless @team
  end

  def team_params
    params.require(:team).permit(:name)
  end

  def set_breadcrumbs
    case action_name
    when 'index'
      add_breadcrumb 'Teams'
    when 'show'
      add_breadcrumb 'Teams', teams_path
      add_breadcrumb @team.name
    end
  end
end
