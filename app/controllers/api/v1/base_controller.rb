module Api
  module V1
    class BaseController < ActionController::API
      before_action :authenticate_api_key!
      before_action :update_last_used_at

      rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
      rescue_from ActiveRecord::RecordInvalid, with: :record_invalid

      private

      def authenticate_api_key!
        api_key_value = request.headers['Checkend-API-Key']

        unless api_key_value.present?
          render json: { error: 'unauthorized', message: 'Missing API key' }, status: :unauthorized
          return
        end

        @current_api_key = ApiKey.active.find_by(key: api_key_value)

        unless @current_api_key
          render json: { error: 'unauthorized', message: 'Invalid or revoked API key' }, status: :unauthorized
          return
        end
      end

      def current_api_key
        @current_api_key
      end

      def require_permission!(permission)
        unless current_api_key&.has_permission?(permission)
          render json: { error: 'forbidden', message: "Missing required permission: #{permission}" }, status: :forbidden
          return false
        end
        true
      end

      def update_last_used_at
        current_api_key&.touch_last_used_at!
      end

      def record_not_found(exception)
        render json: { error: 'not_found', message: exception.message }, status: :not_found
      end

      def record_invalid(exception)
        render json: { error: 'validation_failed', messages: exception.record.errors.full_messages }, status: :unprocessable_entity
      end
    end
  end
end

