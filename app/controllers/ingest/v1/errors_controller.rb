module Ingest
  module V1
    class ErrorsController < BaseController
      def create
        result = ErrorIngestionService.call(
          app: current_app,
          error_params: error_params,
          context_params: context_params,
          request_params: request_info_params,
          user_params: user_params,
          notifier_params: notifier_params
        )

        if result.success?
          render json: {
            id: result.notice.id,
            problem_id: result.problem.id
          }, status: :created
        else
          render json: { error: result.error }, status: :unprocessable_entity
        end
      end

      private

      def error_params
        params.require(:error).permit(:class, :message, :fingerprint, backtrace: [])
      end

      def context_params
        params[:context]&.to_unsafe_h || {}
      end

      def request_info_params
        params[:request]&.to_unsafe_h || {}
      end

      def user_params
        params[:user]&.to_unsafe_h || {}
      end

      def notifier_params
        params[:notifier]&.permit(:name, :version, :language, :language_version)&.to_h || {}
      end
    end
  end
end
