require 'test_helper'

class SlackDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @app.update!(slack_webhook_url: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL')
    # Reload associations to ensure webhook URL is accessible
    @problem.reload
    @app.reload
  end

  test 'delivers notification to Slack webhook' do
    # Ensure app has webhook URL and problem association is fresh
    @app.reload
    @problem.reload
    assert @app.slack_webhook_url.present?, 'App should have slack_webhook_url set'
    assert_equal @app.slack_webhook_url, @problem.app.slack_webhook_url, "Problem's app should have webhook URL"

    # Mock HTTP request
    stub_request(:post, @app.slack_webhook_url)
      .with(
        headers: { 'Content-Type' => 'application/json' },
        body: hash_including('blocks')
      )
      .to_return(status: 200, body: 'ok')

    # Use actual Noticed flow - deliver and perform enqueued jobs
    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert_requested :post, @app.slack_webhook_url, times: 1
  end

  test 'formats Slack message with Block Kit' do
    request_body = nil
    stub_request(:post, @app.slack_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    assert request_body['blocks'].is_a?(Array)
    assert request_body['blocks'].any? { |b| b['type'] == 'header' }
    assert request_body['blocks'].any? { |b| b['type'] == 'section' }
  end

  test 'includes error class in header' do
    request_body = nil
    stub_request(:post, @app.slack_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    header_block = request_body['blocks'].find { |b| b['type'] == 'header' }
    assert header_block
    assert_match @problem.error_class, header_block.dig('text', 'text')
  end

  test 'includes link to problem detail page' do
    request_body = nil
    stub_request(:post, @app.slack_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    # Check for button with URL
    action_block = request_body['blocks'].find { |b| b['type'] == 'actions' }
    assert action_block
    button = action_block['elements'].find { |e| e['type'] == 'button' }
    assert button
    assert button['url'].present?
  end

  test 'handles Slack API errors gracefully' do
    stub_request(:post, @app.slack_webhook_url)
      .to_return(status: 404, body: 'invalid_webhook')

    # Noticed raises ResponseUnsuccessful when Slack returns an error
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
    assert_not_nil error, 'Expected Noticed::ResponseUnsuccessful to be raised when Slack returns 404'
    assert_instance_of Noticed::ResponseUnsuccessful, error
    assert_requested :post, @app.slack_webhook_url, times: 1
    assert_match(/404/, error.message)
  end

  test 'skips delivery when webhook URL is not set' do
    @app.update!(slack_webhook_url: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end
end
