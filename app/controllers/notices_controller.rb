class NoticesController < ApplicationController
  before_action :set_app
  before_action :set_problem
  before_action :set_notice
  before_action :set_breadcrumbs

  def show
  end

  private

  def set_app
    @app = Current.user.apps.find_by!(slug: params[:app_id])
  end

  def set_problem
    @problem = @app.problems.find(params[:problem_id])
  end

  def set_notice
    @notice = @problem.notices.find(params[:id])
  end

  def set_breadcrumbs
    add_breadcrumb "Apps", apps_path
    add_breadcrumb @app.name, app_path(@app)
    add_breadcrumb "Problems", app_problems_path(@app)
    add_breadcrumb @problem.error_class, app_problem_path(@app, @problem)
    add_breadcrumb "Notice ##{@notice.id}"
  end
end
