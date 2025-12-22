require 'test_helper'

class NoticesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    sign_in_as(@user)
  end

  # Authentication tests
  test 'show requires authentication' do
    sign_out
    get app_problem_notice_path(@app, @problem, @notice)
    assert_redirected_to new_session_path
  end

  # Show tests
  test 'show displays notice details' do
    get app_problem_notice_path(@app, @problem, @notice)
    assert_response :success
    assert_match @notice.error_class, response.body
    # Error message is HTML-escaped, so check for key parts
    assert_match 'undefined method', response.body
    assert_match 'nil:NilClass', response.body
  end

  test 'show displays backtrace when present' do
    get app_problem_notice_path(@app, @problem, @notice)
    assert_response :success
    assert_match 'Backtrace', response.body
  end

  test 'show displays request info when present' do
    notice_with_request = notices(:with_request)
    problem = notice_with_request.problem
    app = problem.app

    # Sign in as the owner of this app
    sign_in_as(app.user)

    get app_problem_notice_path(app, problem, notice_with_request)
    assert_response :success
    assert_match 'Request', response.body
    assert_match 'GET', response.body
  end

  test 'show displays user info when present' do
    notice_with_user = notices(:with_user)
    problem = notice_with_user.problem
    app = problem.app

    sign_in_as(app.user)

    get app_problem_notice_path(app, problem, notice_with_user)
    assert_response :success
    assert_match 'User', response.body
    assert_match 'john@example.com', response.body
  end

  test 'show displays context when present' do
    notice_with_context = notices(:with_context)
    problem = notice_with_context.problem
    app = problem.app

    sign_in_as(app.user)

    get app_problem_notice_path(app, problem, notice_with_context)
    assert_response :success
    assert_match 'Context', response.body
    assert_match 'production', response.body
  end

  # Authorization tests
  test 'show cannot view notice from other users app' do
    other_app = apps(:two)
    other_problem = problems(:other_app)
    # Create a notice for the other app's problem
    other_notice = Notice.create!(
      problem: other_problem,
      error_class: 'RuntimeError',
      error_message: 'Test error',
      occurred_at: Time.current
    )

    get app_problem_notice_path(other_app, other_problem, other_notice)
    assert_response :not_found
  end

  test 'show cannot view notice from wrong problem' do
    # Try to access a notice through a different problem than it belongs to
    other_problem = problems(:two)

    get app_problem_notice_path(@app, other_problem, @notice)
    assert_response :not_found
  end

  # Navigation tests
  test 'show includes navigation to other notices' do
    get app_problem_notice_path(@app, @problem, @notice)
    assert_response :success
    assert_match 'Newer Notice', response.body
    assert_match 'Older Notice', response.body
  end
end
