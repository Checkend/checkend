require "test_helper"

class TeamInvitationTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @team = teams(:one) || Team.create!(name: "Test Team", owner: @user)
    @invitation = TeamInvitation.new(
      email: "invitee@example.com",
      team: @team,
      invited_by: @user
    )
  end

  test "should be valid" do
    assert @invitation.valid?
  end

  test "should require email" do
    @invitation.email = nil
    assert_not @invitation.valid?
  end

  test "should validate email format" do
    @invitation.email = "invalid"
    assert_not @invitation.valid?
  end

  test "should generate token on create" do
    assert_nil @invitation.token
    @invitation.save!
    assert_not_nil @invitation.token
  end

  test "should set expires_at on create" do
    assert_nil @invitation.expires_at
    @invitation.save!
    assert_not_nil @invitation.expires_at
    assert @invitation.expires_at > 6.days.from_now
  end

  test "active? should return true for pending non-expired invitations" do
    @invitation.save!
    assert @invitation.active?
  end

  test "active? should return false for accepted invitations" do
    @invitation.save!
    @invitation.accept!
    assert_not @invitation.active?
  end

  test "active? should return false for expired invitations" do
    @invitation.save!
    @invitation.update!(expires_at: 1.day.ago)
    assert_not @invitation.active?
  end
end

