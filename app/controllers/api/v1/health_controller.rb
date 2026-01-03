module Api
  module V1
    class HealthController < ActionController::API
      def show
        render json: { status: 'ok', timestamp: Time.current.iso8601 }
      end
    end
  end
end
