# frozen_string_literal: true

# Rate limiting configuration for the ingestion API
#
# Configure limits via environment variables:
#   RATE_LIMIT_INGESTION_PER_MINUTE - Max requests per minute per ingestion key (default: 100)
#   RATE_LIMIT_INGESTION_PER_HOUR   - Max requests per hour per ingestion key (default: 10000)
#   RATE_LIMIT_ENABLED              - Set to "false" to disable rate limiting (default: true)

class Rack::Attack
  # Allow disabling rate limiting via environment variable
  RATE_LIMIT_ENABLED = ENV.fetch('RATE_LIMIT_ENABLED', 'true') == 'true'

  # Use Rails cache as the backing store (Solid Cache in production)
  # In test environment, use memory store since Rails uses null_store by default
  if Rails.env.test?
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
  else
    Rack::Attack.cache.store = Rails.cache
  end

  # Configurable rate limits with sensible defaults
  INGESTION_LIMIT_PER_MINUTE = ENV.fetch('RATE_LIMIT_INGESTION_PER_MINUTE', 100).to_i
  INGESTION_LIMIT_PER_HOUR = ENV.fetch('RATE_LIMIT_INGESTION_PER_HOUR', 10_000).to_i

  # Only apply rate limiting if enabled
  if RATE_LIMIT_ENABLED
    # Rate limit ingestion API by ingestion key
    # Returns the ingestion key if present, nil otherwise (which skips the throttle)
    throttle('ingestion/minute', limit: INGESTION_LIMIT_PER_MINUTE, period: 1.minute) do |request|
      request.env['HTTP_CHECKEND_INGESTION_KEY'] if ingestion_request?(request)
    end

    throttle('ingestion/hour', limit: INGESTION_LIMIT_PER_HOUR, period: 1.hour) do |request|
      request.env['HTTP_CHECKEND_INGESTION_KEY'] if ingestion_request?(request)
    end
  end

  # Custom response for throttled requests
  self.throttled_responder = lambda do |request|
    match_data = request.env['rack.attack.match_data']
    now = Time.now.utc

    # Calculate retry time based on which throttle was hit
    retry_after = (match_data[:period] - (now.to_i % match_data[:period])).to_s

    [
      429,
      {
        'Content-Type' => 'application/json',
        'Retry-After' => retry_after
      },
      [ { error: "Rate limit exceeded. Retry after #{retry_after} seconds." }.to_json ]
    ]
  end

  class << self
    private

    def ingestion_request?(request)
      request.post? && request.path.start_with?('/ingest/')
    end
  end
end
