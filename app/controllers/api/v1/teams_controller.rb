module Api
  module V1
    class TeamsController < BaseController
      before_action :set_team, only: [:show, :update, :destroy, :apps, :apps_destroy]

      def index
        return unless require_permission!('teams:read')
        teams = Team.all.includes(:owner, :team_members).order(created_at: :desc)
        render json: teams.map(&:as_json)
      end

      def show
        return unless require_permission!('teams:read')
        render json: @team.as_json
      end

      def create
        return unless require_permission!('teams:write')
        team = Team.new(team_params)

        unless team_params[:owner_id].present?
          render json: { error: 'validation_failed', message: 'owner_id is required' }, status: :unprocessable_entity
          return
        end

        owner = User.find_by(id: team_params[:owner_id])
        unless owner
          render json: { error: 'validation_failed', message: 'Owner user not found' }, status: :unprocessable_entity
          return
        end

        team.owner = owner

        if team.save
          # Add owner as admin team member
          team.team_members.create!(user: owner, role: 'admin')
          render json: team.as_json, status: :created
        else
          render json: { error: 'validation_failed', messages: team.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        return unless require_permission!('teams:write')

        if @team.update(team_params.except(:owner_id))
          render json: @team.as_json
        else
          render json: { error: 'validation_failed', messages: @team.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        return unless require_permission!('teams:write')
        @team.destroy
        head :no_content
      end

      # Team app assignments
      def apps
        if request.get?
          return unless require_permission!('teams:read')
          apps = @team.apps.order(:name)
          render json: apps.map(&:as_json)
        elsif request.post?
          return unless require_permission!('teams:write')
          app_slug = params[:app_id] || params.dig(:app, :id) || params.dig(:app, :slug)

          unless app_slug.present?
            render json: { error: 'validation_failed', message: 'app_id is required' }, status: :unprocessable_entity
            return
          end

          app = App.find_by(slug: app_slug)

          unless app
            render json: { error: 'validation_failed', message: 'App not found' }, status: :unprocessable_entity
            return
          end

          @team.team_assignments.find_or_create_by!(app: app)
          render json: { message: 'App assigned to team successfully' }, status: :created
        end
      end

      def apps_destroy
        return unless require_permission!('teams:write')
        app = App.find_by!(slug: params[:app_id])

        unless app
          render json: { error: 'not_found', message: 'App not found' }, status: :not_found
          return
        end

        @team.team_assignments.where(app: app).destroy_all
        head :no_content
      end

      private

      def set_team
        @team = Team.friendly.find(params[:id] || params[:team_id])
      end

      def team_params
        params.require(:team).permit(:name, :owner_id)
      end
    end
  end
end

