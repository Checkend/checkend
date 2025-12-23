module Api
  module V1
    class TagsController < BaseController
      before_action :set_app
      before_action :set_problem

      def index
        return unless require_permission!('tags:read')
        tags = @problem.tags.order(:name)
        render json: tags.map { |t| { id: t.id, name: t.name } }
      end

      def create
        return unless require_permission!('tags:write')
        tag_name = params[:name].to_s.downcase.strip

        if tag_name.blank?
          render json: { error: 'validation_failed', message: 'Tag name is required' }, status: :unprocessable_entity
          return
        end

        tag = Tag.find_or_create_by(name: tag_name)

        if tag.persisted? && !@problem.tags.include?(tag)
          @problem.tags << tag
          render json: { id: tag.id, name: tag.name }, status: :created
        elsif tag.persisted?
          render json: { error: 'validation_failed', message: 'Tag already added to this problem' }, status: :unprocessable_entity
        else
          render json: { error: 'validation_failed', messages: tag.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        return unless require_permission!('tags:write')
        tag = @problem.tags.find_by(id: params[:id])

        if tag
          @problem.tags.delete(tag)
          head :no_content
        else
          render json: { error: 'not_found', message: 'Tag not found' }, status: :not_found
        end
      end

      private

      def set_app
        @app = App.find_by!(slug: params[:app_id])
      end

      def set_problem
        @problem = @app.problems.find(params[:problem_id])
      end
    end
  end
end

