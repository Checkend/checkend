require 'test_helper'

class Api::V1::NoticesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @read_key = ApiKey.create!(
      name: 'Read Key',
      permissions: [ 'notices:read' ]
    )
  end

  test 'index requires notices:read permission' do
    get api_v1_app_problem_notices_url(@app, @problem),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_kind_of Hash, body
    assert_kind_of Array, body['data']
    assert_kind_of Hash, body['pagination']
  end

  test 'index returns 403 without notices:read permission' do
    no_permission_key = ApiKey.create!(name: 'No Perms', permissions: [ 'apps:read' ])

    get api_v1_app_problem_notices_url(@app, @problem),
      headers: { 'Checkend-API-Key' => no_permission_key.key },
      as: :json

    assert_response :forbidden
  end

  test 'show requires notices:read permission' do
    get api_v1_app_problem_notice_url(@app, @problem, @notice),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal @notice.id, body['id']
    assert_equal @notice.error_class, body['error_class']
  end

  test 'show includes backtrace' do
    backtrace = Backtrace.create!(
      fingerprint: 'bt-fp',
      lines: [ 'line1', 'line2' ]
    )
    @notice.update!(backtrace: backtrace)

    get api_v1_app_problem_notice_url(@app, @problem, @notice),
      headers: { 'Checkend-API-Key' => @read_key.key },
      as: :json

    body = response.parsed_body
    assert_kind_of Array, body['backtrace']
    assert_equal 2, body['backtrace'].length
  end
end
