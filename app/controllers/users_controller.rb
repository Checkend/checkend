class UsersController < ApplicationController
  before_action :require_site_admin!
  before_action :set_user, only: [:show, :edit, :update, :destroy]

  def index
    @users = User.all.order(created_at: :desc)
    @pagy, @users = pagy(@users)
  end

  def show
  end

  def edit
  end

  def update
    if @user.update(user_params)
      redirect_to @user, notice: 'User was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @user.destroy
    redirect_to users_path, notice: 'User was successfully deleted.'
  end

  private

  def set_user
    @user = User.includes(:teams, :owned_teams).find(params[:id])
  end

  def user_params
    params.require(:user).permit(:email_address, :site_admin)
  end
end

