module Api
  module V1
    class UsersController < BaseController
      before_action :set_user, only: [ :show, :update, :destroy ]

      def index
        return unless require_permission!('users:read')
        users = User.all.order(created_at: :desc)
        render json: users.map(&:as_json)
      end

      def show
        return unless require_permission!('users:read')
        render json: @user.as_json
      end

      def create
        return unless require_permission!('users:write')
        user = User.new(user_params)

        if user.save
          render json: user.as_json, status: :created
        else
          render json: { error: 'validation_failed', messages: user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        return unless require_permission!('users:write')

        # Handle password update separately if provided
        if user_params[:password].present?
          if @user.update(user_params)
            render json: @user.as_json
          else
            render json: { error: 'validation_failed', messages: @user.errors.full_messages }, status: :unprocessable_entity
          end
        else
          # Update without password
          update_params = user_params.except(:password, :password_confirmation)
          if @user.update(update_params)
            render json: @user.as_json
          else
            render json: { error: 'validation_failed', messages: @user.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      def destroy
        return unless require_permission!('users:write')
        @user.destroy
        head :no_content
      end

      private

      def set_user
        @user = User.find(params[:id])
      end

      def user_params
        params.require(:user).permit(:email_address, :password, :password_confirmation)
      end
    end
  end
end
