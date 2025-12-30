require 'test_helper'

class Settings::SessionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
  end

  test 'destroy requires authentication' do
    other_session = @user.sessions.create!(user_agent: 'Other Browser', ip_address: '192.168.1.100')
    sign_out
    delete settings_session_path(other_session)
    assert_redirected_to new_session_path
  end

  test 'destroy revokes other session' do
    # Create another session for the user
    other_session = @user.sessions.create!(user_agent: 'Other Browser', ip_address: '192.168.1.100')

    assert_difference -> { @user.sessions.count }, -1 do
      delete settings_session_path(other_session)
    end

    assert_redirected_to settings_profile_path
    assert_equal 'Session revoked successfully.', flash[:notice]
  end

  test 'destroy prevents revoking current session' do
    current_session = @user.sessions.order(created_at: :desc).first

    assert_no_difference -> { @user.sessions.count } do
      delete settings_session_path(current_session)
    end

    assert_redirected_to settings_profile_path
    assert_match(/can't revoke your current session/i, flash[:alert])
  end

  test 'destroy_all_other requires authentication' do
    sign_out
    delete destroy_all_other_settings_sessions_path
    assert_redirected_to new_session_path
  end

  test 'destroy_all_other revokes all other sessions' do
    # Create multiple other sessions
    @user.sessions.create!(user_agent: 'Other Browser 1', ip_address: '192.168.1.100')
    @user.sessions.create!(user_agent: 'Other Browser 2', ip_address: '192.168.1.101')

    initial_count = @user.sessions.count
    assert initial_count >= 3 # current + 2 others

    delete destroy_all_other_settings_sessions_path

    assert_redirected_to settings_profile_path
    assert_equal 'All other sessions have been revoked.', flash[:notice]
    assert_equal 1, @user.sessions.reload.count # only current session remains
  end

  test 'destroy cannot revoke another users session' do
    other_user = users(:two)
    other_session = other_user.sessions.create!(user_agent: 'Other User Browser', ip_address: '10.0.0.1')

    delete settings_session_path(other_session)
    assert_response :not_found
  end
end
