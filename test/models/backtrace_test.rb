require "test_helper"

class BacktraceTest < ActiveSupport::TestCase
  test "requires fingerprint" do
    backtrace = Backtrace.new(lines: sample_lines)
    assert_not backtrace.valid?
    assert_includes backtrace.errors[:fingerprint], "can't be blank"
  end

  test "fingerprint must be unique" do
    existing = backtraces(:one)
    backtrace = Backtrace.new(fingerprint: existing.fingerprint, lines: sample_lines)
    assert_not backtrace.valid?
    assert_includes backtrace.errors[:fingerprint], "has already been taken"
  end

  test "requires lines" do
    backtrace = Backtrace.new(fingerprint: "abc123")
    assert_not backtrace.valid?
    assert_includes backtrace.errors[:lines], "can't be blank"
  end

  test "valid backtrace can be created" do
    backtrace = Backtrace.new(
      fingerprint: SecureRandom.hex(32),
      lines: sample_lines
    )
    assert backtrace.valid?
  end

  test "has many notices" do
    backtrace = backtraces(:one)
    assert_respond_to backtrace, :notices
  end

  test "generates fingerprint from lines" do
    lines = sample_lines
    fingerprint = Backtrace.generate_fingerprint(lines)

    assert_not_nil fingerprint
    assert fingerprint.length == 64 # SHA256 hex digest

    # Same lines should produce same fingerprint
    assert_equal fingerprint, Backtrace.generate_fingerprint(lines)
  end

  test "find_or_create_by_lines finds existing backtrace" do
    existing = backtraces(:one)
    found = Backtrace.find_or_create_by_lines(existing.lines)

    assert_equal existing.id, found.id
  end

  test "find_or_create_by_lines creates new backtrace" do
    new_lines = [
      { "file" => "app/new.rb", "line" => 1, "method" => "new_method" }
    ]

    assert_difference "Backtrace.count", 1 do
      backtrace = Backtrace.find_or_create_by_lines(new_lines)
      assert backtrace.persisted?
      assert_equal new_lines, backtrace.lines
    end
  end

  private

  def sample_lines
    [
      { "file" => "app/models/user.rb", "line" => 42, "method" => "save" },
      { "file" => "app/controllers/users_controller.rb", "line" => 10, "method" => "create" }
    ]
  end
end
