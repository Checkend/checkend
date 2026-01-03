class ProblemsMailer < ApplicationMailer
  def new_problem
    @problem = params[:problem]
    @notice = params[:notice]
    @app = @problem.app
    @recipient = params[:recipient]

    mail(
      to: @recipient.email_address,
      subject: "[#{@app.name}] New error: #{@problem.error_class}"
    )
  end

  def problem_reoccurred
    @problem = params[:problem]
    @notice = params[:notice]
    @app = @problem.app
    @recipient = params[:recipient]

    mail(
      to: @recipient.email_address,
      subject: "[#{@app.name}] Error reoccurred: #{@problem.error_class}"
    )
  end
end
