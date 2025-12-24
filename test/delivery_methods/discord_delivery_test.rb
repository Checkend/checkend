require 'test_helper'

class DiscordDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @app.update!(discord_webhook_url: 'https://discord.com/api/webhooks/TEST/WEBHOOK/URL')
    # Reload associations to ensure webhook URL is accessible
    @problem.reload
    @app.reload
  end

  test 'delivers notification to Discord webhook' do
    # Ensure app has webhook URL and problem association is fresh
    @app.reload
    @problem.reload
    assert @app.discord_webhook_url.present?, 'App should have discord_webhook_url set'

    # Mock HTTP request
    stub_request(:post, @app.discord_webhook_url)
      .with(
        headers: { 'Content-Type' => 'application/json' },
        body: hash_including('embeds')
      )
      .to_return(status: 200, body: 'ok')

    # Use actual Noticed flow - deliver and perform enqueued jobs
    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert_requested :post, @app.discord_webhook_url, times: 1
  end

  test 'formats Discord message with Rich Embed' do
    request_body = nil
    stub_request(:post, @app.discord_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    assert request_body['embeds'].is_a?(Array)
    embed = request_body['embeds'].first
    assert embed
    assert embed['title'].present?
    assert embed['description'].present?
    assert embed['fields'].is_a?(Array)
    assert embed['color'].present?
  end

  test 'includes error class in embed title' do
    request_body = nil
    stub_request(:post, @app.discord_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    embed = request_body['embeds'].first
    assert_match @problem.error_class, embed['title']
  end

  test 'includes problem URL in embed' do
    request_body = nil
    stub_request(:post, @app.discord_webhook_url)
      .to_return(status: 200, body: 'ok') do |request|
        request_body = JSON.parse(request.body)
        { body: 'ok' }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    embed = request_body['embeds'].first
    assert embed['url'].present?
    assert_match @app.slug, embed['url']
  end

  test 'handles Discord API errors gracefully' do
    stub_request(:post, @app.discord_webhook_url)
      .to_return(status: 404, body: 'invalid_webhook')

    # Noticed raises ResponseUnsuccessful when Discord returns an error
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
    assert_not_nil error, "Expected Noticed::ResponseUnsuccessful to be raised when Discord returns 404"
    assert_instance_of Noticed::ResponseUnsuccessful, error
    assert_requested :post, @app.discord_webhook_url, times: 1
    assert_match(/404/, error.message)
  end

  test 'skips delivery when webhook URL is not set' do
    @app.update!(discord_webhook_url: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end
end

