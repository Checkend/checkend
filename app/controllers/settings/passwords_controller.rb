class Settings::PasswordsController < ApplicationController
  def edit
  end

  def update
    if params[:password].blank?
      flash.now[:alert] = "New password can't be blank."
      return render :edit, status: :unprocessable_entity
    end

    if Current.user.authenticate(params[:current_password])
      if Current.user.update(password_params)
        redirect_to edit_settings_password_path, notice: "Password updated successfully."
      else
        flash.now[:alert] = "Password could not be updated."
        render :edit, status: :unprocessable_entity
      end
    else
      flash.now[:alert] = "Current password is incorrect."
      render :edit, status: :unprocessable_entity
    end
  end

  private

  def password_params
    params.permit(:password, :password_confirmation)
  end
end
