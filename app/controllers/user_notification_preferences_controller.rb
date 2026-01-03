class UserNotificationPreferencesController < ApplicationController
  before_action :set_app
  before_action :set_preference
  before_action :require_app_access!
  before_action :set_breadcrumbs, only: [ :edit ]

  def edit
  end

  def update
    @preference.assign_attributes(preference_params)

    if @preference.save
      redirect_to @app, notice: 'Notification preferences updated successfully.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  private

  def set_app
    @app = accessible_apps.find_by!(slug: params[:app_id])
  end

  def set_preference
    @preference = Current.user.user_notification_preferences.find_or_initialize_by(app: @app)
  end

  def preference_params
    params.require(:user_notification_preference).permit(:notify_on_new_problem, :notify_on_reoccurrence)
  end

  def set_breadcrumbs
    add_breadcrumb 'Apps', apps_path
    add_breadcrumb @app.name, app_path(@app)
    add_breadcrumb 'Notification Preferences'
  end
end
