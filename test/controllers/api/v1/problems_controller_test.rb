require 'test_helper'

class Api::V1::ProblemsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @app = apps(:one)
    @problem = problems(:one)
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: [ 'problems:read' ]
    )
    @write_key = ApiKey.create!(
      name: 'Write Key',
      permissions: [ 'problems:read', 'problems:write' ]
    )
  end

  test 'index requires problems:read permission' do
    get api_v1_app_problems_url(@app),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_kind_of Hash, body
    assert_kind_of Array, body['data']
    assert_kind_of Hash, body['pagination']
  end

  test 'index filters by status' do
    resolved_problem = @app.problems.create!(
      error_class: 'ResolvedError',
      error_message: 'Resolved',
      fingerprint: 'resolved-fp',
      status: 'resolved'
    )

    get api_v1_app_problems_url(@app, status: 'resolved'),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    problem_ids = body['data'].map { |p| p['id'] }
    assert_includes problem_ids, resolved_problem.id
    assert_not_includes problem_ids, @problem.id if @problem.status != 'resolved'
  end

  test 'index supports pagination' do
    get api_v1_app_problems_url(@app, page: 1, per_page: 2),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    assert_equal 1, body['pagination']['page']
    assert_equal 2, body['pagination']['per_page']
    assert body['pagination']['total'].present?
    assert body['pagination']['total_pages'].present?
  end

  test 'show requires problems:read permission' do
    get api_v1_app_problem_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal @problem.id, body['id']
    assert_equal @problem.error_class, body['error_class']
  end

  test 'resolve requires problems:write permission' do
    @problem.update!(status: 'unresolved', resolved_at: nil)

    post resolve_api_v1_app_problem_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'resolved', @problem.reload.status
    assert_not_nil @problem.resolved_at
  end

  test 'resolve returns 403 without problems:write permission' do
    post resolve_api_v1_app_problem_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :forbidden
  end

  test 'unresolve requires problems:write permission' do
    @problem.update!(status: 'resolved', resolved_at: Time.current)

    post unresolve_api_v1_app_problem_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'unresolved', @problem.reload.status
    assert_nil @problem.resolved_at
  end

  test 'bulk_resolve requires problems:write permission' do
    problem2 = @app.problems.create!(
      error_class: 'Error2',
      error_message: 'Message2',
      fingerprint: 'fp2',
      status: 'unresolved'
    )

    post bulk_resolve_api_v1_app_problems_url(@app),
      params: { problem_ids: [ @problem.id, problem2.id ] },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :success
    assert_equal 'resolved', @problem.reload.status
    assert_equal 'resolved', problem2.reload.status
  end

  test 'bulk_resolve returns 422 when problem_ids is empty' do
    post bulk_resolve_api_v1_app_problems_url(@app),
      params: { problem_ids: [] },
      headers: { 'Checkend-API-Key' => @write_key.key },
      as: :json

    assert_response :unprocessable_entity
  end

  test 'responses include tags' do
    tag = Tag.find_or_create_by!(name: 'critical-test')
    @problem.tags << tag unless @problem.tags.include?(tag)

    get api_v1_app_problem_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    assert_kind_of Array, body['tags']
    tag_data = body['tags'].find { |t| t['id'] == tag.id }
    assert_not_nil tag_data
    assert_equal tag.name, tag_data['name']
  end
end
