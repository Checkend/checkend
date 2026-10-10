# Golden fixture program for the Sentry Ruby SDK. Run through capture-sdk.ts (see README.md).
require "sentry-ruby"

Sentry.init do |config|
  config.dsn = ENV.fetch("SENTRY_DSN")
  config.release = "fixture-app@1.2.3"
  config.environment = "production"
  config.server_name = "fixture-host"
  config.background_worker_threads = 0
end

def load_user(id)
  {}.fetch(id)
end

def show_profile(id)
  load_user(id)[:name]
rescue KeyError
  raise "Failed to load user #{id}"
end

if ENV.fetch("FIXTURE_SCENARIO") == "type-error"
  Sentry.set_tags(route: "/users/:id")
  Sentry.set_user(id: "user-42", email: "ada@example.com")
  begin
    show_profile("42")
  rescue StandardError => e
    Sentry.capture_exception(e)
  end
else
  Sentry.capture_message("Cache miss rate above 90% for key user:1234", level: :warning)
end

Sentry.close
