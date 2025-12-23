require 'test_helper'

class ProblemsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @resolved_problem = problems(:resolved)
    sign_in_as(@user)
  end

  # Authentication tests
  test 'index requires authentication' do
    sign_out
    get app_problems_path(@app)
    assert_redirected_to new_session_path
  end

  test 'show requires authentication' do
    sign_out
    get app_problem_path(@app, @problem)
    assert_redirected_to new_session_path
  end

  # Index tests
  test 'index shows problems' do
    get app_problems_path(@app)
    assert_response :success
    assert_select 'h1', 'Problems'
    assert_match @problem.error_class, response.body
  end

  test 'index does not show other app problems' do
    other_problem = problems(:other_app)
    get app_problems_path(@app)
    assert_response :success
    assert_no_match other_problem.error_class, response.body
  end

  test 'index cannot access other users app problems' do
    other_app = apps(:two)
    get app_problems_path(other_app)
    assert_response :not_found
  end

  # Filter tests
  test 'index filters by unresolved status' do
    get app_problems_path(@app, status: 'unresolved')
    assert_response :success
    assert_match @problem.error_class, response.body
    assert_no_match @resolved_problem.error_class, response.body
  end

  test 'index filters by resolved status' do
    get app_problems_path(@app, status: 'resolved')
    assert_response :success
    assert_no_match @problem.error_class, response.body
    assert_match @resolved_problem.error_class, response.body
  end

  test 'index shows all problems when status is all' do
    get app_problems_path(@app, status: 'all')
    assert_response :success
    assert_match @problem.error_class, response.body
    assert_match @resolved_problem.error_class, response.body
  end

  # Search tests
  test 'index searches by error class' do
    get app_problems_path(@app, search: 'NoMethodError')
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  test 'index searches by error message' do
    get app_problems_path(@app, search: 'nil:NilClass')
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  test 'index search is case insensitive' do
    get app_problems_path(@app, search: 'nomethoderror')
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  # Date range filter tests
  test 'index filters by date_from' do
    # problems(:one) has last_noticed_at in the future (fixture data)
    get app_problems_path(@app, date_from: Date.current.to_s)
    assert_response :success
  end

  test 'index filters by date_to' do
    get app_problems_path(@app, date_to: Date.current.to_s)
    assert_response :success
  end

  test 'index filters by date range' do
    get app_problems_path(@app, date_from: 7.days.ago.to_date.to_s, date_to: Date.current.to_s)
    assert_response :success
  end

  # Notice count filter tests
  test 'index filters by min_notices' do
    get app_problems_path(@app, min_notices: 5)
    assert_response :success
    # Problem one has 5 notices, resolved has 10
    assert_match @problem.error_class, response.body
    assert_match @resolved_problem.error_class, response.body
  end

  test 'index filters by high min_notices excludes low count problems' do
    get app_problems_path(@app, min_notices: 10)
    assert_response :success
    # Only resolved problem has 10 notices
    assert_match @resolved_problem.error_class, response.body
  end

  test 'bulk actions preserve date filters' do
    post bulk_resolve_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      date_from: '2024-01-01',
      date_to: '2024-12-31'
    }
    assert_redirected_to app_problems_path(@app, date_from: '2024-01-01', date_to: '2024-12-31')
  end

  test 'bulk actions preserve min_notices filter' do
    post bulk_resolve_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      min_notices: '5'
    }
    assert_redirected_to app_problems_path(@app, min_notices: '5')
  end

  # Tag filter tests
  test 'index filters by single tag' do
    get app_problems_path(@app, tags: [ 'critical' ])
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  test 'index filters by multiple tags' do
    get app_problems_path(@app, tags: %w[critical frontend])
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  test 'index excludes problems without specified tag' do
    get app_problems_path(@app, tags: [ 'backend' ])
    assert_response :success
    # problems(:one) only has critical and frontend tags, not backend
    # problems(:two) has backend tag
    assert_match problems(:two).error_class, response.body
  end

  test 'bulk actions preserve tag filter' do
    post bulk_resolve_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      tags: [ 'critical' ]
    }
    assert_redirected_to app_problems_path(@app, tags: [ 'critical' ])
  end

  # Sort tests
  test 'index sorts by most recent by default' do
    get app_problems_path(@app)
    assert_response :success
    # Problem one has last_noticed_at more recent than resolved problem
    assert response.body.index(@problem.error_class) < response.body.index(@resolved_problem.error_class)
  end

  test 'index sorts by notices count' do
    get app_problems_path(@app, sort: 'notices')
    assert_response :success
    # Resolved problem has 10 notices, problem one has 5
    assert response.body.index(@resolved_problem.error_class) < response.body.index(@problem.error_class)
  end

  # Show tests
  test 'show displays problem details' do
    get app_problem_path(@app, @problem)
    assert_response :success
    assert_match @problem.error_class, response.body
  end

  test 'show cannot view other app problem' do
    other_problem = problems(:other_app)
    get app_problem_path(@app, other_problem)
    assert_response :not_found
  end

  # Resolve tests
  test 'resolve marks problem as resolved' do
    assert @problem.unresolved?

    post resolve_app_problem_path(@app, @problem)

    assert_redirected_to app_problems_path(@app)
    @problem.reload
    assert @problem.resolved?
    assert_not_nil @problem.resolved_at
  end

  test 'resolve cannot resolve other users app problem' do
    other_app = apps(:two)
    other_problem = problems(:other_app)
    post resolve_app_problem_path(other_app, other_problem)
    assert_response :not_found
  end

  # Unresolve tests
  test 'unresolve marks problem as unresolved' do
    assert @resolved_problem.resolved?

    post unresolve_app_problem_path(@app, @resolved_problem)

    assert_redirected_to app_problems_path(@app)
    @resolved_problem.reload
    assert @resolved_problem.unresolved?
    assert_nil @resolved_problem.resolved_at
  end

  # Bulk resolve tests
  test 'bulk_resolve resolves multiple problems' do
    problem_two = problems(:two)
    assert @problem.unresolved?
    assert problem_two.unresolved?

    post bulk_resolve_app_problems_path(@app), params: { problem_ids: [ @problem.id, problem_two.id ] }

    assert_redirected_to app_problems_path(@app)
    @problem.reload
    problem_two.reload
    assert @problem.resolved?
    assert problem_two.resolved?
  end

  test 'bulk_resolve with empty ids does nothing' do
    post bulk_resolve_app_problems_path(@app), params: { problem_ids: [] }
    assert_redirected_to app_problems_path(@app)
  end

  # Bulk unresolve tests
  test 'bulk_unresolve unresolves multiple problems' do
    @problem.resolve!
    problems(:two).resolve!

    post bulk_unresolve_app_problems_path(@app), params: { problem_ids: [ @problem.id, problems(:two).id ] }

    assert_redirected_to app_problems_path(@app)
    @problem.reload
    assert @problem.unresolved?
  end

  # Bulk tagging tests
  test 'bulk_add_tags adds existing tag to problems' do
    tag = Tag.create!(name: 'new-bulk-tag')
    problem_two = problems(:two)
    assert_not @problem.tags.include?(tag)
    assert_not problem_two.tags.include?(tag)

    post bulk_add_tags_app_problems_path(@app), params: {
      problem_ids: [ @problem.id, problem_two.id ],
      tag_name: 'new-bulk-tag'
    }

    assert_redirected_to app_problems_path(@app)
    @problem.reload
    problem_two.reload
    assert @problem.tags.include?(tag)
    assert problem_two.tags.include?(tag)
  end

  test 'bulk_add_tags creates new tag if not exists' do
    assert_not Tag.exists?(name: 'brand-new-tag')

    assert_difference 'Tag.count', 1 do
      post bulk_add_tags_app_problems_path(@app), params: {
        problem_ids: [ @problem.id ],
        tag_name: 'brand-new-tag'
      }
    end

    assert_redirected_to app_problems_path(@app)
    assert @problem.reload.tags.find_by(name: 'brand-new-tag')
  end

  test 'bulk_add_tags with blank tag name shows error' do
    post bulk_add_tags_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      tag_name: ''
    }

    assert_redirected_to app_problems_path(@app)
    assert_equal 'Please select a tag.', flash[:alert]
  end

  test 'bulk_remove_tags removes tag from problems' do
    tag = tags(:critical)
    assert @problem.tags.include?(tag)

    post bulk_remove_tags_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      tag_name: 'critical'
    }

    assert_redirected_to app_problems_path(@app)
    assert_not @problem.reload.tags.include?(tag)
  end

  test 'bulk_remove_tags with nonexistent tag shows error' do
    post bulk_remove_tags_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      tag_name: 'nonexistent-tag'
    }

    assert_redirected_to app_problems_path(@app)
    assert_equal 'Tag not found.', flash[:alert]
  end

  test 'bulk_add_tags preserves filters' do
    post bulk_add_tags_app_problems_path(@app), params: {
      problem_ids: [ @problem.id ],
      tag_name: 'test-tag',
      status: 'unresolved',
      tags: [ 'critical' ]
    }

    assert_redirected_to app_problems_path(@app, status: 'unresolved', tags: [ 'critical' ])
  end

  # Pagination tests
  test 'index paginates results' do
    get app_problems_path(@app, page: 1)
    assert_response :success
  end

  test 'index handles invalid page numbers by redirecting to first page' do
    get app_problems_path(@app, page: -1)
    assert_redirected_to app_problems_path(@app)
  end

  test 'index handles overflow page numbers by redirecting to first page' do
    get app_problems_path(@app, page: 9999)
    assert_redirected_to app_problems_path(@app)
  end
end
