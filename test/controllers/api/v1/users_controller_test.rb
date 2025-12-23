require 'test_helper'

class Api::V1::UsersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: ['users:read']
    )
    @write_key = ApiKey.create!(
      name: 'Write Key',
      permissions: ['users:read', 'users:write']
    )
  end

  test 'index requires users:read permission' do
    get api_v1_users_url,
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    assert_kind_of Array, response.parsed_body
  end

  test 'show requires users:read permission' do
    get api_v1_user_url(@user),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal @user.id, body['id']
    assert_equal @user.email_address, body['email_address']
  end

  test 'responses exclude password_digest' do
    get api_v1_user_url(@user),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    assert_not_includes body.keys, 'password_digest'
  end

  test 'create requires users:write permission' do
    assert_difference 'User.count', 1 do
      post api_v1_users_url,
        params: {
          user: {
            email_address: 'newuser@example.com',
            password: 'password123',
            password_confirmation: 'password123'
          }
        },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :created
    user = User.last
    assert_equal 'newuser@example.com', user.email_address
  end

  test 'create returns 422 for invalid user' do
    assert_no_difference 'User.count' do
      post api_v1_users_url,
        params: {
          user: {
            email_address: 'invalid-email',
            password: 'short',
            password_confirmation: 'short'
          }
        },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :unprocessable_entity
  end

  test 'update requires users:write permission' do
    patch api_v1_user_url(@user),
      params: { user: { email_address: 'updated@example.com' } },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'updated@example.com', @user.reload.email_address
  end

  test 'update can change password' do
    old_digest = @user.password_digest

    patch api_v1_user_url(@user),
      params: {
        user: {
          password: 'newpassword123',
          password_confirmation: 'newpassword123'
        }
      },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_not_equal old_digest, @user.reload.password_digest
  end

  test 'destroy requires users:write permission' do
    user_to_delete = User.create!(
      email_address: 'todelete@example.com',
      password: 'password123'
    )

    assert_difference 'User.count', -1 do
      delete api_v1_user_url(user_to_delete),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :no_content
  end
end

