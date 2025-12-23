class TeamInvitationsController < ApplicationController
  before_action :set_team, only: [ :index, :create, :update, :destroy ]
  before_action :require_team_admin!, only: [ :create, :update, :destroy ]
  allow_unauthenticated_access only: [ :accept ]

  def index
    @team_invitations = @team.team_invitations.order(created_at: :desc)
  end

  def create
    @team_invitation = @team.team_invitations.build(
      email: params[:email],
      invited_by: Current.user
    )

    if @team_invitation.save
      TeamInvitationsMailer.invite(@team_invitation).deliver_later
      redirect_to team_team_invitations_path(@team), notice: 'Invitation sent successfully.'
    else
      redirect_to team_team_invitations_path(@team), alert: @team_invitation.errors.full_messages.join(', ')
    end
  end

  def update
    @team_invitation = @team.team_invitations.find(params[:id])
    # Team invitations can be updated (e.g., resend) but role is set when accepting
    redirect_to team_team_invitations_path(@team), notice: 'Invitation updated successfully.'
  end

  def destroy
    @team_invitation = @team.team_invitations.find(params[:id])
    @team_invitation.destroy
    redirect_to team_team_invitations_path(@team), notice: 'Invitation cancelled successfully.'
  end

  def accept
    @team_invitation = TeamInvitation.find_by!(token: params[:token])
    @team = @team_invitation.team

    unless @team_invitation.active?
      redirect_to new_session_path, alert: 'This invitation has expired or has already been accepted.'
      return
    end

    if authenticated?
      user = Current.user
      if user.email_address.downcase == @team_invitation.email.downcase
        # Add user to team
        team_member = @team.team_members.find_or_initialize_by(user: user)
        team_member.role = 'member' if team_member.new_record?
        team_member.save!

        @team_invitation.accept!
        redirect_to team_path(@team), notice: 'You have been added to the team!'
      else
        redirect_to new_session_path, alert: 'This invitation was sent to a different email address.'
      end
    else
      session[:return_to_after_authenticating] = accept_team_invitation_path(@team_invitation.token)
      redirect_to new_session_path, notice: 'Please sign in to accept the invitation.'
    end
  end

  private

  def set_team
    @team = Current.user.teams.friendly.find(params[:team_id])
  rescue ActiveRecord::RecordNotFound
    @team = Current.user.owned_teams.friendly.find(params[:team_id])
    raise ActiveRecord::RecordNotFound unless @team
  end

  def require_team_admin!
    return if can_manage_team_assignment?(@team)

    redirect_to team_path(@team), alert: 'You must be a team admin to perform this action.'
  end
end
