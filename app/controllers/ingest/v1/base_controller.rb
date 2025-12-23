module Ingest
  module V1
    class BaseController < ActionController::API
      before_action :authenticate_ingestion_key!

      private

      def authenticate_ingestion_key!
        ingestion_key = request.headers['X-API-Key']
        @current_app = App.find_by(ingestion_key: ingestion_key) if ingestion_key.present?

        unless @current_app
          render json: { error: 'Invalid or missing ingestion key' }, status: :unauthorized
        end
      end

      attr_reader :current_app
    end
  end
end

