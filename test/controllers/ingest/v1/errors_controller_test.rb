require 'test_helper'

class Ingest::V1::ErrorsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @app = apps(:one)
    @valid_payload = {
      error: {
        class: 'NoMethodError',
        message: "undefined method 'foo' for nil:NilClass",
        backtrace: [
          "app/models/user.rb:42:in `validate_email'",
          "app/controllers/users_controller.rb:15:in `create'"
        ]
      }
    }
  end

  # Authentication tests

  test 'returns 401 when no ingestion key provided' do
    post ingest_v1_errors_url, params: @valid_payload, as: :json

    assert_response :unauthorized
    assert_equal({ 'error' => 'Invalid or missing ingestion key' }, response.parsed_body)
  end

  test 'returns 401 when invalid ingestion key provided' do
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => 'invalid-key' },
      as: :json

    assert_response :unauthorized
    assert_equal({ 'error' => 'Invalid or missing ingestion key' }, response.parsed_body)
  end

  test 'returns 201 when valid ingestion key provided' do
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :created
  end

  # Payload validation tests

  test 'returns 422 when error class is missing' do
    payload = { error: { message: 'some error' } }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :unprocessable_entity
    assert response.parsed_body['error'].present?
  end

  test 'returns 422 when error key is missing' do
    post ingest_v1_errors_url,
      params: { foo: 'bar' },
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :unprocessable_entity
  end

  # Success response tests

  test 'creates a notice and returns its data' do
    assert_difference 'Notice.count', 1 do
      post ingest_v1_errors_url,
        params: @valid_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    assert_response :created
    body = response.parsed_body
    assert body['id'].present?
    assert body['problem_id'].present?
  end

  test 'creates a problem for new error fingerprint' do
    assert_difference 'Problem.count', 1 do
      post ingest_v1_errors_url,
        params: @valid_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end
  end

  test 'reuses existing problem for same fingerprint' do
    # First request creates problem
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    # Second request reuses problem
    assert_no_difference 'Problem.count' do
      assert_difference 'Notice.count', 1 do
        post ingest_v1_errors_url,
          params: @valid_payload,
          headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
          as: :json
      end
    end
  end

  test 'uses custom fingerprint when provided' do
    payload_with_fingerprint = @valid_payload.deep_dup
    payload_with_fingerprint[:error][:fingerprint] = 'custom-fingerprint-123'

    post ingest_v1_errors_url,
      params: payload_with_fingerprint,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :created
    problem = Problem.last
    assert_equal 'custom-fingerprint-123', problem.fingerprint
  end

  test 'stores context data' do
    payload = @valid_payload.deep_dup
    payload[:context] = { environment: 'production', custom_key: 'custom_value' }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    notice = Notice.last
    assert_equal 'production', notice.context['environment']
    assert_equal 'custom_value', notice.context['custom_key']
  end

  test 'stores request data' do
    payload = @valid_payload.deep_dup
    payload[:request] = { url: 'https://example.com/users', method: 'POST' }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    notice = Notice.last
    assert_equal 'https://example.com/users', notice.request['url']
    assert_equal 'POST', notice.request['method']
  end

  test 'stores user info' do
    payload = @valid_payload.deep_dup
    payload[:user] = { id: '123', email: 'user@example.com' }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    notice = Notice.last
    assert_equal '123', notice.user_info['id']
    assert_equal 'user@example.com', notice.user_info['email']
  end

  test 'creates backtrace from raw backtrace lines' do
    assert_difference 'Backtrace.count', 1 do
      post ingest_v1_errors_url,
        params: @valid_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    notice = Notice.last
    assert notice.backtrace.present?
    assert_equal 2, notice.backtrace.lines.length
  end

  test 'deduplicates identical backtraces' do
    # First request creates backtrace
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    # Second request with same backtrace reuses it
    assert_no_difference 'Backtrace.count' do
      post ingest_v1_errors_url,
        params: @valid_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json
    end

    # Both notices share the same backtrace
    notices = Notice.last(2)
    assert_equal notices.first.backtrace_id, notices.last.backtrace_id
  end

  test 'updates problem timestamps on new notice' do
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    problem = Problem.last
    first_noticed = problem.first_noticed_at
    last_noticed = problem.last_noticed_at

    travel 1.hour do
      post ingest_v1_errors_url,
        params: @valid_payload,
        headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
        as: :json

      problem.reload
      assert_equal first_noticed, problem.first_noticed_at
      assert problem.last_noticed_at > last_noticed
    end
  end

  test 'increments problem notices_count' do
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    problem = Problem.last
    assert_equal 1, problem.notices_count

    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_equal 2, problem.reload.notices_count
  end

  # Notifier tracking tests

  test 'stores notifier data' do
    payload = @valid_payload.deep_dup
    payload[:notifier] = {
      name: 'checkend-ruby',
      version: '1.0.0',
      language: 'ruby',
      language_version: '3.2.0'
    }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    notice = Notice.last
    assert_equal 'checkend-ruby', notice.notifier['name']
    assert_equal '1.0.0', notice.notifier['version']
    assert_equal 'ruby', notice.notifier['language']
    assert_equal '3.2.0', notice.notifier['language_version']
  end

  test 'notifier is optional for backward compatibility' do
    post ingest_v1_errors_url,
      params: @valid_payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    assert_response :created
    notice = Notice.last
    assert_nil notice.notifier
  end

  test 'stores partial notifier data' do
    payload = @valid_payload.deep_dup
    payload[:notifier] = { name: 'checkend-js' }

    post ingest_v1_errors_url,
      params: payload,
      headers: { 'Checkend-Ingestion-Key' => @app.ingestion_key },
      as: :json

    notice = Notice.last
    assert_equal 'checkend-js', notice.notifier['name']
    assert_nil notice.notifier['version']
  end
end

