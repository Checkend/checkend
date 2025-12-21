class ApplicationMailer < ActionMailer::Base
  default from: -> { default_from_address }
  layout 'mailer'

  private

  def default_from_address
    if defined?(SmtpConfiguration) && SmtpConfiguration.instance.enabled?
      SmtpConfiguration.instance.user_name.presence || 'noreply@checkend.local'
    else
      'noreply@checkend.local'
    end
  end
end
