class ProblemsController < ApplicationController
  include Pagy::Backend

  rescue_from Pagy::OverflowError, Pagy::VariableError, with: :redirect_to_first_page

  before_action :set_app
  before_action :set_problem, only: [ :show, :resolve, :unresolve ]

  def index
    @problems = @app.problems

    # Filter by status
    case params[:status]
    when "resolved"
      @problems = @problems.resolved
    when "unresolved"
      @problems = @problems.unresolved
    else
      # "all" or nil - show all problems
    end

    # Search by error class or message
    if params[:search].present?
      search_term = "%#{params[:search]}%"
      @problems = @problems.where("error_class ILIKE ? OR error_message ILIKE ?", search_term, search_term)
    end

    # Sort
    case params[:sort]
    when "notices"
      @problems = @problems.order(notices_count: :desc)
    when "oldest"
      @problems = @problems.order(last_noticed_at: :asc)
    else
      # Default: most recent first
      @problems = @problems.order(last_noticed_at: :desc)
    end

    # Pagination with Pagy
    @pagy, @problems = pagy(@problems)
  end

  def show
  end

  def resolve
    @problem.resolve!
    redirect_to app_problems_path(@app), notice: "Problem marked as resolved."
  end

  def unresolve
    @problem.unresolve!
    redirect_to app_problems_path(@app), notice: "Problem marked as unresolved."
  end

  def bulk_resolve
    problem_ids = params[:problem_ids] || []
    @app.problems.where(id: problem_ids).find_each(&:resolve!)
    redirect_to app_problems_path(@app, status: params[:status], search: params[:search], sort: params[:sort]),
                notice: "#{problem_ids.size} problem(s) marked as resolved."
  end

  def bulk_unresolve
    problem_ids = params[:problem_ids] || []
    @app.problems.where(id: problem_ids).find_each(&:unresolve!)
    redirect_to app_problems_path(@app, status: params[:status], search: params[:search], sort: params[:sort]),
                notice: "#{problem_ids.size} problem(s) marked as unresolved."
  end

  private

  def set_app
    @app = Current.user.apps.find_by!(slug: params[:app_id])
  end

  def set_problem
    @problem = @app.problems.find(params[:id])
  end

  def redirect_to_first_page
    redirect_to app_problems_path(@app, status: params[:status], search: params[:search], sort: params[:sort])
  end
end
