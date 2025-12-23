require 'test_helper'

class Api::V1::TagsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @app = apps(:one)
    @problem = problems(:one)
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: ['tags:read']
    )
    @write_key = ApiKey.create!(
      name: 'Write Key',
      permissions: ['tags:read', 'tags:write']
    )
  end

  test 'index requires tags:read permission' do
    tag = Tag.find_or_create_by!(name: 'critical-index')
    @problem.tags << tag unless @problem.tags.include?(tag)

    get api_v1_app_problem_tags_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_kind_of Array, body
    tag_data = body.find { |t| t['id'] == tag.id }
    assert_not_nil tag_data
    assert_equal tag.name, tag_data['name']
  end

  test 'create requires tags:write permission' do
    assert_difference '@problem.tags.count', 1 do
      post api_v1_app_problem_tags_url(@app, @problem),
        params: { name: 'new-tag' },
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :created
    body = response.parsed_body
    assert_equal 'new-tag', body['name']
  end

  test 'create returns 403 without tags:write permission' do
    assert_no_difference '@problem.tags.count' do
      post api_v1_app_problem_tags_url(@app, @problem),
        params: { name: 'new-tag' },
        headers: { 'Checkend-API-Key' => @read_key.key },
        as: :json
    end

    assert_response :forbidden
  end

  test 'create returns 422 when name is blank' do
    post api_v1_app_problem_tags_url(@app, @problem),
      params: { name: '' },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :unprocessable_entity
  end

  test 'destroy requires tags:write permission' do
    tag = Tag.create!(name: 'to-delete')
    @problem.tags << tag

    assert_difference '@problem.tags.count', -1 do
      delete api_v1_app_problem_tag_url(@app, @problem, tag),
        headers: { 'Checkend-API-Key' => @write_key.key },
        as: :json
    end

    assert_response :no_content
  end

  test 'destroy returns 404 for non-existent tag' do
    delete api_v1_app_problem_tag_url(@app, @problem, 99999),
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :not_found
  end
end

