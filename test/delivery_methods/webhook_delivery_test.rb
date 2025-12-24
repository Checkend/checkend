require 'test_helper'

class WebhookDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @app.update!(webhook_url: 'https://example.com/webhooks/errors')
    # Reload associations to ensure webhook URL is accessible
    @problem.reload
    @app.reload
  end

  test 'delivers notification to webhook URL' do
    # Ensure app has webhook URL and problem association is fresh
    @app.reload
    @problem.reload
    assert @app.webhook_url.present?, 'App should have webhook_url set'

    # Mock HTTP request
    stub_request(:post, @app.webhook_url)
      .with(
        headers: { 'Content-Type' => 'application/json' },
        body: hash_including('event', 'problem', 'app')
      )
      .to_return(status: 200, body: 'ok')

    # Use actual Noticed flow - deliver and perform enqueued jobs
    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert_requested :post, @app.webhook_url, times: 1
  end

  test 'formats webhook payload with event and problem data' do
    request_body = nil
    stub_request(:post, @app.webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    assert_equal 'new_problem', request_body['event']
    assert request_body['problem'].is_a?(Hash)
    assert request_body['app'].is_a?(Hash)
    assert request_body['timestamp'].present?
  end

  test 'includes problem details in payload' do
    request_body = nil
    stub_request(:post, @app.webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    problem_data = request_body['problem']
    assert_equal @problem.id, problem_data['id']
    assert_equal @problem.error_class, problem_data['error_class']
    assert_equal @problem.error_message, problem_data['error_message']
    assert_equal @problem.notices_count, problem_data['notices_count']
    assert problem_data['url'].present?
  end

  test 'includes app details in payload' do
    request_body = nil
    stub_request(:post, @app.webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    app_data = request_body['app']
    assert_equal @app.id, app_data['id']
    assert_equal @app.name, app_data['name']
    assert_equal @app.environment, app_data['environment']
    assert_equal @app.slug, app_data['slug']
  end

  test 'handles webhook API errors gracefully' do
    stub_request(:post, @app.webhook_url)
      .to_return(status: 500, body: 'Internal Server Error')

    # Noticed raises ResponseUnsuccessful when webhook returns an error
    # This is expected behavior - the error should be raised so it can be handled/logged
    # perform_enqueued_jobs may not propagate exceptions, so we catch it inside the block
    error = nil
    perform_enqueued_jobs do
      begin
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      rescue Noticed::ResponseUnsuccessful => e
        error = e
        # Don't re-raise - perform_enqueued_jobs may handle it differently
      end
    end

    # Verify the exception was raised and the request was made
    assert_not_nil error, "Expected Noticed::ResponseUnsuccessful to be raised when webhook returns 500"
    assert_instance_of Noticed::ResponseUnsuccessful, error
    assert_requested :post, @app.webhook_url, times: 1
    assert_match(/500/, error.message)
  end

  test 'skips delivery when webhook URL is not set' do
    @app.update!(webhook_url: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end
end

