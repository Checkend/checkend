module Api
  module V1
    class ProblemsController < BaseController
      before_action :set_app
      before_action :set_problem, only: [:show, :resolve, :unresolve]

      def index
        return unless require_permission!('problems:read')
        problems = @app.problems.includes(:tags)

        # Filter by status
        case params[:status]
        when 'resolved'
          problems = problems.resolved
        when 'unresolved'
          problems = problems.unresolved
        end

        # Search by error class or message
        if params[:search].present?
          search_term = "%#{params[:search]}%"
          problems = problems.where('error_class ILIKE ? OR error_message ILIKE ?', search_term, search_term)
        end

        # Filter by tags
        if params[:tags].present?
          tag_list = Array(params[:tags])
          problems = problems.tagged_with(tag_list)
        end

        # Date range filtering
        if params[:date_from].present?
          problems = problems.last_seen_after(Date.parse(params[:date_from]))
        end
        if params[:date_to].present?
          problems = problems.last_seen_before(Date.parse(params[:date_to]))
        end

        # Notice count filter
        if params[:min_notices].present?
          problems = problems.with_notices_at_least(params[:min_notices].to_i)
        end

        # Sort
        case params[:sort]
        when 'notices'
          problems = problems.order(notices_count: :desc)
        when 'oldest'
          problems = problems.order(last_noticed_at: :asc)
        else
          # Default: most recent first
          problems = problems.order(last_noticed_at: :desc)
        end

        # Pagination
        page = params[:page]&.to_i || 1
        per_page = [params[:per_page]&.to_i || 25, 100].min # Max 100 per page
        offset = (page - 1) * per_page

        total = problems.count
        problems = problems.limit(per_page).offset(offset)

        render json: {
          data: problems.map(&:as_json),
          pagination: {
            page: page,
            per_page: per_page,
            total: total,
            total_pages: (total.to_f / per_page).ceil
          }
        }
      end

      def show
        return unless require_permission!('problems:read')
        render json: @problem.as_json
      end

      def resolve
        return unless require_permission!('problems:write')
        @problem.resolve!
        render json: @problem.as_json
      end

      def unresolve
        return unless require_permission!('problems:write')
        @problem.unresolve!
        render json: @problem.as_json
      end

      def bulk_resolve
        return unless require_permission!('problems:write')
        problem_ids = params[:problem_ids] || []

        if problem_ids.empty?
          render json: { error: 'validation_failed', message: 'problem_ids is required' }, status: :unprocessable_entity
          return
        end

        count = 0
        @app.problems.where(id: problem_ids).find_each do |problem|
          problem.resolve!
          count += 1
        end

        render json: { message: "#{count} problem(s) marked as resolved", count: count }
      end

      private

      def set_app
        @app = App.find_by!(slug: params[:app_id])
      end

      def set_problem
        @problem = @app.problems.includes(:tags).find(params[:id])
      end
    end
  end
end

