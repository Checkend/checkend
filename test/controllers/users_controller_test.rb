require 'test_helper'

class UsersControllerTest < ActionDispatch::IntegrationTest
  include SessionTestHelper

  setup do
    @admin_user = users(:admin)
    @regular_user = users(:one)
    @other_user = users(:two)
  end

  test 'index requires site admin' do
    sign_in_as(@regular_user)

    get users_url
    assert_response :not_found
  end

  test 'index allows site admin' do
    sign_in_as(@admin_user)

    get users_url

    assert_response :success
    assert_select 'h1', text: 'Users'
  end

  test 'show requires site admin' do
    sign_in_as(@regular_user)

    get user_url(@other_user)
    assert_response :not_found
  end

  test 'show allows site admin' do
    sign_in_as(@admin_user)

    get user_url(@other_user)

    assert_response :success
    assert_select 'h1', text: 'User Details'
  end

  test 'new requires site admin' do
    sign_in_as(@regular_user)

    get new_user_url
    assert_response :not_found
  end

  test 'new allows site admin' do
    sign_in_as(@admin_user)

    get new_user_url

    assert_response :success
    assert_select 'h1', text: 'New User'
  end

  test 'create requires site admin' do
    sign_in_as(@regular_user)

    post users_url, params: {
      user: {
        email_address: 'newuser@example.com',
        password: 'password123'
      }
    }
    assert_response :not_found
  end

  test 'create allows site admin' do
    sign_in_as(@admin_user)

    assert_difference('User.count', 1) do
      post users_url, params: {
        user: {
          email_address: 'newuser@example.com',
          password: 'password123'
        }
      }
    end

    assert_redirected_to user_url(User.last)
    assert_equal 'newuser@example.com', User.last.email_address
  end

  test 'create allows site admin to set site_admin flag' do
    sign_in_as(@admin_user)

    post users_url, params: {
      user: {
        email_address: 'newadmin@example.com',
        password: 'password123',
        site_admin: true
      }
    }

    assert_redirected_to user_url(User.last)
    assert User.last.site_admin?
  end

  test 'create with invalid data renders new' do
    sign_in_as(@admin_user)

    assert_no_difference('User.count') do
      post users_url, params: {
        user: {
          email_address: '',
          password: 'short'
        }
      }
    end

    assert_response :unprocessable_entity
  end

  test 'edit requires site admin' do
    sign_in_as(@regular_user)

    get edit_user_url(@other_user)
    assert_response :not_found
  end

  test 'edit allows site admin' do
    sign_in_as(@admin_user)

    get edit_user_url(@other_user)

    assert_response :success
    assert_select 'h1', text: 'Edit User'
  end

  test 'update requires site admin' do
    sign_in_as(@regular_user)

    patch user_url(@other_user), params: {
      user: {
        email_address: 'updated@example.com'
      }
    }
    assert_response :not_found
  end

  test 'update allows site admin' do
    sign_in_as(@admin_user)

    patch user_url(@other_user), params: {
      user: {
        email_address: 'updated@example.com'
      }
    }

    @other_user.reload
    assert_redirected_to user_url(@other_user)
    assert_equal 'updated@example.com', @other_user.email_address
    assert_equal 'updated', @other_user.slug
  end

  test 'update allows site admin to toggle site_admin flag' do
    sign_in_as(@admin_user)
    assert_not @other_user.site_admin?

    patch user_url(@other_user), params: {
      user: {
        site_admin: true
      }
    }

    assert_redirected_to user_url(@other_user)
    assert @other_user.reload.site_admin?
  end

  test 'destroy requires site admin' do
    sign_in_as(@regular_user)

    delete user_url(@other_user)
    assert_response :not_found
  end

  test 'destroy allows site admin' do
    sign_in_as(@admin_user)

    assert_difference('User.count', -1) do
      delete user_url(@other_user)
    end

    assert_redirected_to users_path
  end

  test 'all actions require authentication' do
    sign_out

    get users_url
    assert_redirected_to new_session_path

    get new_user_url
    assert_redirected_to new_session_path

    get user_url(@other_user)
    assert_redirected_to new_session_path

    get edit_user_url(@other_user)
    assert_redirected_to new_session_path
  end
end
