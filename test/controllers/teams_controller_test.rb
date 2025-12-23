require 'test_helper'

class TeamsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
    @team = teams(:one)
  end

  test 'should get index' do
    get teams_url
    assert_response :success
  end

  test 'should get new' do
    get new_team_url
    assert_response :success
  end

  test 'should create team' do
    assert_difference('Team.count') do
      post teams_url, params: { team: { name: 'New Team' } }
    end

    assert_redirected_to team_url(Team.last)
    assert_equal @user, Team.last.owner
    assert Team.last.team_members.exists?(user: @user, role: 'admin')
  end

  test 'should show team' do
    get team_url(@team)
    assert_response :success
  end

  test 'should get edit' do
    get edit_team_url(@team)
    assert_response :success
  end

  test 'should update team' do
    patch team_url(@team), params: { team: { name: 'Updated Team' } }
    @team.reload
    assert_redirected_to team_url(@team)
    assert_equal 'Updated Team', @team.name
  end

  test 'should destroy team' do
    assert_difference('Team.count', -1) do
      delete team_url(@team)
    end

    assert_redirected_to teams_url
  end

  test 'should not allow non-owner to delete team' do
    other_user = users(:two)
    sign_in_as(other_user)
    assert_no_difference('Team.count') do
      delete team_url(@team)
    end
  end

  private

  def sign_in_as(user)
    post session_path, params: { email_address: user.email_address, password: 'password' }
  end
end
