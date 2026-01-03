class Settings::SessionsController < ApplicationController
  before_action :set_session, only: [ :destroy ]

  def destroy
    if @session.current?(Current.session)
      redirect_to settings_profile_path, alert: "You can't revoke your current session. Use sign out instead."
    else
      @session.destroy
      redirect_to settings_profile_path, notice: 'Session revoked successfully.'
    end
  end

  def destroy_all_other
    Current.user.sessions.where.not(id: Current.session.id).destroy_all
    redirect_to settings_profile_path, notice: 'All other sessions have been revoked.'
  end

  private

  def set_session
    @session = Current.user.sessions.find(params[:id])
  end
end
