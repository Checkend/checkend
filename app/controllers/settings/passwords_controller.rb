class Settings::PasswordsController < ApplicationController
  before_action :set_breadcrumbs, only: [ :edit ]

  def edit
  end

  def update
    if params[:password].blank?
      flash.now[:alert] = "New password can't be blank."
      return render :edit, status: :unprocessable_entity
    end

    if Current.user.authenticate(params[:current_password])
      if Current.user.update(password_params)
        redirect_to settings_profile_path, notice: 'Password updated successfully.'
      else
        flash.now[:alert] = Current.user.errors.full_messages.first || 'Password could not be updated.'
        render :edit, status: :unprocessable_entity
      end
    else
      flash.now[:alert] = 'Current password is incorrect.'
      render :edit, status: :unprocessable_entity
    end
  end

  def verify
    if Current.user.authenticate(params[:current_password])
      render json: { valid: true }
    else
      render json: { valid: false }
    end
  end

  private

  def password_params
    params.permit(:password, :password_confirmation)
  end

  def set_breadcrumbs
    add_breadcrumb 'Settings', settings_profile_path
    add_breadcrumb 'Change Password'
  end
end
