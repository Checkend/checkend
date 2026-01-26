require 'test_helper'

class ErrorIngestionServiceTest < ActiveSupport::TestCase
  setup do
    @app = apps(:one)
    @user = users(:one)
    @team = teams(:one)
    # Set up team access for notifications
    @team.team_members.find_or_create_by!(user: @user, role: 'admin')
    @team.team_assignments.find_or_create_by!(app: @app)
    @valid_params = {
      class: 'NoMethodError',
      message: "undefined method 'foo' for nil:NilClass",
      backtrace: [
        "app/models/user.rb:42:in `validate_email'",
        "app/controllers/users_controller.rb:15:in `create'"
      ]
    }
    # Clear cache to reset deduplication state between tests
    Rails.cache.clear
  end

  test 'returns success result with notice and problem' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params
    )

    assert result.success?
    assert_instance_of Notice, result.notice
    assert_instance_of Problem, result.problem
    assert_nil result.error
  end

  test 'returns failure when error class is missing' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: { message: 'some error' }
    )

    assert_not result.success?
    assert_equal 'error.class is required', result.error
  end

  test 'creates problem with correct attributes' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params
    )

    problem = result.problem
    assert_equal @app, problem.app
    assert_equal 'NoMethodError', problem.error_class
    assert_equal "undefined method 'foo' for nil:NilClass", problem.error_message
    assert problem.fingerprint.present?
  end

  test 'creates notice with correct attributes' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params,
      context_params: { environment: 'production' },
      request_params: { url: 'https://example.com' },
      user_params: { id: '123' }
    )

    notice = result.notice
    assert_equal 'NoMethodError', notice.error_class
    assert_equal 'production', notice.context['environment']
    assert_equal 'https://example.com', notice.request['url']
    assert_equal '123', notice.user_info['id']
  end

  test 'creates backtrace from raw lines' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params
    )

    backtrace = result.notice.backtrace
    assert backtrace.present?
    assert_equal 2, backtrace.lines.length
    assert_equal 'app/models/user.rb', backtrace.lines[0]['file']
  end

  test 'reuses existing problem for same fingerprint' do
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    # Clear cache to create a new notice instead of deduplicating
    Rails.cache.clear
    result2 = ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert_equal result1.problem.id, result2.problem.id
    assert_not_equal result1.notice.id, result2.notice.id
  end

  test 'creates different problems for different errors' do
    params1 = @valid_params.dup
    params2 = @valid_params.merge(
      class: 'ArgumentError',
      backtrace: [ "app/services/foo.rb:10:in `bar'" ]
    )

    result1 = ErrorIngestionService.call(app: @app, error_params: params1)
    result2 = ErrorIngestionService.call(app: @app, error_params: params2)

    assert_not_equal result1.problem.id, result2.problem.id
  end

  test 'uses custom fingerprint when provided' do
    params = @valid_params.merge(fingerprint: 'my-custom-fingerprint')

    result = ErrorIngestionService.call(app: @app, error_params: params)

    assert_equal 'my-custom-fingerprint', result.problem.fingerprint
  end

  test 'deduplicates identical backtraces' do
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    # Clear cache to create a new notice instead of deduplicating
    Rails.cache.clear
    result2 = ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert_equal result1.notice.backtrace_id, result2.notice.backtrace_id
  end

  test 'handles empty backtrace' do
    params = @valid_params.merge(backtrace: [])

    result = ErrorIngestionService.call(app: @app, error_params: params)

    assert result.success?
    assert_nil result.notice.backtrace
  end

  test 'handles missing backtrace' do
    params = { class: 'NoMethodError', message: 'error' }

    result = ErrorIngestionService.call(app: @app, error_params: params)

    assert result.success?
    assert_nil result.notice.backtrace
  end

  test 'increments problem notices_count' do
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 1, result1.problem.reload.notices_count

    # Clear cache to create a new notice instead of deduplicating
    Rails.cache.clear
    ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 2, result1.problem.reload.notices_count
  end

  # Notification tests

  test 'sends notification for new problem to team members' do
    # Should send to team members who want notifications
    # Fixtures have 2 team members (user one and user two) for team one
    # Both should receive notifications by default
    assert_difference 'Noticed::Notification.count', 2 do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
    end
  end

  test 'does not send notification for existing unresolved problem' do
    # Create first notice (triggers notification)
    ErrorIngestionService.call(app: @app, error_params: @valid_params)

    # Second notice should not trigger notification
    assert_no_difference 'Noticed::Notification.count' do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
    end
  end

  test 'sends notification when resolved problem reoccurs to team members' do
    # Create problem and resolve it (this sends 2 notifications - one to each team member)
    result = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    result.problem.resolve!

    # Clear cache to create a new notice instead of deduplicating
    Rails.cache.clear

    # New notice on resolved problem should trigger reoccurrence notification
    # Should send to both team members
    assert_difference 'Noticed::Notification.count', 2 do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
    end
  end

  test 'auto-unresolves resolved problem when new notice arrives' do
    # Create problem and resolve it
    result = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    result.problem.resolve!
    assert result.problem.resolved?

    # Clear cache to create a new notice instead of deduplicating
    Rails.cache.clear

    # New notice should auto-unresolve
    ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert result.problem.reload.unresolved?
    assert_nil result.problem.resolved_at
  end

  # Notifier tracking tests

  test 'stores notifier params on notice' do
    notifier_params = {
      'name' => 'checkend-ruby',
      'version' => '1.0.0',
      'language' => 'ruby',
      'language_version' => '3.2.0'
    }

    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params,
      notifier_params: notifier_params
    )

    notice = result.notice
    assert_equal 'checkend-ruby', notice.notifier['name']
    assert_equal '1.0.0', notice.notifier['version']
    assert_equal 'ruby', notice.notifier['language']
    assert_equal '3.2.0', notice.notifier['language_version']
  end

  test 'notifier is optional' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params
    )

    assert result.success?
    assert_nil result.notice.notifier
  end

  test 'stores nil for empty notifier params' do
    result = ErrorIngestionService.call(
      app: @app,
      error_params: @valid_params,
      notifier_params: {}
    )

    assert result.success?
    assert_nil result.notice.notifier
  end

  # occurred_at tests

  test 'uses client-provided occurred_at when valid' do
    occurred_at = '2024-12-24T10:30:00Z'
    params = @valid_params.merge(occurred_at: occurred_at)

    result = ErrorIngestionService.call(app: @app, error_params: params)

    assert result.success?
    assert_equal Time.parse(occurred_at), result.notice.occurred_at
  end

  test 'uses current time when occurred_at is not provided' do
    freeze_time do
      result = ErrorIngestionService.call(app: @app, error_params: @valid_params)

      assert result.success?
      assert_equal Time.current, result.notice.occurred_at
    end
  end

  test 'uses current time when occurred_at is blank' do
    params = @valid_params.merge(occurred_at: '')

    freeze_time do
      result = ErrorIngestionService.call(app: @app, error_params: params)

      assert result.success?
      assert_equal Time.current, result.notice.occurred_at
    end
  end

  test 'uses current time when occurred_at is invalid' do
    params = @valid_params.merge(occurred_at: 'not-a-date')

    freeze_time do
      result = ErrorIngestionService.call(app: @app, error_params: params)

      assert result.success?
      assert_equal Time.current, result.notice.occurred_at
    end
  end

  # Deduplication tests

  test 'first notice is not deduplicated' do
    Rails.cache.clear
    result = ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert result.success?
    assert_not result.deduplicated
    assert_equal 1, result.occurrence_count
    assert_not_nil result.notice
  end

  test 'duplicate notice within window is deduplicated' do
    Rails.cache.clear
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    result2 = ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert result2.success?
    assert result2.deduplicated
    assert_equal 2, result2.occurrence_count
    assert_nil result2.notice
    assert_equal result1.problem.id, result2.problem.id
  end

  test 'deduplicated notice increments problem deduplicated_count' do
    Rails.cache.clear
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 0, result1.problem.reload.deduplicated_count

    ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 1, result1.problem.reload.deduplicated_count

    ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 2, result1.problem.reload.deduplicated_count
  end

  test 'deduplicated notice does not create new notice record' do
    Rails.cache.clear
    ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert_no_difference 'Notice.count' do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
    end
  end

  test 'deduplicated notice updates problem last_noticed_at' do
    Rails.cache.clear
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    original_last_noticed = result1.problem.reload.last_noticed_at

    travel 1.minute do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
      assert result1.problem.reload.last_noticed_at > original_last_noticed
    end
  end

  test 'deduplicated notice does not send notifications' do
    Rails.cache.clear
    # First notice sends notifications
    ErrorIngestionService.call(app: @app, error_params: @valid_params)

    # Second notice (deduplicated) should not send notifications
    assert_no_difference 'Noticed::Notification.count' do
      ErrorIngestionService.call(app: @app, error_params: @valid_params)
    end
  end

  test 'deduplicated notice auto-unresolves resolved problem' do
    Rails.cache.clear
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    result1.problem.resolve!
    assert result1.problem.resolved?

    # Clear cache to reset dedup window (simulating new error after window)
    Rails.cache.clear

    # First call after resolve - not deduplicated
    result2 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    # Clear cache again to test auto-unresolve on deduplicated
    Rails.cache.clear

    result2.problem.resolve!
    assert result2.problem.resolved?

    # Second call - deduplicated, should still auto-unresolve
    result3 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    # Create another deduplicated call
    result4 = ErrorIngestionService.call(app: @app, error_params: @valid_params)

    assert result2.problem.reload.unresolved?
  end

  test 'different backtrace is not deduplicated' do
    Rails.cache.clear
    params1 = @valid_params.dup
    params2 = @valid_params.merge(
      backtrace: [ "app/services/different.rb:99:in `other_method'" ]
    )

    result1 = ErrorIngestionService.call(app: @app, error_params: params1)
    result2 = ErrorIngestionService.call(app: @app, error_params: params2)

    assert_not result1.deduplicated
    assert_not result2.deduplicated
    assert_not_nil result1.notice
    assert_not_nil result2.notice
  end

  test 'problem total_occurrences includes deduplicated count' do
    Rails.cache.clear
    result1 = ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 1, result1.problem.reload.total_occurrences

    ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 2, result1.problem.reload.total_occurrences

    ErrorIngestionService.call(app: @app, error_params: @valid_params)
    assert_equal 3, result1.problem.reload.total_occurrences
  end
end
