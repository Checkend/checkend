require 'test_helper'

class ApiKeysControllerTest < ActionDispatch::IntegrationTest
  include SessionTestHelper

  setup do
    @user = users(:one)
    sign_in_as(@user)
    @api_key = ApiKey.create!(
      name: 'Test Key',
      permissions: ['apps:read']
    )
  end

  test 'index requires authentication' do
    sign_out

    get api_keys_url

    assert_redirected_to new_session_path
  end

  test 'index shows all API keys' do
    get api_keys_url

    assert_response :success
    assert_select 'h1', text: 'API Keys'
  end

  test 'show requires authentication' do
    sign_out

    get api_key_url(@api_key)

    assert_redirected_to new_session_path
  end

  test 'show displays API key details' do
    get api_key_url(@api_key)

    assert_response :success
    assert_select 'h1', text: @api_key.name
  end

  test 'new requires authentication' do
    sign_out

    get new_api_key_url

    assert_redirected_to new_session_path
  end

  test 'new displays form with permission checkboxes' do
    get new_api_key_url

    assert_response :success
    assert_select 'form'
    assert_select 'input[type="checkbox"]'
  end

  test 'create requires authentication' do
    sign_out

    assert_no_difference 'ApiKey.count' do
      post api_keys_url, params: {
        api_key: {
          name: 'New Key',
          permissions: ['apps:read']
        }
      }
    end

    assert_redirected_to new_session_path
  end

  test 'create creates new API key with permissions' do
    assert_difference 'ApiKey.count', 1 do
      post api_keys_url, params: {
        api_key: {
          name: 'New Key',
          permissions: ['apps:read', 'apps:write']
        }
      }
    end

    api_key = ApiKey.last
    assert_equal 'New Key', api_key.name
    assert_includes api_key.permissions, 'apps:read'
    assert_includes api_key.permissions, 'apps:write'
    assert_redirected_to api_key_path(api_key)
  end

  test 'create redirects with notice about saving key' do
    post api_keys_url, params: {
      api_key: {
        name: 'New Key',
        permissions: ['apps:read']
      }
    }

    assert_redirected_to api_key_path(ApiKey.last)
    assert_match /Save this key now/, flash[:notice]
  end

  test 'create renders form with errors on validation failure' do
    assert_no_difference 'ApiKey.count' do
      post api_keys_url, params: {
        api_key: {
          name: '',
          permissions: []
        }
      }
    end

    assert_response :unprocessable_entity
    # Check for error message in the response body (HTML may escape apostrophes)
    assert_match /can.*t be blank/i, response.body
  end

  test 'destroy requires authentication' do
    sign_out

    assert_no_difference 'ApiKey.count' do
      delete api_key_url(@api_key)
    end

    assert_redirected_to new_session_path
  end

  test 'destroy deletes API key' do
    assert_difference 'ApiKey.count', -1 do
      delete api_key_url(@api_key)
    end

    assert_redirected_to api_keys_path
  end

  test 'revoke requires authentication' do
    sign_out

    assert_no_changes '@api_key.reload.revoked_at' do
      delete revoke_api_key_url(@api_key)
    end

    assert_redirected_to new_session_path
  end

  test 'revoke sets revoked_at timestamp' do
    assert_nil @api_key.revoked_at

    assert_changes '@api_key.reload.revoked_at', from: nil do
      delete revoke_api_key_url(@api_key)
    end

    assert_redirected_to api_key_path(@api_key)
    assert_not_nil @api_key.reload.revoked_at
  end
end

