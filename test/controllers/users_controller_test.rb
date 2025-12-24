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

    assert_raises(ActiveRecord::RecordNotFound) do
      get users_url
    end
  end

  test 'index allows site admin' do
    sign_in_as(@admin_user)

    get users_url

    assert_response :success
    assert_select 'h1', text: 'Users'
  end

  test 'show requires site admin' do
    sign_in_as(@regular_user)

    assert_raises(ActiveRecord::RecordNotFound) do
      get user_url(@other_user)
    end
  end

  test 'show allows site admin' do
    sign_in_as(@admin_user)

    get user_url(@other_user)

    assert_response :success
    assert_select 'h1', text: 'User Details'
  end

  test 'edit requires site admin' do
    sign_in_as(@regular_user)

    assert_raises(ActiveRecord::RecordNotFound) do
      get edit_user_url(@other_user)
    end
  end

  test 'edit allows site admin' do
    sign_in_as(@admin_user)

    get edit_user_url(@other_user)

    assert_response :success
    assert_select 'h1', text: 'Edit User'
  end

  test 'update requires site admin' do
    sign_in_as(@regular_user)

    assert_raises(ActiveRecord::RecordNotFound) do
      patch user_url(@other_user), params: {
        user: {
          email_address: 'updated@example.com'
        }
      }
    end
  end

  test 'update allows site admin' do
    sign_in_as(@admin_user)

    patch user_url(@other_user), params: {
      user: {
        email_address: 'updated@example.com'
      }
    }

    assert_redirected_to user_url(@other_user)
    assert_equal 'updated@example.com', @other_user.reload.email_address
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

    assert_raises(ActiveRecord::RecordNotFound) do
      delete user_url(@other_user)
    end
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

    assert_raises(ActiveRecord::RecordNotFound) do
      get users_url
    end

    assert_raises(ActiveRecord::RecordNotFound) do
      get user_url(@other_user)
    end

    assert_raises(ActiveRecord::RecordNotFound) do
      get edit_user_url(@other_user)
    end
  end
end
