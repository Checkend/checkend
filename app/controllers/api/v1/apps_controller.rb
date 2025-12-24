module Api
  module V1
    class AppsController < BaseController
      def index
        return unless require_permission!('apps:read')
        apps = App.all.order(created_at: :desc)
        render json: apps.map(&:as_json)
      end

      def show
        return unless require_permission!('apps:read')
        app = App.find_by!(slug: params[:id])
        render json: app.as_json
      end

      def create
        return unless require_permission!('apps:write')
        app = App.new(app_params)

        if app.save
          render json: app.as_json, status: :created
        else
          render json: { error: 'validation_failed', messages: app.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        return unless require_permission!('apps:write')
        app = App.find_by!(slug: params[:id])

        if app.update(app_params)
          render json: app.as_json
        else
          render json: { error: 'validation_failed', messages: app.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        return unless require_permission!('apps:write')
        app = App.find_by!(slug: params[:id])
        app.destroy
        head :no_content
      end

      private

      def app_params
        params.require(:app).permit(:name, :environment, :notify_on_new_problem, :notify_on_reoccurrence)
      end
    end
  end
end
