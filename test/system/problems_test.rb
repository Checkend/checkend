require 'application_system_test_case'

class ProblemsTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @resolved_problem = problems(:resolved)
  end

  test 'viewing problems list' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    assert_text 'Problems'
    assert_text @problem.error_class
    assert_text @resolved_problem.error_class
  end

  test 'filtering problems by unresolved status' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    select 'Unresolved', from: 'status'

    assert_text @problem.error_class
    assert_no_text @resolved_problem.error_class
  end

  test 'filtering problems by resolved status' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    select 'Resolved', from: 'status'

    assert_text @resolved_problem.error_class
    assert_no_text @problem.error_class
  end

  test 'searching problems by error class' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    fill_in 'search', with: 'NoMethodError'
    click_button 'Search'

    assert_text 'NoMethodError'
    assert_no_text 'ArgumentError'
  end

  test 'searching problems by error message' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    fill_in 'search', with: 'undefined method'
    click_button 'Search'

    assert_text 'NoMethodError'
    assert_text 'undefined method'
  end

  test 'sorting problems by most notices' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    select 'Most Notices', from: 'sort'

    # The resolved problem (ArgumentError) has 10 notices, should appear first
    # Check that ArgumentError appears before NoMethodError in the list
    page_text = page.text
    assert page_text.index('ArgumentError') < page_text.index('NoMethodError'),
           'ArgumentError (10 notices) should appear before NoMethodError (5 notices)'
  end

  test 'clearing filters' do
    sign_in_as(@user)

    visit app_problems_path(@app, status: 'resolved', search: 'Argument')

    # Should show filtered results
    assert_text 'ArgumentError'

    # Click the clear filters link (use match: first since there may be multiple)
    click_link 'Clear filters', match: :first

    assert_current_path app_problems_path(@app)
  end

  test 'empty state when no problems match filters' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    fill_in 'search', with: 'nonexistent error that does not exist anywhere'
    click_button 'Search'

    assert_text 'No problems found'
    assert_text 'Try adjusting your search'
  end

  test 'problem list shows status indicators' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Verify unresolved problem has pink indicator (via title attribute)
    assert_selector "[title='Unresolved']"

    # Verify resolved problem has green indicator
    assert_selector "[title='Resolved']"
  end

  test 'problem list shows notice counts' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    assert_text "#{@problem.notices_count} notice"
  end
end
