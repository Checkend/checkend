ENV['RAILS_ENV'] ||= 'test'
# Disable rate limiting by default in tests to avoid interference between parallel tests
ENV['RATE_LIMIT_ENABLED'] ||= 'false'
require_relative '../config/environment'
require 'rails/test_help'
require 'webmock/minitest'
require_relative 'test_helpers/session_test_helper'

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end
