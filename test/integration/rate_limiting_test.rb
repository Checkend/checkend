require 'test_helper'

class RateLimitingTest < ActionDispatch::IntegrationTest
  # Use a small limit for faster tests
  TEST_LIMIT = 3

  setup do
    @app = apps(:one)
    @other_app = apps(:two)
    @request_counter = 0

    # Clear rate limit cache and reset throttles before each test
    Rack::Attack.cache.store.clear
    Rack::Attack.reset!

    # Clear Rails cache to reset deduplication state
    Rails.cache.clear

    # Override the throttle with a smaller limit for testing
    Rack::Attack.throttle('ingestion/minute', limit: TEST_LIMIT, period: 1.minute) do |request|
      request.env['HTTP_CHECKEND_INGESTION_KEY'] if request.post? && request.path.start_with?('/ingest/')
    end
  end

  # Helper to generate unique payloads to avoid deduplication
  def unique_payload
    @request_counter += 1
    {
      error: {
        class: 'NoMethodError',
        message: "undefined method 'foo' for nil:NilClass",
        backtrace: [ "app/models/user.rb:#{@request_counter}:in `method_#{@request_counter}'" ]
      }
    }
  end

  teardown do
    # Reset rate limit cache after each test
    Rack::Attack.cache.store.clear

    # Remove the test throttle to avoid affecting other tests in parallel
    Rack::Attack.throttles.delete('ingestion/minute')
  end

  test 'allows requests within per-minute limit' do
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json

      assert_response :created
    end
  end

  test 'returns 429 when per-minute limit exceeded' do
    # Exhaust the limit
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # Next request should be throttled
    post ingest_v1_errors_url,
      params: unique_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :too_many_requests
    assert response.headers['Retry-After'].present?
    assert_match(/Rate limit exceeded/, response.parsed_body['error'])
  end

  test 'rate limits are applied per ingestion key' do
    # Exhaust limit for first app
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # First app should be throttled
    post ingest_v1_errors_url,
      params: unique_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :too_many_requests

    # Second app should still be able to make requests
    post ingest_v1_errors_url,
      params: unique_payload,
      headers: { 'Checkend-Ingestion-Key' => @other_app.ingestion_key },
      as: :json

    assert_response :created
  end

  test '429 response includes Retry-After header' do
    # Exhaust the limit
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # Trigger throttle
    post ingest_v1_errors_url,
      params: unique_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :too_many_requests
    retry_after = response.headers['Retry-After'].to_i
    assert retry_after > 0
    assert retry_after <= 60 # Should be within 1 minute
  end

  test '429 response is JSON formatted' do
    # Exhaust the limit
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # Trigger throttle
    post ingest_v1_errors_url,
      params: unique_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :too_many_requests
    assert response.content_type.start_with?('application/json')
    assert response.parsed_body['error'].present?
  end

  test 'non-ingestion routes are not rate limited by ingestion throttle' do
    # Exhaust ingestion limit
    TEST_LIMIT.times do
      post ingest_v1_errors_url,
        params: unique_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # Login page should not be affected by ingestion rate limits
    get new_session_url
    assert_response :success
  end
end
