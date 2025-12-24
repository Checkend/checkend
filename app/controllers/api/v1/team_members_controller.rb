module Api
  module V1
    class TeamMembersController < BaseController
      before_action :set_team
      before_action :set_team_member, only: [ :update, :destroy ]

      def index
        return unless require_permission!('teams:read')
        team_members = @team.team_members.includes(:user).order(role: :desc, created_at: :asc)
        render json: team_members.map(&:as_json)
      end

      def create
        return unless require_permission!('teams:write')

        user_id = params[:user_id] || params[:user_id]
        email_address = params[:email_address]

        user = if user_id.present?
          User.find_by(id: user_id)
        elsif email_address.present?
          User.find_by(email_address: email_address)
        end

        unless user
          render json: { error: 'validation_failed', message: 'User not found' }, status: :unprocessable_entity
          return
        end

        team_member = @team.team_members.build(user: user, role: params[:role] || 'member')

        if team_member.save
          render json: team_member.as_json, status: :created
        else
          render json: { error: 'validation_failed', messages: team_member.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        return unless require_permission!('teams:write')

        if params[:role].present?
          @team_member.role = params[:role]
        end

        if @team_member.save
          render json: @team_member.as_json
        else
          render json: { error: 'validation_failed', messages: @team_member.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        return unless require_permission!('teams:write')

        # Prevent removing the last admin
        if @team_member.admin? && @team.team_members.admin.count <= 1
          render json: { error: 'validation_failed', message: 'Cannot remove the last admin from the team' }, status: :unprocessable_entity
          return
        end

        @team_member.destroy
        head :no_content
      end

      private

      def set_team
        @team = Team.friendly.find(params[:team_id])
      end

      def set_team_member
        @team_member = @team.team_members.find(params[:id])
      end
    end
  end
end
