class AppsController < ApplicationController
  before_action :set_app, only: [ :show, :edit, :update, :destroy, :regenerate_ingestion_key, :assign_team, :remove_team_assignment, :setup_wizard ]
  before_action :require_app_access!, only: [ :show, :edit, :update, :destroy, :regenerate_ingestion_key ]
  before_action :set_breadcrumbs, only: [ :index, :show, :setup_wizard ]

  def index
    @apps = accessible_apps.includes(:problems).order(created_at: :desc)
  end

  def show
  end

  def new
    @app = App.new
  end

  def create
    @app = App.new(app_params)

    if @app.save
      redirect_to setup_wizard_app_path(@app), notice: 'App was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def setup_wizard
    @teams = Current.user.teams.joins(:team_members)
                      .where(team_members: { user_id: Current.user.id, role: 'admin' })
                      .distinct
  end

  def edit
  end

  def update
    update_params = app_params.to_h
    # Don't update encrypted webhook URLs if blank (keep existing encrypted values)
    update_params.delete('slack_webhook_url') if update_params['slack_webhook_url'].blank?
    update_params.delete('discord_webhook_url') if update_params['discord_webhook_url'].blank?
    update_params.delete('webhook_url') if update_params['webhook_url'].blank?
    update_params.delete('github_token') if update_params['github_token'].blank?

    if @app.update(update_params)
      redirect_to @app, notice: 'App was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @app.destroy
    redirect_to apps_path, notice: 'App was successfully deleted.'
  end

  def regenerate_ingestion_key
    @app.regenerate_ingestion_key
    redirect_to @app, notice: 'Ingestion key was successfully regenerated.'
  end

  def assign_team
    if params[:team_id].present?
      team = Team.friendly.find(params[:team_id])
      require_team_admin!(team)

      @app.team_assignments.find_or_create_by!(team: team)
      redirect_to @app, notice: 'Team assigned successfully.'
    else
      redirect_to @app, notice: 'App created successfully.'
    end
  rescue ActiveRecord::RecordNotFound
    redirect_to @app, alert: 'Team not found or you are not an admin.'
  end

  def remove_team_assignment
    team = Team.friendly.find(params[:team_id])
    require_team_admin!(team)

    @app.team_assignments.where(team: team).destroy_all

    # Reload to get updated team associations
    @app.reload

    # If user still has access to the app (through other teams), redirect to app
    # Otherwise, redirect to apps index since they no longer have access
    if can_access_app?(@app)
      redirect_to @app, notice: 'Team assignment removed successfully.'
    else
      redirect_to apps_path, notice: 'Team assignment removed successfully.'
    end
  rescue ActiveRecord::RecordNotFound
    redirect_to apps_path, alert: 'Team not found or you are not an admin.'
  end

  private

  def set_app
    # For setup_wizard, allow access without team membership
    if action_name == 'setup_wizard'
      @app = App.find_by!(slug: params[:id])
      raise ActiveRecord::RecordNotFound unless @app
      return
    end

    # Try to find app through accessible_apps first
    @app = accessible_apps.find_by(slug: params[:id])

    # If not found, check if it's a newly created app with no teams
    # (created within last 5 minutes - covers setup wizard flow)
    if @app.nil?
      @app = App.find_by(slug: params[:id])
      # Only allow if app has no team assignments AND was created recently
      if @app
        if @app.teams.any? || @app.created_at <= 5.minutes.ago
          @app = nil
        end
      end
    end

    raise ActiveRecord::RecordNotFound unless @app
  end

  def app_params
    params.require(:app).permit(:name, :environment, :notify_on_new_problem, :notify_on_reoccurrence, :slack_webhook_url, :discord_webhook_url, :webhook_url, :github_repository, :github_token, :github_enabled)
  end

  def set_breadcrumbs
    case action_name
    when 'index'
      add_breadcrumb 'Apps'
    when 'show'
      add_breadcrumb 'Apps', apps_path
      add_breadcrumb @app.name
    when 'setup_wizard'
      add_breadcrumb 'Apps', apps_path
      add_breadcrumb @app.name, app_path(@app)
      add_breadcrumb 'Setup'
    end
  end
end
