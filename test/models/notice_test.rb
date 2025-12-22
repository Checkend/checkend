require "test_helper"

class NoticeTest < ActiveSupport::TestCase
  test "requires problem" do
    notice = Notice.new(
      error_class: "NoMethodError",
      error_message: "undefined method 'foo'"
    )
    assert_not notice.valid?
    assert_includes notice.errors[:problem], "must exist"
  end

  test "requires error_class" do
    notice = Notice.new(
      problem: problems(:one),
      error_message: "undefined method 'foo'"
    )
    assert_not notice.valid?
    assert_includes notice.errors[:error_class], "can't be blank"
  end

  test "valid notice can be created" do
    notice = Notice.new(
      problem: problems(:one),
      error_class: "NoMethodError",
      error_message: "undefined method 'foo'",
      occurred_at: Time.current
    )
    assert notice.valid?
  end

  test "belongs to problem" do
    notice = notices(:one)
    assert_equal problems(:one), notice.problem
  end

  test "belongs to backtrace (optional)" do
    notice = notices(:one)
    assert_respond_to notice, :backtrace
  end

  test "backtrace is optional" do
    notice = Notice.new(
      problem: problems(:one),
      error_class: "NoMethodError",
      error_message: "undefined method 'foo'",
      backtrace: nil
    )
    assert notice.valid?
  end

  test "can have context data" do
    notice = notices(:one)
    assert_respond_to notice, :context
    assert notice.context.is_a?(Hash) || notice.context.nil?
  end

  test "can have request info" do
    notice = notices(:with_request)
    assert_equal "GET", notice.request["method"]
    assert_equal "/users/123", notice.request["url"]
  end

  test "can have user info" do
    notice = notices(:with_user)
    assert_equal 42, notice.user_info["id"]
    assert_equal "john@example.com", notice.user_info["email"]
  end

  test "sets occurred_at to current time if not provided" do
    freeze_time do
      notice = Notice.create!(
        problem: problems(:one),
        error_class: "NoMethodError",
        error_message: "undefined method 'foo'"
      )
      assert_equal Time.current, notice.occurred_at
    end
  end

  test "increments problem notices_count" do
    problem = problems(:one)
    original_count = problem.notices_count

    Notice.create!(
      problem: problem,
      error_class: "NoMethodError",
      error_message: "undefined method 'foo'"
    )

    assert_equal original_count + 1, problem.reload.notices_count
  end

  test "updates problem last_noticed_at" do
    problem = problems(:one)
    original_last = problem.last_noticed_at

    freeze_time do
      Notice.create!(
        problem: problem,
        error_class: "NoMethodError",
        error_message: "undefined method 'foo'"
      )

      assert_equal Time.current, problem.reload.last_noticed_at
    end
  end

  test "sets problem first_noticed_at on first notice" do
    problem = Problem.create!(
      app: apps(:one),
      error_class: "NewError",
      fingerprint: SecureRandom.hex(32)
    )
    assert_nil problem.first_noticed_at

    freeze_time do
      Notice.create!(
        problem: problem,
        error_class: "NewError",
        error_message: "new error message"
      )

      assert_equal Time.current, problem.reload.first_noticed_at
    end
  end

  test "problem association through notice" do
    notice = notices(:one)
    assert_equal apps(:one), notice.problem.app
  end

  test "deleting notice decrements problem notices_count" do
    notice = notices(:one)
    problem = notice.problem
    original_count = problem.notices_count

    notice.destroy

    assert_equal original_count - 1, problem.reload.notices_count
  end
end
