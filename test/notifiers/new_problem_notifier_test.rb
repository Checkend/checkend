require 'test_helper'

class NewProblemNotifierTest < ActiveSupport::TestCase
  include ActionMailer::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
  end

  test 'delivers notification to recipient' do
    assert_difference 'Noticed::Notification.count', 1 do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    notification = Noticed::Notification.last
    assert_equal @user, notification.recipient
  end

  test 'respects notify_on_new_problem setting' do
    @app.update!(notify_on_new_problem: true)

    # Should create notification when enabled
    assert_difference 'Noticed::Notification.count', 1 do
      NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end
  end

  test 'notification message contains app name and error class' do
    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

    notification = Noticed::Notification.last
    assert_match @app.name, notification.message
    assert_match @problem.error_class, notification.message
  end

  test 'notification url points to problem page' do
    NewProblemNotifier.with(problem: @problem, notice: @notice).deliver(@user)

    notification = Noticed::Notification.last
    assert_match @app.slug, notification.url
    assert_match @problem.id.to_s, notification.url
  end
end
