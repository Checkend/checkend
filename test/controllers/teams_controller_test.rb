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

  # assign_app tests
  test 'should assign app when user is team owner' do
    app = apps(:two)
    # Remove all team assignments so the app becomes unassigned (accessible to everyone)
    app.team_assignments.destroy_all
    @team.team_assignments.where(app: app).destroy_all # Ensure clean state for our team

    assert_difference('@team.team_assignments.count') do
      post assign_app_team_url(@team), params: { app_id: app.slug }
    end

    assert_redirected_to team_url(@team)
    assert_equal 'App assigned successfully.', flash[:notice]
    assert @team.apps.include?(app)
  end

  test 'should not create duplicate assignment when app already assigned' do
    app = apps(:one) # Already assigned to team one via fixtures
    assert @team.apps.include?(app), 'Precondition: app should already be assigned'

    assert_no_difference('@team.team_assignments.count') do
      post assign_app_team_url(@team), params: { app_id: app.slug }
    end

    assert_redirected_to team_url(@team)
  end

  test 'should not allow non-admin member to assign app' do
    other_user = users(:two) # Member of team one but not admin
    sign_in_as(other_user)
    app = apps(:two)

    assert_no_difference('TeamAssignment.count') do
      post assign_app_team_url(@team), params: { app_id: app.slug }
    end
  end

  test 'should handle assign_app with non-existent app' do
    assert_no_difference('TeamAssignment.count') do
      post assign_app_team_url(@team), params: { app_id: 'non-existent-app' }
    end

    assert_redirected_to team_url(@team)
    assert_equal 'App not found or you do not have access.', flash[:alert]
  end

  # remove_app_assignment tests
  test 'should remove app assignment when user is team owner' do
    app = apps(:one) # Assigned to team one via fixtures
    assert @team.apps.include?(app), 'Precondition: app should be assigned'

    assert_difference('@team.team_assignments.count', -1) do
      delete remove_app_assignment_team_url(@team), params: { app_id: app.slug }
    end

    assert_redirected_to team_url(@team)
    assert_equal 'App removed from team.', flash[:notice]
    @team.reload
    assert_not @team.apps.include?(app)
  end

  test 'should not allow non-admin member to remove app assignment' do
    other_user = users(:two) # Member of team one but not admin
    sign_in_as(other_user)
    app = apps(:one)

    assert_no_difference('TeamAssignment.count') do
      delete remove_app_assignment_team_url(@team), params: { app_id: app.slug }
    end
  end

  test 'should handle remove_app_assignment with non-existent app' do
    assert_no_difference('TeamAssignment.count') do
      delete remove_app_assignment_team_url(@team), params: { app_id: 'non-existent-app' }
    end

    assert_redirected_to team_url(@team)
    assert_equal 'App not found.', flash[:alert]
  end

  private

  def sign_in_as(user)
    post session_path, params: { email_address: user.email_address, password: 'password' }
  end
end
