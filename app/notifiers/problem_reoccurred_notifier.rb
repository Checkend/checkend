class ProblemReoccurredNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :problem_reoccurred
    config.if = -> { params[:problem].app.notify_on_reoccurrence? }
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
