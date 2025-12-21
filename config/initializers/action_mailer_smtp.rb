# Configure ActionMailer SMTP settings from database
# This initializer loads SMTP configuration from the database and applies it to ActionMailer

Rails.application.config.after_initialize do
  configure_smtp_from_database
end

# Also configure when SMTP configuration is updated
ActiveSupport::Notifications.subscribe('active_record.after_commit') do |name, start, finish, id, payload|
  if payload[:record].is_a?(SmtpConfiguration)
    configure_smtp_from_database
  end
end

def configure_smtp_from_database
  return unless defined?(SmtpConfiguration)

  config = SmtpConfiguration.instance

  if config.enabled? && config.valid?
    ActionMailer::Base.smtp_settings = {
      address: config.address,
      port: config.port,
      domain: config.domain.presence,
      user_name: config.user_name,
      password: config.password,
      authentication: config.authentication.to_sym,
      enable_starttls_auto: config.enable_starttls_auto?
    }
    ActionMailer::Base.delivery_method = :smtp
  else
    # Fallback to default (file delivery in development, test in test env)
    ActionMailer::Base.delivery_method = Rails.env.test? ? :test : :file
  end
rescue => e
  Rails.logger.error "Failed to configure SMTP from database: #{e.message}"
  # Fallback to default
  ActionMailer::Base.delivery_method = Rails.env.test? ? :test : :file
end
