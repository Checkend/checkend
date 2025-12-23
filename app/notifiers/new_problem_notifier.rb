class NewProblemNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :new_problem
    config.if = -> { params[:problem].app.notify_on_new_problem? }
  end

  notification_methods do
    def message
      problem = params[:problem]
      "New error in #{problem.app.name}: #{problem.error_class}"
    end

    def url
      problem = params[:problem]
      Rails.application.routes.url_helpers.app_problem_path(problem.app, problem)
    end
  end
end
