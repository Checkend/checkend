require 'test_helper'

class Settings::PasswordsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    sign_in_as(@user)
  end

  test 'edit requires authentication' do
    sign_out
    get edit_settings_password_path
    assert_redirected_to new_session_path
  end

  test 'edit shows password form' do
    get edit_settings_password_path
    assert_response :success
    assert_select 'form[action=?]', settings_password_path
    assert_select 'input[name="current_password"]'
    assert_select 'input[name="password"]'
  end

  test 'update requires authentication' do
    sign_out
    patch settings_password_path, params: {
      current_password: 'password',
      password: 'newpassword',
      password_confirmation: 'newpassword'
    }
    assert_redirected_to new_session_path
  end

  test 'update with correct current password and matching new passwords' do
    patch settings_password_path, params: {
      current_password: 'password',
      password: 'newpassword123',
      password_confirmation: 'newpassword123'
    }

    assert_redirected_to settings_profile_path
    assert_equal 'Password updated successfully.', flash[:notice]

    # Verify password was actually changed
    @user.reload
    assert @user.authenticate('newpassword123')
  end

  test 'update with incorrect current password' do
    patch settings_password_path, params: {
      current_password: 'wrongpassword',
      password: 'newpassword123',
      password_confirmation: 'newpassword123'
    }

    assert_response :unprocessable_entity
    assert_equal 'Current password is incorrect.', flash[:alert]

    # Verify password was not changed
    @user.reload
    assert @user.authenticate('password')
  end

  test 'update with mismatched new passwords' do
    patch settings_password_path, params: {
      current_password: 'password',
      password: 'newpassword123',
      password_confirmation: 'differentpassword'
    }

    assert_response :unprocessable_entity
    assert_match(/doesn't match/, flash[:alert])

    # Verify password was not changed
    @user.reload
    assert @user.authenticate('password')
  end

  test 'update with blank new password' do
    patch settings_password_path, params: {
      current_password: 'password',
      password: '',
      password_confirmation: ''
    }

    assert_response :unprocessable_entity
    assert_equal "New password can't be blank.", flash[:alert]

    # Verify password was not changed
    @user.reload
    assert @user.authenticate('password')
  end

  test 'update prevents password reuse' do
    # First change the password
    patch settings_password_path, params: {
      current_password: 'password',
      password: 'newpassword123',
      password_confirmation: 'newpassword123'
    }
    assert_redirected_to settings_profile_path

    # Try to change back to the old password
    patch settings_password_path, params: {
      current_password: 'newpassword123',
      password: 'password',
      password_confirmation: 'password'
    }

    assert_response :unprocessable_entity
    assert_match(/has been used recently/, flash[:alert])
  end

  # Verify endpoint tests
  test 'verify requires authentication' do
    sign_out
    post verify_settings_password_path, params: { current_password: 'password' }, as: :json
    assert_redirected_to new_session_path
  end

  test 'verify returns valid true for correct password' do
    post verify_settings_password_path,
         params: { current_password: 'password' },
         as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert json['valid']
  end

  test 'verify returns valid false for incorrect password' do
    post verify_settings_password_path,
         params: { current_password: 'wrongpassword' },
         as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_not json['valid']
  end

  test 'verify returns valid false for empty password' do
    post verify_settings_password_path,
         params: { current_password: '' },
         as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_not json['valid']
  end
end
