class AppsController < ApplicationController
  before_action :set_app, only: [ :show, :edit, :update, :destroy, :regenerate_api_key ]

  def index
    @apps = Current.user.apps.includes(:problems).order(created_at: :desc)
  end

  def show
  end

  def new
    @app = Current.user.apps.build
  end

  def create
    @app = Current.user.apps.build(app_params)

    if @app.save
      redirect_to @app, notice: 'App was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @app.update(app_params)
      redirect_to @app, notice: 'App was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @app.destroy
    redirect_to apps_path, notice: 'App was successfully deleted.'
  end

  def regenerate_api_key
    @app.regenerate_api_key
    redirect_to @app, notice: 'API key was successfully regenerated.'
  end

  private

  def set_app
    @app = Current.user.apps.find_by!(slug: params[:id])
  end

  def app_params
    params.require(:app).permit(:name, :environment)
  end
end
