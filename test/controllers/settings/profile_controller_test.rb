require 'test_helper'

class Settings::ProfileControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
  end

  test 'should get show when logged in' do
    get settings_profile_path
    assert_response :success
  end

  test 'should redirect to login when not logged in' do
    sign_out
    get settings_profile_path
    assert_redirected_to new_session_path
  end

  test 'should display user email' do
    get settings_profile_path
    assert_select 'h1', text: @user.email_address
  end

  test 'should display user initials in avatar' do
    get settings_profile_path
    initials = @user.email_address.first(2).upcase
    assert_match initials, response.body
  end

  test 'should link to password change page' do
    get settings_profile_path
    assert_select "a[href='#{edit_settings_password_path}']"
  end
end
