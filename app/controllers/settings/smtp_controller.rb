class Settings::SmtpController < ApplicationController
  include Authorizable

  before_action :require_site_admin!
  before_action :set_smtp_configuration
  before_action :set_breadcrumbs

  def show
  end

  def edit
    redirect_to settings_smtp_path
  end

  def update
    params_hash = smtp_configuration_params.to_h
    # Don't update password if blank (keep existing)
    params_hash.delete('password') if params_hash['password'].blank?

    if @smtp_configuration.update(params_hash)
      redirect_to settings_smtp_path, notice: 'SMTP settings saved successfully.'
    else
      render :show, status: :unprocessable_entity
    end
  end

  def test_connection
    if @smtp_configuration.enabled? && @smtp_configuration.valid?
      begin
        send_test_email
        render json: { success: true, message: 'Test email sent successfully.' }
      rescue => e
        render json: { success: false, error: e.message }, status: :unprocessable_entity
      end
    else
      render json: { success: false, error: 'SMTP configuration is invalid or disabled.' }, status: :unprocessable_entity
    end
  end

  private

  def set_smtp_configuration
    @smtp_configuration = SmtpConfiguration.instance
  end

  def smtp_configuration_params
    params.require(:smtp_configuration).permit(
      :enabled,
      :address,
      :port,
      :user_name,
      :password,
      :authentication,
      :enable_starttls_auto,
      :from_email,
      :reply_to_email
    )
  end

  def set_breadcrumbs
    add_breadcrumb 'Settings', settings_smtp_path
    add_breadcrumb 'Email Settings'
  end

  def send_test_email
    require 'net/smtp'

    reply_to = @smtp_configuration.reply_to_email.presence || @smtp_configuration.from_email
    message = <<~MESSAGE
      From: #{@smtp_configuration.from_email}
      To: #{Current.user.email_address}
      Reply-To: #{reply_to}
      Subject: Checkend SMTP Test Email

      This is a test email from Checkend to verify your SMTP configuration.

      If you received this email, your SMTP settings are working correctly.
    MESSAGE

    smtp = Net::SMTP.new(@smtp_configuration.address, @smtp_configuration.port)
    smtp.enable_starttls_auto if @smtp_configuration.enable_starttls_auto?

    auth_method = @smtp_configuration.authentication.to_sym
    smtp.start(@smtp_configuration.address, @smtp_configuration.user_name, @smtp_configuration.password, auth_method) do |smtp_connection|
      smtp_connection.send_message(message, @smtp_configuration.from_email, Current.user.email_address)
    end
  end
end
