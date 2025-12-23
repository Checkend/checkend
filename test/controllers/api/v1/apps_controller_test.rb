require 'test_helper'

class Api::V1::AppsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @app = apps(:one)
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: ['apps:read']
    )
    @write_key = ApiKey.create!(
      name: 'Write Key',
      permissions: ['apps:read', 'apps:write']
    )
  end

  test 'index requires apps:read permission' do
    get api_v1_apps_url,
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    assert_kind_of Array, response.parsed_body
  end

  test 'index returns 403 without apps:read permission' do
    no_permission_key = ApiKey.create!(name: 'No Perms', permissions: ['problems:read'])

    get api_v1_apps_url,
      headers: { 'Checkend-API-Key' => no_permission_key.key },
      as: :json

    assert_response :forbidden
  end

  test 'show requires apps:read permission' do
    get api_v1_app_url(@app),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal @app.id, body['id']
    assert_equal @app.name, body['name']
  end

  test 'show returns 404 for non-existent app' do
    get api_v1_app_url('non-existent'),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :not_found
  end

  test 'create requires apps:write permission' do
    assert_difference 'App.count', 1 do
      post api_v1_apps_url,
        params: { app: { name: 'New App', environment: 'production' } },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :created
    body = response.parsed_body
    assert_equal 'New App', body['name']
  end

  test 'create returns 403 without apps:write permission' do
    assert_no_difference 'App.count' do
      post api_v1_apps_url,
        params: { app: { name: 'New App' } },
        headers: { 'Checkend-API-Key' => @read_key.key },
        as: :json
    end

    assert_response :forbidden
  end

  test 'create returns 422 for invalid app' do
    assert_no_difference 'App.count' do
      post api_v1_apps_url,
        params: { app: { name: '' } },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_equal 'validation_failed', body['error']
  end

  test 'update requires apps:write permission' do
    patch api_v1_app_url(@app),
      params: { app: { name: 'Updated Name' } },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'Updated Name', @app.reload.name
  end

  test 'update returns 403 without apps:write permission' do
    patch api_v1_app_url(@app),
      params: { app: { name: 'Updated Name' } },
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :forbidden
    assert_not_equal 'Updated Name', @app.reload.name
  end

  test 'destroy requires apps:write permission' do
    assert_difference 'App.count', -1 do
      delete api_v1_app_url(@app),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :no_content
  end

  test 'destroy returns 403 without apps:write permission' do
    assert_no_difference 'App.count' do
      delete api_v1_app_url(@app),
        headers: { 'Checkend-API-Key' => @read_key.key },
        as: :json
    end

    assert_response :forbidden
  end

  test 'responses exclude ingestion_key' do
    get api_v1_app_url(@app),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    assert_not_includes body.keys, 'ingestion_key'
  end
end

