class NoticeDeduplicator
  Result = Struct.new(:deduplicated?, :occurrence_count, keyword_init: true)

  class << self
    def check_and_increment(app:, problem_fingerprint:, backtrace_fingerprint:)
      new(app: app, problem_fingerprint: problem_fingerprint, backtrace_fingerprint: backtrace_fingerprint).check_and_increment
    end

    def enabled?
      ENV.fetch('NOTICE_DEDUP_ENABLED', 'true') == 'true'
    end

    def window_seconds
      ENV.fetch('NOTICE_DEDUP_WINDOW_SECONDS', '60').to_i
    end
  end

  def initialize(app:, problem_fingerprint:, backtrace_fingerprint:)
    @app = app
    @problem_fingerprint = problem_fingerprint
    @backtrace_fingerprint = backtrace_fingerprint
  end

  def check_and_increment
    return Result.new(deduplicated?: false, occurrence_count: 1) unless self.class.enabled?

    count = increment_counter
    Result.new(deduplicated?: count > 1, occurrence_count: count)
  end

  private

  attr_reader :app, :problem_fingerprint, :backtrace_fingerprint

  def cache_key
    # Combine app_id + problem_fingerprint + backtrace_fingerprint for dedup key
    "notice_dedup:#{app.id}:#{problem_fingerprint}:#{backtrace_fingerprint}"
  end

  def increment_counter
    # Rails.cache.increment is atomic and returns the new value
    # If the key doesn't exist, it initializes to 1
    count = Rails.cache.increment(cache_key, 1, expires_in: self.class.window_seconds.seconds)

    # Handle case where increment returns nil (key doesn't exist with some cache stores)
    if count.nil?
      Rails.cache.write(cache_key, 1, expires_in: self.class.window_seconds.seconds)
      count = 1
    end

    count
  end
end
