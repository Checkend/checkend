class ProblemReoccurredNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :problem_reoccurred
    config.if = -> { params[:problem].app.notify_on_reoccurrence? }
  end

  deliver_by :slack do |config|
    config.url = -> { params[:problem].app.slack_webhook_url }
    config.json = -> { NewProblemNotifier.build_slack_payload(params, is_new: false) }
    config.if = -> { params[:problem].app.slack_webhook_url.present? }
  end

  deliver_by :discord, class: 'Noticed::DeliveryMethods::DiscordDelivery' do |config|
    config.url = -> { params[:problem].app.discord_webhook_url }
    config.json = -> { NewProblemNotifier.build_discord_payload(params, is_new: false) }
    config.if = -> { params[:problem].app.discord_webhook_url.present? }
  end

  deliver_by :webhook, class: 'Noticed::DeliveryMethods::WebhookDelivery' do |config|
    config.url = -> { params[:problem].app.webhook_url }
    config.json = -> { NewProblemNotifier.build_webhook_payload(params, is_new: false) }
    config.if = -> { params[:problem].app.webhook_url.present? }
  end

  notification_methods do
    def message
      problem = params[:problem]
      "Error reoccurred in #{problem.app.name}: #{problem.error_class}"
    end

    def url
      problem = params[:problem]
      Rails.application.routes.url_helpers.app_problem_path(problem.app, problem)
    end
  end
end
