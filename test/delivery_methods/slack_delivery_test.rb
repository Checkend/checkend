require 'test_helper'

class SlackDeliveryTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @app.update!(slack_webhook_url: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL')
  end

  test 'delivers notification to Slack webhook' do
    # Mock HTTP request
    stub_request(:post, @app.slack_webhook_url)
      .with(
        headers: { 'Content-Type' => 'application/json' },
        body: hash_including('blocks')
      )
      .to_return(status: 200, body: 'ok')

    # Use actual Noticed flow
    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

    assert_requested :post, @app.slack_webhook_url, times: 1
  end

  test 'formats Slack message with Block Kit' do
    request_body = nil
    stub_request(:post, @app.slack_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
      end

    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

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
      end

    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

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
      end

    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

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

    # Should not raise
    assert_nothing_raised do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end
  end

  test 'skips delivery when webhook URL is not set' do
    @app.update!(slack_webhook_url: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end
  end
end
