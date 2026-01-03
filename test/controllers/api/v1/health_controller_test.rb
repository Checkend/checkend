require 'test_helper'

class Api::V1::HealthControllerTest < ActionDispatch::IntegrationTest
  test 'health check does not require authentication' do
    get api_v1_health_url, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal 'ok', body['status']
    assert body['timestamp'].present?
  end
end
