module Api
  module V1
    class BaseController < ActionController::API
      before_action :authenticate_api_key!

      private

      def authenticate_api_key!
        api_key = request.headers['X-API-Key']
        @current_app = App.find_by(api_key: api_key) if api_key.present?

        unless @current_app
          render json: { error: 'Invalid or missing API key' }, status: :unauthorized
        end
      end

      attr_reader :current_app
    end
  end
end
