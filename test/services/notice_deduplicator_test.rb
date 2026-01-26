require 'test_helper'

class NoticeDeduplicatorTest < ActiveSupport::TestCase
  setup do
    @app = apps(:one)
    @problem_fingerprint = 'abc123fingerprint'
    @backtrace_fingerprint = 'xyz789backtrace'
    Rails.cache.clear
  end

  # Basic functionality tests

  test 'first call returns not deduplicated with occurrence count 1' do
    result = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: @backtrace_fingerprint
    )

    assert_not result.deduplicated?
    assert_equal 1, result.occurrence_count
  end

  test 'second call within window returns deduplicated with occurrence count 2' do
    NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: @backtrace_fingerprint
    )

    result = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: @backtrace_fingerprint
    )

    assert result.deduplicated?
    assert_equal 2, result.occurrence_count
  end

  test 'multiple calls increment occurrence count correctly' do
    5.times do |i|
      result = NoticeDeduplicator.check_and_increment(
        app: @app,
        problem_fingerprint: @problem_fingerprint,
        backtrace_fingerprint: @backtrace_fingerprint
      )

      assert_equal i + 1, result.occurrence_count
      assert_equal i > 0, result.deduplicated?
    end
  end

  # Different fingerprint combinations

  test 'different apps are tracked separately' do
    app_two = apps(:two)

    result1 = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: @backtrace_fingerprint
    )

    result2 = NoticeDeduplicator.check_and_increment(
      app: app_two,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: @backtrace_fingerprint
    )

    assert_not result1.deduplicated?
    assert_not result2.deduplicated?
    assert_equal 1, result1.occurrence_count
    assert_equal 1, result2.occurrence_count
  end

  test 'different problem fingerprints are tracked separately' do
    result1 = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: 'fingerprint_a',
      backtrace_fingerprint: @backtrace_fingerprint
    )

    result2 = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: 'fingerprint_b',
      backtrace_fingerprint: @backtrace_fingerprint
    )

    assert_not result1.deduplicated?
    assert_not result2.deduplicated?
  end

  test 'different backtrace fingerprints are tracked separately' do
    result1 = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: 'backtrace_a'
    )

    result2 = NoticeDeduplicator.check_and_increment(
      app: @app,
      problem_fingerprint: @problem_fingerprint,
      backtrace_fingerprint: 'backtrace_b'
    )

    assert_not result1.deduplicated?
    assert_not result2.deduplicated?
  end

  # Configuration tests

  test 'returns not deduplicated when dedup is disabled' do
    with_env('NOTICE_DEDUP_ENABLED' => 'false') do
      # First call
      NoticeDeduplicator.check_and_increment(
        app: @app,
        problem_fingerprint: @problem_fingerprint,
        backtrace_fingerprint: @backtrace_fingerprint
      )

      # Second call should still return not deduplicated
      result = NoticeDeduplicator.check_and_increment(
        app: @app,
        problem_fingerprint: @problem_fingerprint,
        backtrace_fingerprint: @backtrace_fingerprint
      )

      assert_not result.deduplicated?
      assert_equal 1, result.occurrence_count
    end
  end

  test 'enabled? returns true by default' do
    assert NoticeDeduplicator.enabled?
  end

  test 'enabled? returns false when env var is false' do
    with_env('NOTICE_DEDUP_ENABLED' => 'false') do
      assert_not NoticeDeduplicator.enabled?
    end
  end

  test 'window_seconds returns 60 by default' do
    assert_equal 60, NoticeDeduplicator.window_seconds
  end

  test 'window_seconds is configurable via env var' do
    with_env('NOTICE_DEDUP_WINDOW_SECONDS' => '120') do
      assert_equal 120, NoticeDeduplicator.window_seconds
    end
  end

  private

  def with_env(vars)
    original_values = {}
    vars.each do |key, value|
      original_values[key] = ENV[key]
      ENV[key] = value
    end
    yield
  ensure
    original_values.each do |key, original_value|
      if original_value.nil?
        ENV.delete(key)
      else
        ENV[key] = original_value
      end
    end
  end
end
