module Api
  module V1
    class NoticesController < BaseController
      before_action :set_app
      before_action :set_problem
      before_action :set_notice, only: [ :show ]

      def index
        return unless require_permission!('notices:read')

        notices = @problem.notices.order(occurred_at: :desc)

        # Date range filtering
        if params[:date_from].present?
          notices = notices.where('occurred_at >= ?', Date.parse(params[:date_from]).beginning_of_day)
        end
        if params[:date_to].present?
          notices = notices.where('occurred_at <= ?', Date.parse(params[:date_to]).end_of_day)
        end

        # Pagination
        page = params[:page]&.to_i || 1
        per_page = [ params[:per_page]&.to_i || 25, 100 ].min
        offset = (page - 1) * per_page

        total = notices.count
        notices = notices.limit(per_page).offset(offset)

        render json: {
          data: notices.map(&:as_json),
          pagination: {
            page: page,
            per_page: per_page,
            total: total,
            total_pages: (total.to_f / per_page).ceil
          }
        }
      end

      def show
        return unless require_permission!('notices:read')
        render json: @notice.as_json
      end

      private

      def set_app
        @app = App.find_by!(slug: params[:app_id])
      end

      def set_problem
        @problem = @app.problems.find(params[:problem_id])
      end

      def set_notice
        @notice = @problem.notices.find(params[:id])
      end
    end
  end
end
