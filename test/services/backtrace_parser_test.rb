require "test_helper"

class BacktraceParserTest < ActiveSupport::TestCase
  test "parses standard Ruby backtrace line" do
    line = "app/models/user.rb:42:in `validate_email'"
    result = BacktraceParser.parse_line(line)

    assert_equal "app/models/user.rb", result["file"]
    assert_equal 42, result["line"]
    assert_equal "validate_email", result["method"]
  end

  test "parses backtrace line with single quotes" do
    line = "app/controllers/users_controller.rb:15:in 'create'"
    result = BacktraceParser.parse_line(line)

    assert_equal "app/controllers/users_controller.rb", result["file"]
    assert_equal 15, result["line"]
    assert_equal "create", result["method"]
  end

  test "parses backtrace line with gem path" do
    line = "/Users/dev/.rbenv/versions/3.2.0/lib/ruby/gems/3.2.0/gems/activerecord-7.0.4/lib/active_record/base.rb:100:in `find'"
    result = BacktraceParser.parse_line(line)

    assert result["file"].include?("activerecord")
    assert_equal 100, result["line"]
    assert_equal "find", result["method"]
  end

  test "parses backtrace line with block method" do
    line = "app/services/processor.rb:25:in `block in process'"
    result = BacktraceParser.parse_line(line)

    assert_equal "app/services/processor.rb", result["file"]
    assert_equal 25, result["line"]
    assert_equal "block in process", result["method"]
  end

  test "handles non-standard format gracefully" do
    line = "some random string"
    result = BacktraceParser.parse_line(line)

    assert_equal "some random string", result["file"]
    assert_equal 0, result["line"]
    assert_equal "unknown", result["method"]
  end

  test "returns nil for blank lines" do
    assert_nil BacktraceParser.parse_line("")
    assert_nil BacktraceParser.parse_line(nil)
  end

  test "parses multiple lines" do
    lines = [
      "app/models/user.rb:42:in `validate_email'",
      "app/controllers/users_controller.rb:15:in `create'"
    ]

    result = BacktraceParser.parse(lines)

    assert_equal 2, result.length
    assert_equal "app/models/user.rb", result[0]["file"]
    assert_equal "app/controllers/users_controller.rb", result[1]["file"]
  end

  test "filters out blank lines when parsing multiple" do
    lines = [
      "app/models/user.rb:42:in `validate_email'",
      "",
      nil,
      "app/controllers/users_controller.rb:15:in `create'"
    ]

    result = BacktraceParser.parse(lines)

    assert_equal 2, result.length
  end
end
