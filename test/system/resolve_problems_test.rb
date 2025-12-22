require "application_system_test_case"

class ResolveProblemsTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @resolved_problem = problems(:resolved)
  end

  test "resolving a problem from the detail page" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    assert_text "Unresolved"

    click_button "Mark as Resolved"

    assert_text "Problem marked as resolved"

    @problem.reload
    assert @problem.resolved?
  end

  test "unresolving a problem from the detail page" do
    sign_in_as(@user)

    visit app_problem_path(@app, @resolved_problem)

    assert_text "Resolved"

    click_button "Mark as Unresolved"

    assert_text "Problem marked as unresolved"

    @resolved_problem.reload
    assert @resolved_problem.unresolved?
  end

  test "quick action buttons are present in problems list" do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Verify resolve buttons exist for unresolved problems (checkmark icon)
    assert_selector "button[title='Mark as resolved']"

    # Verify unresolve buttons exist for resolved problems (refresh icon)
    assert_selector "button[title='Mark as unresolved']"
  end

  test "bulk resolving multiple problems" do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Select multiple problems using checkboxes
    all("input[name='problem_ids[]']").each do |checkbox|
      checkbox.check
    end

    click_button "Resolve Selected"

    assert_text "problem(s) marked as resolved"
  end

  test "bulk unresolving multiple problems" do
    sign_in_as(@user)

    # First, resolve all problems
    @app.problems.find_each(&:resolve!)

    visit app_problems_path(@app)

    # Select all problems
    all("input[name='problem_ids[]']").each do |checkbox|
      checkbox.check
    end

    click_button "Unresolve Selected"

    assert_text "problem(s) marked as unresolved"
  end

  test "select all checkbox works" do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Click "Select all" checkbox
    check "Select all"

    # Verify all problem checkboxes are checked
    all("input[name='problem_ids[]']").each do |checkbox|
      assert checkbox.checked?
    end

    # Uncheck "Select all"
    uncheck "Select all"

    # Verify all problem checkboxes are unchecked
    all("input[name='problem_ids[]']").each do |checkbox|
      assert_not checkbox.checked?
    end
  end

  test "selected count updates when selecting problems" do
    sign_in_as(@user)

    visit app_problems_path(@app)

    assert_text "0 selected"

    # Check first problem
    first("input[name='problem_ids[]']").check

    assert_text "1 selected"
  end

  test "status indicator changes after resolving" do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Should show unresolved status with pink indicator
    assert_selector ".bg-pink-100, .dark\\:bg-pink-500\\/20"
    assert_text "Unresolved"

    click_button "Mark as Resolved"

    # After resolving, should show resolved status with green indicator
    visit app_problem_path(@app, @problem)
    assert_text "Resolved"
  end
end
