require 'test_helper'

class Api::V1::TeamsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @team = teams(:one)
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
    get api_v1_teams_url,
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    assert_kind_of Array, response.parsed_body
  end

  test 'show requires teams:read permission' do
    get api_v1_team_url(@team.slug),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal @team.id, body['id']
    assert_equal @team.name, body['name']
  end

  test 'create requires teams:write permission' do
    assert_difference 'Team.count', 1 do
      post api_v1_teams_url,
        params: { team: { name: 'New Team Unique', owner_id: @user.id } },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :created
    team = Team.last
    assert_equal 'New Team Unique', team.name
    assert_equal @user.id, team.owner_id
    # Owner should be added as admin
    assert team.team_members.where(user: @user, role: 'admin').exists?
  end

  test 'create returns 422 when owner_id is missing' do
    post api_v1_teams_url,
      params: { team: { name: 'New Team Missing Owner' } },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :unprocessable_entity
  end

  test 'update requires teams:write permission' do
    patch api_v1_team_url(@team.slug),
      params: { team: { name: 'Updated Name' } },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'Updated Name', @team.reload.name
  end

  test 'destroy requires teams:write permission' do
    # Create a team without dependencies for deletion
    deletable_team = Team.create!(name: 'Deletable Team', owner: @user)

    assert_difference 'Team.count', -1 do
      delete api_v1_team_url(deletable_team),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :no_content
  end

  test 'apps_index requires teams:read permission' do
    app = apps(:one)
    @team.team_assignments.find_or_create_by!(app: app)

    get apps_api_v1_team_url(@team.slug),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_kind_of Array, body
    assert_equal app.id, body.first['id']
  end

  test 'apps_create requires teams:write permission' do
    app = apps(:one)
    # Remove any existing assignment first
    @team.team_assignments.where(app: app).destroy_all

    post apps_api_v1_team_url(@team.slug),
      params: { app_id: app.slug },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :created
    assert @team.reload.team_assignments.where(app: app).exists?
  end

  test 'apps_destroy requires teams:write permission' do
    app = apps(:one)
    @team.team_assignments.find_or_create_by!(app: app)

    delete "/api/v1/teams/#{@team.slug}/apps/#{app.slug}",
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :no_content
    assert_not @team.reload.team_assignments.where(app: app).exists?
  end
end
