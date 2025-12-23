require "application_system_test_case"

class ProblemDetailsTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
    @notice_with_request = notices(:with_request)
    @notice_with_user = notices(:with_user)
    @notice_with_context = notices(:with_context)
  end

  test "viewing problem details" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    assert_text @problem.error_class
    assert_text @problem.error_message
    assert_text "Status"
    assert_text "Total Notices"
    assert_text "First Seen"
    assert_text "Last Seen"
  end

  test "viewing problem shows occurrence chart" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    assert_text "Error Occurrences"
    assert_text "Last 30 days"
  end

  test "problem shows recent notices list" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    assert_text "Recent Notices"
  end

  test "clicking notice opens notice detail" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Click on a notice in the list
    within ".divide-y" do
      first("a").click
    end

    # Should be on notice detail page
    assert_text @problem.error_class
    assert_text "Occurred"
    assert_text "Backtrace"
  end

  test "viewing notice with backtrace" do
    sign_in_as(@user)

    visit app_problem_notice_path(@app, @problem, @notice)

    assert_text @notice.error_class
    assert_text @notice.error_message
    assert_text "Backtrace"
  end

  test "viewing notice with request info" do
    sign_in_as(@user)

    # Navigate to the problem that has the notice with request
    problem_two = problems(:two)
    visit app_problem_notice_path(@app, problem_two, @notice_with_request)

    assert_text "Request"
    assert_text "GET"
    assert_text "/users/123"
  end

  test "viewing notice with user info" do
    sign_in_as(@user)

    problem_two = problems(:two)
    visit app_problem_notice_path(@app, problem_two, @notice_with_user)

    assert_text "User"
    assert_text "john@example.com"
    assert_text "John Doe"
  end

  test "viewing notice with context" do
    sign_in_as(@user)

    visit app_problem_notice_path(@app, @problem, @notice_with_context)

    assert_text "Context"
    assert_text "production"
    assert_text "web-01"
  end

  test "notice shows raw JSON section" do
    sign_in_as(@user)

    visit app_problem_notice_path(@app, @problem, @notice)

    assert_text "Raw JSON"
  end

  test "collapsible sections work" do
    sign_in_as(@user)

    visit app_problem_notice_path(@app, @problem, @notice)

    # Backtrace section should be expanded by default
    assert_selector "[x-show='expanded']", visible: true

    # Click to collapse
    find("button", text: "Backtrace").click

    # Content should be hidden (this is handled by Alpine.js)
  end

  test "breadcrumb navigation works" do
    sign_in_as(@user)

    visit app_problem_notice_path(@app, @problem, @notice)

    # Breadcrumb should show app name
    assert_text @app.name

    # Breadcrumb should show Problems link
    assert_link "Problems"

    # Click on Problems in breadcrumb
    click_link "Problems"

    assert_current_path app_problems_path(@app)
  end

  test "navigating between notices" do
    sign_in_as(@user)

    # Create another notice to enable navigation
    visit app_problem_notice_path(@app, @problem, @notice)

    # Should see navigation buttons
    assert_text "Newer Notice"
    assert_text "Older Notice"
  end
end
