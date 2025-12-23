class ProblemsController < ApplicationController
  include Pagy::Backend

  rescue_from Pagy::OverflowError, Pagy::VariableError, with: :redirect_to_first_page

  before_action :set_app
  before_action :set_problem, only: [ :show, :resolve, :unresolve ]
  before_action :set_breadcrumbs

  def index
    @problems = @app.problems.includes(:tags)

    # Filter by status
    case params[:status]
    when 'resolved'
      @problems = @problems.resolved
    when 'unresolved'
      @problems = @problems.unresolved
    else
      # "all" or nil - show all problems
    end

    # Search by error class or message
    if params[:search].present?
      search_term = "%#{params[:search]}%"
      @problems = @problems.where('error_class ILIKE ? OR error_message ILIKE ?', search_term, search_term)
    end

    # Filter by tags
    if params[:tags].present?
      @problems = @problems.tagged_with(params[:tags])
    end

    # Sort
    case params[:sort]
    when 'notices'
      @problems = @problems.order(notices_count: :desc)
    when 'oldest'
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
    redirect_to app_problems_path(@app), notice: 'Problem marked as resolved.'
  end

  def unresolve
    @problem.unresolve!
    redirect_to app_problems_path(@app), notice: 'Problem marked as unresolved.'
  end

  def bulk_resolve
    problem_ids = params[:problem_ids] || []
    @app.problems.where(id: problem_ids).find_each(&:resolve!)
    redirect_to app_problems_path(@app, filter_params),
                notice: "#{problem_ids.size} problem(s) marked as resolved."
  end

  def bulk_unresolve
    problem_ids = params[:problem_ids] || []
    @app.problems.where(id: problem_ids).find_each(&:unresolve!)
    redirect_to app_problems_path(@app, filter_params),
                notice: "#{problem_ids.size} problem(s) marked as unresolved."
  end

  def bulk_add_tags
    problem_ids = params[:problem_ids] || []
    tag_name = params[:tag_name].to_s.downcase.strip
    return redirect_to app_problems_path(@app, filter_params), alert: 'Please select a tag.' if tag_name.blank?

    tag = Tag.find_or_create_by(name: tag_name)
    return redirect_to app_problems_path(@app, filter_params), alert: tag.errors.full_messages.join(', ') unless tag.persisted?

    problems = @app.problems.where(id: problem_ids)
    count = 0
    problems.find_each do |problem|
      unless problem.tags.include?(tag)
        problem.tags << tag
        count += 1
      end
    end

    redirect_to app_problems_path(@app, filter_params),
                notice: "Tag '#{tag.name}' added to #{count} problem(s)."
  end

  def bulk_remove_tags
    problem_ids = params[:problem_ids] || []
    tag_name = params[:tag_name].to_s.downcase.strip
    return redirect_to app_problems_path(@app, filter_params), alert: 'Please select a tag.' if tag_name.blank?

    tag = Tag.find_by(name: tag_name)
    return redirect_to app_problems_path(@app, filter_params), alert: 'Tag not found.' unless tag

    problems = @app.problems.where(id: problem_ids)
    count = 0
    problems.find_each do |problem|
      if problem.tags.include?(tag)
        problem.tags.delete(tag)
        count += 1
      end
    end

    redirect_to app_problems_path(@app, filter_params),
                notice: "Tag '#{tag.name}' removed from #{count} problem(s)."
  end

  private

  def set_app
    @app = Current.user.apps.find_by!(slug: params[:app_id])
  end

  def set_problem
    @problem = @app.problems.includes(:tags).find(params[:id])
  end

  def redirect_to_first_page
    redirect_to app_problems_path(@app, filter_params)
  end

  def filter_params
    params.permit(:status, :search, :sort, tags: []).to_h.compact_blank
  end

  def set_breadcrumbs
    add_breadcrumb 'Apps', apps_path
    add_breadcrumb @app.name, app_path(@app)
    add_breadcrumb 'Problems', app_problems_path(@app) if action_name == 'show'
    add_breadcrumb @problem.error_class if action_name == 'show'
    add_breadcrumb 'Problems' if action_name == 'index'
  end
end
