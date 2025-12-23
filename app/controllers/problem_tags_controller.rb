class ProblemTagsController < ApplicationController
  before_action :set_app
  before_action :set_problem
  before_action :require_app_access!

  def index
    query = params[:q].to_s.downcase.strip
    existing_tag_ids = @problem.tags.pluck(:id)

    @tags = if query.present?
      Tag.where('name LIKE ?', "%#{query}%")
         .where.not(id: existing_tag_ids)
         .order(:name)
         .limit(10)
    else
      Tag.where.not(id: existing_tag_ids)
         .order(:name)
         .limit(10)
    end

    render json: {
      tags: @tags.map { |t| { id: t.id, name: t.name } },
      can_create: query.present? && !Tag.exists?(name: query) && query.match?(/\A[a-z0-9\-_]+\z/i)
    }
  end

  def create
    tag_name = params[:name].to_s.downcase.strip

    tag = Tag.find_or_create_by(name: tag_name)

    if tag.persisted? && !@problem.tags.include?(tag)
      @problem.tags << tag
      render json: { id: tag.id, name: tag.name }, status: :created
    elsif tag.persisted?
      render json: { error: 'Tag already added to this problem' }, status: :unprocessable_entity
    else
      render json: { error: tag.errors.full_messages.join(', ') }, status: :unprocessable_entity
    end
  end

  def destroy
    tag = @problem.tags.find_by(id: params[:id])

    if tag
      @problem.tags.delete(tag)
      head :no_content
    else
      render json: { error: 'Tag not found' }, status: :not_found
    end
  end

  private

  def set_app
    @app = accessible_apps.find_by!(slug: params[:app_id])
    raise ActiveRecord::RecordNotFound unless @app
  end

  def set_problem
    @problem = @app.problems.find(params[:problem_id])
  end
end
