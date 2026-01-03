require 'test_helper'

class UserNotificationPreferencesControllerTest < ActionDispatch::IntegrationTest
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
  test 'edit requires authentication' do
    sign_out
    get edit_app_user_notification_preference_path(@app)
    assert_redirected_to new_session_path
  end

  test 'update requires authentication' do
    sign_out
    patch app_user_notification_preference_path(@app), params: {
      user_notification_preference: { notify_on_new_problem: true }
    }
    assert_redirected_to new_session_path
  end

  # Edit tests
  test 'edit shows form for accessible app' do
    get edit_app_user_notification_preference_path(@app)
    assert_response :success
    assert_select 'form'
  end

  test 'edit returns not found for inaccessible app' do
    other_app = apps(:two)
    get edit_app_user_notification_preference_path(other_app)
    assert_response :not_found
  end

  test 'edit initializes new preference if none exists' do
    assert_nil @user.user_notification_preferences.find_by(app: @app)

    get edit_app_user_notification_preference_path(@app)
    assert_response :success
  end

  test 'edit loads existing preference' do
    preference = @user.user_notification_preferences.create!(
      app: @app,
      notify_on_new_problem: true,
      notify_on_reoccurrence: false
    )

    get edit_app_user_notification_preference_path(@app)
    assert_response :success
  end

  # Update tests
  test 'update creates new preference with valid params' do
    assert_difference('UserNotificationPreference.count', 1) do
      patch app_user_notification_preference_path(@app), params: {
        user_notification_preference: {
          notify_on_new_problem: true,
          notify_on_reoccurrence: true
        }
      }
    end

    assert_redirected_to app_path(@app)
    follow_redirect!
    assert_match 'Notification preferences updated successfully', response.body

    preference = @user.user_notification_preferences.find_by(app: @app)
    assert preference.notify_on_new_problem
    assert preference.notify_on_reoccurrence
  end

  test 'update modifies existing preference' do
    preference = @user.user_notification_preferences.create!(
      app: @app,
      notify_on_new_problem: false,
      notify_on_reoccurrence: false
    )

    assert_no_difference('UserNotificationPreference.count') do
      patch app_user_notification_preference_path(@app), params: {
        user_notification_preference: {
          notify_on_new_problem: true,
          notify_on_reoccurrence: true
        }
      }
    end

    assert_redirected_to app_path(@app)

    preference.reload
    assert preference.notify_on_new_problem
    assert preference.notify_on_reoccurrence
  end

  test 'update can disable notifications' do
    preference = @user.user_notification_preferences.create!(
      app: @app,
      notify_on_new_problem: true,
      notify_on_reoccurrence: true
    )

    patch app_user_notification_preference_path(@app), params: {
      user_notification_preference: {
        notify_on_new_problem: false,
        notify_on_reoccurrence: false
      }
    }

    assert_redirected_to app_path(@app)

    preference.reload
    assert_not preference.notify_on_new_problem
    assert_not preference.notify_on_reoccurrence
  end

  test 'update returns not found for inaccessible app' do
    other_app = apps(:two)

    patch app_user_notification_preference_path(other_app), params: {
      user_notification_preference: { notify_on_new_problem: true }
    }

    assert_response :not_found
  end

  # Access control tests
  test 'different users have separate preferences for same app' do
    # Create preference for first user
    @user.user_notification_preferences.create!(
      app: @app,
      notify_on_new_problem: true,
      notify_on_reoccurrence: false
    )

    # Sign in as other user who also has access
    @team.team_members.find_or_create_by!(user: @other_user, role: 'member')
    sign_in_as(@other_user)

    # Other user should be able to create their own preference
    assert_difference('UserNotificationPreference.count', 1) do
      patch app_user_notification_preference_path(@app), params: {
        user_notification_preference: {
          notify_on_new_problem: false,
          notify_on_reoccurrence: true
        }
      }
    end

    assert_redirected_to app_path(@app)

    # Verify preferences are separate
    user_one_pref = @user.user_notification_preferences.find_by(app: @app)
    user_two_pref = @other_user.user_notification_preferences.find_by(app: @app)

    assert user_one_pref.notify_on_new_problem
    assert_not user_one_pref.notify_on_reoccurrence

    assert_not user_two_pref.notify_on_new_problem
    assert user_two_pref.notify_on_reoccurrence
  end

  # Breadcrumb tests
  test 'edit displays correct breadcrumbs' do
    get edit_app_user_notification_preference_path(@app)
    assert_response :success
    assert_match 'Apps', response.body
    assert_match @app.name, response.body
    assert_match 'Notification Preferences', response.body
  end
end
