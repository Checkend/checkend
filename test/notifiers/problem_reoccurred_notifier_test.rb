require 'test_helper'

class ProblemReoccurredNotifierTest < ActiveSupport::TestCase
  include ActionMailer::TestHelper

  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
  end

  test 'delivers notification to recipient' do
    assert_difference 'Noticed::Notification.count', 1 do
      ProblemReoccurredNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end

    notification = Noticed::Notification.last
    assert_equal @user, notification.recipient
  end

  test 'respects notify_on_reoccurrence setting' do
    @app.update!(notify_on_reoccurrence: true)

    # Should create notification when enabled
    assert_difference 'Noticed::Notification.count', 1 do
      ProblemReoccurredNotifier.with(problem: @problem, notice: @notice).deliver(@user)
    end
  end

  test 'notification message contains app name and error class' do
    ProblemReoccurredNotifier.with(problem: @problem, notice: @notice).deliver(@user)

    notification = Noticed::Notification.last
    assert_match @app.name, notification.message
    assert_match @problem.error_class, notification.message
  end
end
