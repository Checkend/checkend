require 'test_helper'

class Api::V1::BaseControllerTest < ActionDispatch::IntegrationTest
  setup do
    @api_key = ApiKey.create!(
      name: 'Test Key',
      permissions: [ 'apps:read', 'apps:write' ]
    )
  end

  test 'returns 401 when no API key provided' do
    get api_v1_apps_url, as: :json

    assert_response :unauthorized
    body = response.parsed_body
    assert_equal 'unauthorized', body['error']
    assert_includes body['message'], 'Missing API key'
  end

  test 'returns 401 when invalid API key provided' do
    get api_v1_apps_url,
      headers: { 'Checkend-API-Key' => 'invalid-key' },
      as: :json

    assert_response :unauthorized
    body = response.parsed_body
    assert_equal 'unauthorized', body['error']
    assert_includes body['message'], 'Invalid or revoked API key'
  end

  test 'returns 401 when revoked API key provided' do
    @api_key.revoke!

    get api_v1_apps_url,
      headers: { 'Checkend-API-Key' => @api_key.key },
      as: :json

    assert_response :unauthorized
  end

  test 'updates last_used_at on successful request' do
    assert_nil @api_key.last_used_at

    get api_v1_apps_url,
      headers: { 'Checkend-API-Key' => @api_key.key },
      as: :json

    assert_response :success
    assert_not_nil @api_key.reload.last_used_at
  end

  test 'returns 403 when missing required permission' do
    read_only_key = ApiKey.create!(
      name: 'Read Only',
      permissions: [ 'apps:read' ]
    )

    post api_v1_apps_url,
      params: { app: { name: 'Test App' } },
      headers: { 'Checkend-API-Key' => read_only_key.key },
      as: :json

    assert_response :forbidden
    body = response.parsed_body
    assert_equal 'forbidden', body['error']
    assert_includes body['message'], 'apps:write'
  end

  test 'handles RecordNotFound with 404' do
    get api_v1_app_url('non-existent'),
      headers: { 'Checkend-API-Key' => @api_key.key },
      as: :json

    assert_response :not_found
    body = response.parsed_body
    assert_equal 'not_found', body['error']
  end
end
