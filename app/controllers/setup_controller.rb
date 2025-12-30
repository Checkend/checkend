# frozen_string_literal: true

class SetupController < ApplicationController
  layout 'auth'

  # Skip authentication for all setup actions
  allow_unauthenticated_access

  # Skip sidebar loading (no user exists yet)
  skip_before_action :load_sidebar_apps

  # Ensure setup is still needed (defense in depth beyond route constraint)
  before_action :ensure_setup_required

  # Validate session data for steps that require previous steps
  before_action :require_admin_in_session, only: %i[team create_team app create_app]
  before_action :require_team_in_session, only: %i[app create_app]
  before_action :require_setup_in_progress_or_admin, only: %i[complete]

  # Step 1: Create admin account
  def index
    @user = User.new
  end

  def create_admin
    @user = User.new(admin_params)
    @user.site_admin = true

    if @user.save
      session[:setup_admin_id] = @user.id
      session[:setup_admin_password] = admin_params[:password]
      redirect_to setup_team_path
    else
      render :index, status: :unprocessable_entity
    end
  end

  # Step 2: Create first team
  def team
    @team = Team.new
  end

  def create_team
    admin_user = User.find(session[:setup_admin_id])
    @team = Team.new(team_params)
    @team.owner = admin_user

    if @team.save
      @team.team_members.create!(user: admin_user, role: 'admin')
      session[:setup_team_id] = @team.id
      redirect_to setup_app_path
    else
      render :team, status: :unprocessable_entity
    end
  end

  # Step 3: Create first app
  def app
    @app = App.new
  end

  def create_app
    team = Team.find(session[:setup_team_id])
    @app = App.new(app_params)

    ActiveRecord::Base.transaction do
      @app.save!
      TeamAssignment.create!(team: team, app: @app)
      session[:setup_app_id] = @app.id
    end

    redirect_to setup_complete_path
  rescue ActiveRecord::RecordInvalid
    render :app, status: :unprocessable_entity
  end

  # Step 4: Show completion with ingestion key
  def complete
    if setup_in_progress?
      # Fresh setup flow - use session data
      @user = User.find(session[:setup_admin_id])
      @team = Team.find(session[:setup_team_id])
      @app = App.find(session[:setup_app_id])
      @password = session[:setup_admin_password]

      # Start session for the admin user
      start_new_session_for(@user)

      # Clear setup session data
      session.delete(:setup_admin_id)
      session.delete(:setup_team_id)
      session.delete(:setup_app_id)
      session.delete(:setup_admin_password)
    else
      # Admin viewing after setup - show first app
      @user = Current.user
      @team = @user.teams.first
      @app = @user.accessible_apps.first
      @viewing_after_setup = true
    end
  end

  private

  def ensure_setup_required
    # Setup is complete when users exist AND at least one has logged in
    # Exception: site admins can view the complete page
    return if request.path == '/setup/complete' && authenticated_site_admin?

    redirect_to root_path if User.exists? && Session.exists?
  end

  def setup_in_progress?
    session[:setup_admin_id].present? &&
      session[:setup_team_id].present? &&
      session[:setup_app_id].present?
  end

  def require_setup_in_progress_or_admin
    return if setup_in_progress?
    return if authenticated_site_admin?

    redirect_to setup_path, alert: 'Please complete the setup wizard.'
  end

  def authenticated_site_admin?
    resume_session
    Current.user&.site_admin?
  end

  def require_admin_in_session
    return if session[:setup_admin_id] && User.exists?(session[:setup_admin_id])

    redirect_to setup_path, alert: 'Please start from the beginning.'
  end

  def require_team_in_session
    return if session[:setup_team_id] && Team.exists?(session[:setup_team_id])

    redirect_to setup_team_path, alert: 'Please create a team first.'
  end

  def require_app_in_session
    return if session[:setup_app_id] && App.exists?(session[:setup_app_id])

    redirect_to setup_app_path, alert: 'Please create an app first.'
  end

  def admin_params
    params.require(:user).permit(:email_address, :password, :password_confirmation)
  end

  def team_params
    params.require(:team).permit(:name)
  end

  def app_params
    params.require(:app).permit(:name, :environment)
  end
end
