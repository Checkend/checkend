# frozen_string_literal: true

require 'test_helper'

class SetupControllerTest < ActionDispatch::IntegrationTest
  # Disable fixtures for this test class since we need to test with no users
  self.use_transactional_tests = true

  setup do
    # Clear all related data to enable setup mode
    TeamMember.delete_all
    TeamAssignment.delete_all
    TeamInvitation.delete_all
    Session.delete_all
    UserNotificationPreference.delete_all
    Team.delete_all
    User.delete_all
  end

  test 'index shows setup form when no users exist' do
    get setup_path
    assert_response :success
    assert_select 'h1', text: /Welcome to Checkend/
  end

  test 'index returns 404 when setup is complete' do
    # Setup is complete when a user exists AND has logged in (has sessions)
    user = User.create!(email_address: 'test@example.com', password: 'password123')
    user.sessions.create!

    # Route constraint blocks access, resulting in 404
    get '/setup'
    assert_response :not_found
  end

  test 'create_admin creates site admin user' do
    assert_difference 'User.count', 1 do
      post setup_admin_path, params: {
        user: {
          email_address: 'admin@example.com',
          password: 'password123',
          password_confirmation: 'password123'
        }
      }
    end

    assert_redirected_to setup_team_path

    user = User.last
    assert user.site_admin?
    assert_equal 'admin@example.com', user.email_address
  end

  test 'create_admin shows errors for invalid data' do
    post setup_admin_path, params: {
      user: {
        email_address: '',
        password: 'short',
        password_confirmation: 'different'
      }
    }

    assert_response :unprocessable_entity
    assert_equal 0, User.count
  end

  test 'team step requires admin in session' do
    get setup_team_path
    assert_redirected_to setup_path
  end

  test 'team step shows form when admin exists in session' do
    create_admin_via_wizard

    get setup_team_path
    assert_response :success
    assert_select 'h1', text: /Create Your Team/
  end

  test 'create_team creates team with admin as owner' do
    create_admin_via_wizard

    assert_difference %w[Team.count TeamMember.count], 1 do
      post setup_create_team_path, params: {
        team: { name: 'Engineering' }
      }
    end

    assert_redirected_to setup_app_path

    team = Team.last
    assert_equal 'Engineering', team.name
    assert_equal User.last, team.owner

    team_member = team.team_members.find_by(user: User.last)
    assert team_member.present?
    assert_equal 'admin', team_member.role
  end

  test 'app step requires admin and team in session' do
    get setup_app_path
    assert_redirected_to setup_path

    create_admin_via_wizard
    get setup_app_path
    assert_redirected_to setup_team_path
  end

  test 'app step shows form when admin and team exist in session' do
    create_admin_via_wizard
    create_team_via_wizard

    get setup_app_path
    assert_response :success
    assert_select 'h1', text: /Create Your First App/
  end

  test 'create_app creates app and assigns to team' do
    create_admin_via_wizard
    create_team_via_wizard

    assert_difference %w[App.count TeamAssignment.count], 1 do
      post setup_create_app_path, params: {
        app: { name: 'My App', environment: 'production' }
      }
    end

    assert_redirected_to setup_complete_path

    app = App.last
    assert_equal 'My App', app.name
    assert_equal 'production', app.environment
    assert app.ingestion_key.present?

    team_assignment = TeamAssignment.last
    assert_equal Team.last, team_assignment.team
    assert_equal app, team_assignment.app
  end

  test 'complete step requires setup in progress or admin' do
    # Without any setup, redirects to setup start
    get setup_complete_path
    assert_redirected_to setup_path

    # Partial setup also redirects to setup start
    create_admin_via_wizard
    get setup_complete_path
    assert_redirected_to setup_path

    create_team_via_wizard
    get setup_complete_path
    assert_redirected_to setup_path
  end

  test 'site admin can view complete page after setup' do
    # Complete the full setup first
    create_admin_via_wizard
    create_team_via_wizard
    create_app_via_wizard
    get setup_complete_path
    assert_response :success

    # Now we're logged in as admin, try viewing again
    get '/setup/complete'
    assert_response :success
    assert_select 'h1', text: /Setup Information/
  end

  test 'complete step shows ingestion key and logs user in' do
    create_admin_via_wizard
    create_team_via_wizard
    create_app_via_wizard

    get setup_complete_path
    assert_response :success

    # User should be logged in
    assert cookies[:session_id].present?

    # Should show ingestion key
    app = App.last
    assert_select 'code', text: app.ingestion_key
  end

  test 'non-setup routes redirect to setup when no users exist' do
    get root_path
    assert_redirected_to setup_path
  end

  test 'API routes still work when no users exist' do
    # API routes should not redirect to setup
    post ingest_v1_errors_path,
      params: { error_class: 'Test', error_message: 'Test' }.to_json,
      headers: {
        'Content-Type' => 'application/json',
        'Checkend-Ingestion-Key' => 'invalid'
      }
    assert_response :unauthorized # Not redirected to setup
  end

  test 'health check works when no users exist' do
    get rails_health_check_path
    assert_response :success
  end

  test 'full wizard flow completes successfully' do
    # Record initial counts
    initial_user_count = User.count
    initial_team_count = Team.count
    initial_app_count = App.count

    # Step 1: Create admin
    get setup_path
    assert_response :success

    post setup_admin_path, params: {
      user: {
        email_address: 'wizard_admin@example.com',
        password: 'securepassword123',
        password_confirmation: 'securepassword123'
      }
    }
    assert_redirected_to setup_team_path

    # Step 2: Create team
    get setup_team_path
    assert_response :success

    post setup_create_team_path, params: {
      team: { name: 'Wizard Team' }
    }
    assert_redirected_to setup_app_path

    # Step 3: Create app
    get setup_app_path
    assert_response :success

    post setup_create_app_path, params: {
      app: { name: 'Wizard App', environment: 'production' }
    }
    assert_redirected_to setup_complete_path

    # Step 4: Complete
    get setup_complete_path
    assert_response :success

    # Verify resources were created (compare to initial counts)
    assert_equal initial_user_count + 1, User.count
    assert_equal initial_team_count + 1, Team.count
    assert_equal initial_app_count + 1, App.count

    # Verify the created user
    user = User.find_by(email_address: 'wizard_admin@example.com')
    assert user.present?
    assert user.site_admin?

    # Verify team was created and user is owner/admin
    team = Team.find_by(name: 'Wizard Team')
    assert team.present?
    assert_equal user, team.owner
    assert team.team_members.exists?(user: user, role: 'admin')

    # Verify app was created and assigned to team
    app = App.find_by(name: 'Wizard App')
    assert app.present?
    assert app.ingestion_key.present?
    assert TeamAssignment.exists?(team: team, app: app)

    # User should be logged in
    assert cookies[:session_id].present?

    # Setup routes should now 404
    get '/setup'
    assert_response :not_found
  end

  private

  def create_admin_via_wizard
    post setup_admin_path, params: {
      user: {
        email_address: 'admin@example.com',
        password: 'password123',
        password_confirmation: 'password123'
      }
    }
  end

  def create_team_via_wizard
    post setup_create_team_path, params: {
      team: { name: 'Test Team' }
    }
  end

  def create_app_via_wizard
    post setup_create_app_path, params: {
      app: { name: 'Test App', environment: 'production' }
    }
  end
end
