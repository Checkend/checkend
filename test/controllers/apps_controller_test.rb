require 'test_helper'

class AppsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @other_user = users(:two)
    @app = apps(:one)
    @team = teams(:one)
    # Set up team access
    @team.team_members.find_or_create_by!(user: @user, role: 'admin')
    @team.team_assignments.find_or_create_by!(app: @app)
    sign_in_as(@user)
  end

  # Authentication tests
  test 'index requires authentication' do
    sign_out
    get apps_path
    assert_redirected_to new_session_path
  end

  test 'show requires authentication' do
    sign_out
    get app_path(@app)
    assert_redirected_to new_session_path
  end

  # Index tests
  test "index shows accessible apps" do
    get apps_path
    assert_response :success
    assert_select 'h1', 'Apps'
    assert_match @app.name, response.body
  end

  test 'index does not show inaccessible apps' do
    other_app = apps(:two)
    get apps_path
    assert_response :success
    assert_no_match other_app.name, response.body
  end

  # Show tests
  test 'show displays app details' do
    get app_path(@app)
    assert_response :success
    assert_select 'h1', @app.name
    assert_match @app.api_key, response.body
  end

  test 'show cannot view inaccessible app' do
    other_app = apps(:two)
    get app_path(other_app)
    assert_response :not_found
  end

  # New tests
  test 'new shows form' do
    get new_app_path
    assert_response :success
    assert_select 'form'
  end

  # Create tests
  test 'create with valid params' do
    assert_difference('App.count', 1) do
      post apps_path, params: { app: { name: 'New Test App', environment: 'production' } }
    end

    app = App.last
    assert_redirected_to setup_wizard_app_path(app)
    assert_equal 'New Test App', app.name
    assert_equal 'production', app.environment
    assert app.api_key.present?
  end

  test 'create with invalid params' do
    assert_no_difference('App.count') do
      post apps_path, params: { app: { name: '', environment: 'production' } }
    end

    assert_response :unprocessable_entity
  end

  # Edit tests
  test 'edit shows form' do
    get edit_app_path(@app)
    assert_response :success
  end

  test 'edit cannot edit inaccessible app' do
    other_app = apps(:two)
    get edit_app_path(other_app)
    assert_response :not_found
  end

  # Update tests
  test 'update with valid params' do
    patch app_path(@app), params: { app: { name: 'Updated Name', environment: 'staging' } }

    @app.reload
    assert_redirected_to app_path(@app)
    assert_equal 'Updated Name', @app.name
    assert_equal 'staging', @app.environment
    assert_equal 'updated-name', @app.slug
  end

  test 'update with invalid params' do
    patch app_path(@app), params: { app: { name: '' } }

    assert_response :unprocessable_entity
    @app.reload
    assert_not_equal '', @app.name
  end

  test 'update cannot update inaccessible app' do
    other_app = apps(:two)
    patch app_path(other_app), params: { app: { name: 'Hacked' } }
    assert_response :not_found
  end

  # Destroy tests
  test 'destroy deletes app' do
    assert_difference('App.count', -1) do
      delete app_path(@app)
    end

    assert_redirected_to apps_path
  end

  test 'destroy cannot delete inaccessible app' do
    other_app = apps(:two)
    delete app_path(other_app)
    assert_response :not_found
  end

  # Regenerate API key tests
  test 'regenerate_api_key updates the api key' do
    old_key = @app.api_key

    post regenerate_api_key_app_path(@app)

    assert_redirected_to app_path(@app)
    @app.reload
    assert_not_equal old_key, @app.api_key
  end

  test 'regenerate_api_key cannot regenerate inaccessible app key' do
    other_app = apps(:two)
    post regenerate_api_key_app_path(other_app)
    assert_response :not_found
  end

  # Team assignment tests
  test 'assign_team assigns team to app' do
    new_team = Team.create!(name: "New Team", owner: @user)
    new_team.team_members.create!(user: @user, role: 'admin')

    assert_difference('TeamAssignment.count', 1) do
      post assign_team_app_path(@app), params: { team_id: new_team.id }
    end

    assert_redirected_to app_path(@app)
    assert @app.teams.include?(new_team)
  end

  test 'assign_team requires admin role' do
    new_team = Team.create!(name: "New Team", owner: @other_user)
    new_team.team_members.create!(user: @other_user, role: 'admin')

    assert_no_difference('TeamAssignment.count') do
      post assign_team_app_path(@app), params: { team_id: new_team.id }
    end
  end

  test 'remove_team_assignment removes team from app' do
    assert_difference('TeamAssignment.count', -1) do
      delete remove_team_assignment_app_path(@app, team_id: @team.id)
    end

    assert_redirected_to app_path(@app)
    assert_not @app.teams.include?(@team)
  end
end
