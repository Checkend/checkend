require 'test_helper'

class Api::V1::TeamMembersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @team = teams(:one)
    @user = users(:one)
    @other_user = User.create!(
      email_address: 'other@example.com',
      password: 'password123'
    )
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: [ 'teams:read' ]
    )
    @write_key = ApiKey.create!(
      name: 'Write Key',
      permissions: [ 'teams:read', 'teams:write' ]
    )
  end

  test 'index requires teams:read permission' do
    get api_v1_team_members_url(@team),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    assert_kind_of Array, response.parsed_body
  end

  test 'create requires teams:write permission' do
    assert_difference '@team.team_members.count', 1 do
      post api_v1_team_members_url(@team),
        params: { user_id: @other_user.id, role: 'member' },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :created
    assert @team.team_members.where(user: @other_user).exists?
  end

  test 'create can use email_address instead of user_id' do
    assert_difference '@team.team_members.count', 1 do
      post api_v1_team_members_url(@team),
        params: { email_address: @other_user.email_address, role: 'admin' },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    member = @team.team_members.find_by(user: @other_user)
    assert_equal 'admin', member.role
  end

  test 'create defaults to member role' do
    post api_v1_team_members_url(@team),
      params: { user_id: @other_user.id },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    member = @team.team_members.find_by(user: @other_user)
    assert_equal 'member', member.role
  end

  test 'update requires teams:write permission' do
    member = @team.team_members.create!(user: @other_user, role: 'member')

    patch api_v1_team_member_url(@team, member),
      params: { role: 'admin' },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'admin', member.reload.role
  end

  test 'destroy requires teams:write permission' do
    member = @team.team_members.create!(user: @other_user, role: 'member')

    assert_difference '@team.team_members.count', -1 do
      delete api_v1_team_member_url(@team, member),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :no_content
  end

  test 'destroy prevents removing last admin' do
    admin_member = @team.team_members.where(role: 'admin').first
    # Ensure this is the only admin
    @team.team_members.where(role: 'admin').where.not(id: admin_member.id).destroy_all

    assert_no_difference '@team.team_members.count' do
      delete api_v1_team_member_url(@team, admin_member),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_includes body['message'], 'last admin'
  end
end
