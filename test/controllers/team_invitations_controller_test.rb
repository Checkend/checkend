require 'test_helper'

class TeamInvitationsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
    @team = teams(:one)
    # Ensure user is admin
    @team.team_members.find_or_create_by!(user: @user, role: 'admin')
  end

  test 'should get index' do
    get team_team_invitations_url(@team)
    assert_response :success
  end

  test 'should create team invitation' do
    assert_difference('TeamInvitation.count') do
      post team_team_invitations_url(@team), params: { email: 'newuser@example.com' }
    end

    assert_redirected_to team_team_invitations_url(@team)
    invitation = TeamInvitation.last
    assert_equal 'newuser@example.com', invitation.email
    assert_not_nil invitation.token
  end

  test 'should destroy team invitation' do
    invitation = @team.team_invitations.create!(
      email: 'test@example.com',
      invited_by: @user,
      token: 'test-token'
    )

    assert_difference('TeamInvitation.count', -1) do
      delete team_team_invitation_url(@team, invitation)
    end

    assert_redirected_to team_team_invitations_url(@team)
  end

  test 'should accept invitation when authenticated' do
    invitation = @team.team_invitations.create!(
      email: @user.email_address,
      invited_by: @user,
      token: 'accept-token'
    )

    get accept_team_invitation_path(invitation.token)
    assert_redirected_to team_path(@team)
    invitation.reload
    assert_not_nil invitation.accepted_at
    assert @team.team_members.exists?(user: @user)
  end

  private

  def sign_in_as(user)
    post session_path, params: { email_address: user.email_address, password: 'password' }
  end
end
