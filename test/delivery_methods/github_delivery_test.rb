require 'test_helper'

class GitHubDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @app.update!(
      github_repository: 'test-owner/test-repo',
      github_token: 'ghp_test_token_12345',
      github_enabled: true
    )
    # Reload associations to ensure GitHub settings are accessible
    @problem.reload
    @app.reload
  end

  test 'delivers notification to GitHub API' do
    # Ensure app has GitHub settings and problem association is fresh
    @app.reload
    @problem.reload
    assert @app.github_enabled?, 'App should have GitHub enabled'
    assert @app.github_repository.present?, 'App should have GitHub repository set'
    assert @app.github_token.present?, 'App should have GitHub token set'

    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"

    # Mock HTTP request
    stub_request(:post, github_url)
      .with(
        headers: {
          'Content-Type' => 'application/json',
          'Accept' => 'application/vnd.github.v3+json',
          'Authorization' => "token #{@app.github_token}"
        },
        body: hash_including('title', 'body', 'labels')
      )
      .to_return(status: 201, body: { id: 123, number: 1, html_url: 'https://github.com/test-owner/test-repo/issues/1' }.to_json)

    # Use actual Noticed flow - deliver and perform enqueued jobs
    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert_requested :post, github_url, times: 1
  end

  test 'formats GitHub issue with title and body' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"
    request_body = nil

    stub_request(:post, github_url)
      .to_return(status: 201, body: { id: 123, number: 1 }.to_json) do |request|
        request_body = JSON.parse(request.body)
        { body: { id: 123, number: 1 }.to_json }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    assert request_body['title'].present?
    assert request_body['body'].present?
    assert request_body['labels'].is_a?(Array)
    assert request_body['title'].include?(@app.name)
    assert request_body['title'].include?(@problem.error_class)
  end

  test 'includes error details in issue body' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"
    request_body = nil

    stub_request(:post, github_url)
      .to_return(status: 201, body: { id: 123, number: 1 }.to_json) do |request|
        request_body = JSON.parse(request.body)
        { body: { id: 123, number: 1 }.to_json }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    body = request_body['body']
    assert_match @problem.error_class, body
    assert_match @problem.error_message, body
    assert_match @problem.notices_count.to_s, body
    # App name is in the title, not the body
    assert_match @app.name, request_body['title']
  end

  test 'includes backtrace in issue body when available' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"
    request_body = nil

    stub_request(:post, github_url)
      .to_return(status: 201, body: { id: 123, number: 1 }.to_json) do |request|
        request_body = JSON.parse(request.body)
        { body: { id: 123, number: 1 }.to_json }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    body = request_body['body']
    # Backtrace should be included if notice has backtrace
    if @notice&.backtrace&.lines&.any?
      assert_match(/Backtrace/, body)
    end
  end

  test 'includes problem URL in issue body' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"
    request_body = nil

    stub_request(:post, github_url)
      .to_return(status: 201, body: { id: 123, number: 1 }.to_json) do |request|
        request_body = JSON.parse(request.body)
        { body: { id: 123, number: 1 }.to_json }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    body = request_body['body']
    assert_match(/View in Checkend/, body)
    assert_match(@app.slug, body)
  end

  test 'uses correct labels for new vs reoccurred errors' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"
    request_body = nil

    stub_request(:post, github_url)
      .to_return(status: 201, body: { id: 123, number: 1 }.to_json) do |request|
        request_body = JSON.parse(request.body)
        { body: { id: 123, number: 1 }.to_json }
      end

    perform_enqueued_jobs do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    assert request_body.present?
    labels = request_body['labels']
    assert labels.include?('bug')
    assert labels.include?('error-report')
    assert_not labels.include?('reoccurred')
  end

  test 'handles GitHub API errors gracefully' do
    github_url = "https://api.github.com/repos/#{@app.github_repository}/issues"

    stub_request(:post, github_url)
      .to_return(status: 401, body: { message: 'Bad credentials' }.to_json)

    # Noticed raises ResponseUnsuccessful when GitHub returns an error
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
    assert_not_nil error, "Expected Noticed::ResponseUnsuccessful to be raised when GitHub returns 401"
    assert_instance_of Noticed::ResponseUnsuccessful, error
    assert_requested :post, github_url, times: 1
    assert_match(/401/, error.message)
  end

  test 'skips delivery when GitHub is not enabled' do
    @app.update!(github_enabled: false)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end

  test 'skips delivery when repository is not set' do
    @app.update!(github_repository: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end

  test 'skips delivery when token is not set' do
    @app.update!(github_token: nil)

    # Should not make any HTTP requests - delivery should complete without errors
    assert_nothing_raised do
      perform_enqueued_jobs do
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
      end
    end
  end
end

