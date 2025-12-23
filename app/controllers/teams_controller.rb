class TeamsController < ApplicationController
  before_action :set_team, only: [ :show, :edit, :update, :destroy ]

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
end
