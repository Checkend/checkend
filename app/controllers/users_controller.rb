class UsersController < ApplicationController
  before_action :require_site_admin!
  before_action :set_user, only: [ :show, :edit, :update, :destroy ]
  before_action :set_breadcrumbs, only: [ :index, :show, :new, :edit ]

  def index
    @users = User.all.order(created_at: :desc)
    @pagy, @users = pagy(@users)
  end

  def show
  end

  def new
    @user = User.new
  end

  def create
    @user = User.new(user_create_params)
    @user.password = user_create_params[:password]

    if @user.save
      redirect_to @user, notice: 'User was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
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
    @user = User.includes(:teams, :owned_teams).friendly.find(params[:id])
  end

  def user_params
    params.require(:user).permit(:email_address, :site_admin)
  end

  def user_create_params
    params.require(:user).permit(:email_address, :password, :site_admin)
  end

  def set_breadcrumbs
    case action_name
    when 'index'
      add_breadcrumb 'Users'
    when 'show'
      add_breadcrumb 'Users', users_path
      add_breadcrumb @user.email_address
    when 'new'
      add_breadcrumb 'Users', users_path
      add_breadcrumb 'New User'
    when 'edit'
      add_breadcrumb 'Users', users_path
      add_breadcrumb @user.email_address, user_path(@user)
      add_breadcrumb 'Edit'
    end
  end
end
