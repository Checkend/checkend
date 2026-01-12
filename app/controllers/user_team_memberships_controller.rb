class UserTeamMembershipsController < ApplicationController
  before_action :require_site_admin!
  before_action :set_user

  def edit
    @teams = Team.all.order(:name)
    @user_team_ids = @user.team_members.pluck(:team_id)

    render layout: false
  end

  def update
    team_ids = (params[:team_ids] || []).reject(&:blank?).map(&:to_i)
    roles = params[:roles] || {}

    ActiveRecord::Base.transaction do
      @user.team_members.where.not(team_id: team_ids).destroy_all

      team_ids.each do |team_id|
        team = Team.find(team_id)
        role = roles[team_id.to_s] || 'member'

        member = @user.team_members.find_or_initialize_by(team: team)
        member.role = role
        member.save!
      end
    end

    respond_to do |format|
      format.turbo_stream do
        flash.now[:notice] = 'Team memberships updated successfully.'
        render turbo_stream: [
          turbo_stream.update('user_team_memberships', partial: 'users/team_memberships', locals: { user: @user.reload }),
          turbo_stream.update('user_sidebar', partial: 'users/sidebar', locals: { user: @user }),
          turbo_stream.update('slide_over', ''),
          turbo_stream.update('flash', partial: 'shared/flash')
        ]
      end
      format.html { redirect_to @user, notice: 'Team memberships updated successfully.' }
    end
  rescue ActiveRecord::RecordInvalid => e
    redirect_to @user, alert: "Failed to update team memberships: #{e.message}"
  rescue ActiveRecord::RecordNotFound => e
    redirect_to @user, alert: "Failed to update team memberships: #{e.message}"
  end

  private

  def set_user
    @user = User.friendly.find(params[:user_id])
  end
end
