class NoticesController < ApplicationController
  before_action :set_app
  before_action :set_problem
  before_action :set_notice

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
end
