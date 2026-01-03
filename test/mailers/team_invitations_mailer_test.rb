require 'test_helper'

class TeamInvitationsMailerTest < ActionMailer::TestCase
  setup do
    @team_invitation = team_invitations(:one)
    @team = @team_invitation.team
    @inviter = @team_invitation.invited_by
  end

  test 'invite email is sent to invitee' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_emails 1 do
      email.deliver_now
    end

    assert_equal [@team_invitation.email], email.to
  end

  test 'invite email subject includes team name' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_equal "You've been invited to join #{@team.name} on Checkend", email.subject
  end

  test 'invite email body contains team name' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_match @team.name, email.html_part.body.to_s
  end

  test 'invite email body contains inviter email' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_match @inviter.email_address, email.html_part.body.to_s
  end

  test 'invite email contains accept invitation link' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_match 'Accept Invitation', email.html_part.body.to_s
    assert_match %r{/team_invitations/[^/]+/accept}, email.html_part.body.to_s
  end

  test 'invite email mentions expiration' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_match 'expire', email.html_part.body.to_s
  end

  test 'invite email from address is set' do
    email = TeamInvitationsMailer.invite(@team_invitation)

    assert_equal ['noreply@checkend.local'], email.from
  end
end
