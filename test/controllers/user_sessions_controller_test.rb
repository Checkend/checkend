require 'test_helper'

class UserSessionsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin_user = users(:one)
    @admin_user.update!(site_admin: true)
    @regular_user = users(:two)
    @target_user = users(:two)
    @session = sessions(:one)
    @session.update!(user: @target_user)
  end

  test 'destroy requires site admin' do
    sign_in_as(@regular_user)

    delete user_session_url(@target_user, @session)
    assert_response :not_found
  end

  test 'destroy allows site admin to revoke session' do
    sign_in_as(@admin_user)

    assert_difference('@target_user.sessions.count', -1) do
      delete user_session_url(@target_user, @session)
    end

    assert_redirected_to user_path(@target_user)
    assert_equal 'Session revoked successfully.', flash[:notice]
  end

  test 'destroy_all requires site admin' do
    sign_in_as(@regular_user)

    delete destroy_all_user_sessions_url(@target_user)
    assert_response :not_found
  end

  test 'destroy_all allows site admin to revoke all sessions' do
    sign_in_as(@admin_user)
    # Create additional sessions for target user
    @target_user.sessions.create!(user_agent: 'Test Agent 1', ip_address: '1.1.1.1')
    @target_user.sessions.create!(user_agent: 'Test Agent 2', ip_address: '2.2.2.2')

    delete destroy_all_user_sessions_url(@target_user)

    assert_equal 0, @target_user.sessions.count
    assert_redirected_to user_path(@target_user)
    assert_equal 'All sessions revoked successfully.', flash[:notice]
  end
end
