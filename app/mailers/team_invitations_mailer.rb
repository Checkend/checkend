class TeamInvitationsMailer < ApplicationMailer
  def invite(team_invitation)
    @team_invitation = team_invitation
    @team = team_invitation.team
    @inviter = team_invitation.invited_by

    mail(
      to: @team_invitation.email,
      subject: "You've been invited to join #{@team.name} on Checkend"
    )
  end
end

