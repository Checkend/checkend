class UserSessionsController < ApplicationController
  before_action :require_site_admin!
  before_action :set_user
  before_action :set_session, only: :destroy

  def destroy
    @session.destroy
    redirect_to user_path(@user), notice: 'Session revoked successfully.'
  end

  def destroy_all
    @user.sessions.destroy_all
    redirect_to user_path(@user), notice: 'All sessions revoked successfully.'
  end

  private

  def set_user
    @user = User.friendly.find(params[:user_id])
  end

  def set_session
    @session = @user.sessions.find(params[:id])
  end
end
