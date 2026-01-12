require 'test_helper'

class UserTeamMembershipsControllerTest < ActionDispatch::IntegrationTest
  include SessionTestHelper

  setup do
    @admin = users(:admin)
    @regular_user = users(:one)
    @target_user = users(:two)
    @team = teams(:one)
    @other_team = teams(:two)

    @target_user.team_members.destroy_all

    sign_in_as(@admin)
  end

  test 'edit requires site admin' do
    sign_in_as(@regular_user)

    get edit_user_team_memberships_path(@target_user)
    assert_response :not_found
  end

  test 'edit shows team memberships slide-over' do
    get edit_user_team_memberships_path(@target_user)
    assert_response :success
    assert_match 'Team Memberships', response.body
  end

  test 'edit shows all available teams' do
    get edit_user_team_memberships_path(@target_user)
    assert_response :success
    assert_match @team.name, response.body
    assert_match @other_team.name, response.body
  end

  test 'edit shows user existing memberships' do
    @target_user.team_members.create!(team: @team, role: 'developer')

    get edit_user_team_memberships_path(@target_user)
    assert_response :success
    assert_match @team.name, response.body
  end

  test 'update requires site admin' do
    sign_in_as(@regular_user)

    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id ]
    }
    assert_response :not_found
  end

  test 'update adds team membership' do
    assert_difference '@target_user.team_members.count', 1 do
      patch user_team_memberships_path(@target_user), params: {
        team_ids: [ @team.id.to_s ],
        roles: { @team.id.to_s => 'member' }
      }
    end

    assert_redirected_to user_path(@target_user)
    assert @target_user.team_members.exists?(team: @team, role: 'member')
  end

  test 'update removes team membership' do
    @target_user.team_members.create!(team: @team, role: 'member')
    @target_user.team_members.create!(team: @other_team, role: 'developer')

    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id.to_s ],
      roles: { @team.id.to_s => 'member' }
    }

    assert_redirected_to user_path(@target_user)
    assert @target_user.team_members.exists?(team: @team)
    assert_not @target_user.team_members.exists?(team: @other_team)
  end

  test 'update changes role' do
    @target_user.team_members.create!(team: @team, role: 'member')

    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id.to_s ],
      roles: { @team.id.to_s => 'admin' }
    }

    assert_redirected_to user_path(@target_user)
    assert_equal 'admin', @target_user.team_members.find_by(team: @team).role
  end

  test 'update with empty array removes all memberships' do
    sign_in_as(@admin)
    @target_user.team_members.find_or_create_by!(team: @team, role: 'member')
    @target_user.team_members.find_or_create_by!(team: @other_team, role: 'developer')

    patch user_team_memberships_path(@target_user), params: {
      team_ids: []
    }

    assert_redirected_to user_path(@target_user)
    assert_equal 0, @target_user.reload.team_members.count
  end

  test 'update with empty string in array removes all memberships' do
    @target_user.team_members.create!(team: @team, role: 'member')
    @target_user.team_members.create!(team: @other_team, role: 'developer')

    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ '' ]
    }

    assert_redirected_to user_path(@target_user)
    assert_equal 0, @target_user.reload.team_members.count
  end

  test 'update uses default role when not specified' do
    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id.to_s ]
    }

    assert_redirected_to user_path(@target_user)
    assert_equal 'member', @target_user.team_members.find_by(team: @team).role
  end

  test 'update with invalid team_id redirects with alert' do
    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id.to_s, '99999' ],
      roles: { @team.id.to_s => 'member' }
    }

    assert_response :redirect
    assert_redirected_to user_path(@target_user)
    assert flash[:alert] && flash[:alert].match(/Failed to update team memberships|Team/)
  end

  test 'update handles multiple teams' do
    patch user_team_memberships_path(@target_user), params: {
      team_ids: [ @team.id.to_s, @other_team.id.to_s ],
      roles: {
        @team.id.to_s => 'admin',
        @other_team.id.to_s => 'developer'
      }
    }

    assert_redirected_to user_path(@target_user)
    assert @target_user.team_members.exists?(team: @team, role: 'admin')
    assert @target_user.team_members.exists?(team: @other_team, role: 'developer')
  end

  test 'all actions require authentication' do
    sign_out

    get edit_user_team_memberships_path(@target_user)
    assert_redirected_to new_session_path

    patch user_team_memberships_path(@target_user), params: { team_ids: [] }
    assert_redirected_to new_session_path
  end
end
