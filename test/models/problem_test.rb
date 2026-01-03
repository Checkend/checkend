require 'test_helper'

class ProblemTest < ActiveSupport::TestCase
  test 'requires app' do
    problem = Problem.new(
      error_class: 'NoMethodError',
      error_message: "undefined method 'foo'",
      fingerprint: 'abc123'
    )
    assert_not problem.valid?
    assert_includes problem.errors[:app], 'must exist'
  end

  test 'requires error_class' do
    problem = Problem.new(
      app: apps(:one),
      error_message: "undefined method 'foo'",
      fingerprint: 'abc123'
    )
    assert_not problem.valid?
    assert_includes problem.errors[:error_class], "can't be blank"
  end

  test 'requires fingerprint' do
    problem = Problem.new(
      app: apps(:one),
      error_class: 'NoMethodError',
      error_message: "undefined method 'foo'"
    )
    assert_not problem.valid?
    assert_includes problem.errors[:fingerprint], "can't be blank"
  end

  test 'fingerprint must be unique within app' do
    existing = problems(:one)
    problem = Problem.new(
      app: existing.app,
      error_class: 'DifferentError',
      error_message: 'different message',
      fingerprint: existing.fingerprint
    )
    assert_not problem.valid?
    assert_includes problem.errors[:fingerprint], 'has already been taken'
  end

  test 'same fingerprint allowed for different apps' do
    problem = Problem.new(
      app: apps(:two),
      error_class: 'NoMethodError',
      error_message: 'some error',
      fingerprint: problems(:one).fingerprint
    )
    assert problem.valid?
  end

  test 'valid problem can be created' do
    problem = Problem.new(
      app: apps(:one),
      error_class: 'NoMethodError',
      error_message: "undefined method 'foo'",
      fingerprint: SecureRandom.hex(32)
    )
    assert problem.valid?
  end

  test 'belongs to app' do
    problem = problems(:one)
    assert_equal apps(:one), problem.app
  end

  test 'has many notices' do
    problem = problems(:one)
    assert_respond_to problem, :notices
  end

  test 'defaults to unresolved status' do
    problem = Problem.new(
      app: apps(:one),
      error_class: 'NoMethodError',
      error_message: "undefined method 'foo'",
      fingerprint: SecureRandom.hex(32)
    )
    problem.save!
    assert_equal 'unresolved', problem.status
  end

  test 'can be resolved' do
    problem = problems(:one)
    assert problem.unresolved?

    problem.resolve!
    assert problem.resolved?
    assert_not_nil problem.resolved_at
  end

  test 'can be unresolve' do
    problem = problems(:resolved)
    assert problem.resolved?

    problem.unresolve!
    assert problem.unresolved?
    assert_nil problem.resolved_at
  end

  test 'generates fingerprint from error details' do
    fingerprint = Problem.generate_fingerprint('NoMethodError', "undefined method 'foo'", 'app/models/user.rb:42')

    assert_not_nil fingerprint
    assert fingerprint.length == 64 # SHA256 hex digest

    # Same inputs should produce same fingerprint
    assert_equal fingerprint, Problem.generate_fingerprint('NoMethodError', "undefined method 'foo'", 'app/models/user.rb:42')
  end

  test 'different locations produce different fingerprints' do
    fp1 = Problem.generate_fingerprint('NoMethodError', "undefined method 'foo'", 'app/models/user.rb:42')
    fp2 = Problem.generate_fingerprint('NoMethodError', "undefined method 'foo'", 'app/models/user.rb:43')

    assert_not_equal fp1, fp2
  end

  test 'error_message is optional for fingerprinting' do
    # Different error messages with same class and location should have same fingerprint
    fp1 = Problem.generate_fingerprint('NoMethodError', "undefined method 'foo'", 'app/models/user.rb:42')
    fp2 = Problem.generate_fingerprint('NoMethodError', "undefined method 'bar'", 'app/models/user.rb:42')

    # By default, we group by error class + location, not message
    assert_equal fp1, fp2
  end

  test 'tracks first_noticed_at' do
    problem = problems(:one)
    assert_not_nil problem.first_noticed_at
  end

  test 'tracks last_noticed_at' do
    problem = problems(:one)
    assert_not_nil problem.last_noticed_at
  end

  test 'unresolved scope returns only unresolved problems' do
    assert_includes Problem.unresolved, problems(:one)
    assert_not_includes Problem.unresolved, problems(:resolved)
  end

  test 'resolved scope returns only resolved problems' do
    assert_includes Problem.resolved, problems(:resolved)
    assert_not_includes Problem.resolved, problems(:one)
  end

  test 'occurrence_chart_data returns 31 days of data' do
    problem = problems(:one)
    data = problem.occurrence_chart_data(days: 30)

    assert_equal 31, data.size # inclusive range (30 days ago to today)
    assert data.keys.all? { |k| k.is_a?(Date) }
    assert data.values.all? { |v| v.is_a?(Integer) }
  end

  test 'occurrence_chart_data fills missing days with zeros' do
    problem = Problem.create!(
      app: apps(:one),
      error_class: 'TestError',
      fingerprint: SecureRandom.hex(32),
      first_noticed_at: Time.current,
      last_noticed_at: Time.current
    )
    # Create a notice only today
    problem.notices.create!(error_class: 'TestError', occurred_at: Time.current)

    data = problem.occurrence_chart_data(days: 30)
    zero_days = data.values.count(&:zero?)

    assert_equal 30, zero_days # All but today should be zero
    assert_equal 1, data[Date.current]
  end

  test 'occurrence_chart_data counts notices correctly' do
    problem = Problem.create!(
      app: apps(:one),
      error_class: 'TestError',
      fingerprint: SecureRandom.hex(32),
      first_noticed_at: Time.current,
      last_noticed_at: Time.current
    )
    # Create 3 notices today
    3.times { problem.notices.create!(error_class: 'TestError', occurred_at: Time.current) }

    data = problem.occurrence_chart_data(days: 30)

    assert_equal 3, data[Date.current]
  end

  # Tag association tests
  test 'has many problem_tags' do
    problem = problems(:one)
    assert_respond_to problem, :problem_tags
  end

  test 'has many tags through problem_tags' do
    problem = problems(:one)
    assert_respond_to problem, :tags
    assert_includes problem.tags, tags(:critical)
    assert_includes problem.tags, tags(:frontend)
  end

  test 'destroying problem destroys associated problem_tags' do
    problem = problems(:one)
    problem_tag_count = problem.problem_tags.count
    assert problem_tag_count > 0

    assert_difference 'ProblemTag.count', -problem_tag_count do
      problem.destroy
    end
  end

  # tagged_with scope tests
  test 'tagged_with returns problems with specified tag' do
    results = Problem.tagged_with('critical')
    assert_includes results, problems(:one)
    assert_not_includes results, problems(:two)
  end

  test 'tagged_with accepts array of tag names' do
    results = Problem.tagged_with(%w[critical frontend])
    assert_includes results, problems(:one)
  end

  test 'tagged_with is case insensitive' do
    results = Problem.tagged_with('CRITICAL')
    assert_includes results, problems(:one)
  end

  test 'tagged_with returns all when given blank input' do
    assert_equal Problem.all.to_a.sort, Problem.tagged_with(nil).to_a.sort
    assert_equal Problem.all.to_a.sort, Problem.tagged_with([]).to_a.sort
    assert_equal Problem.all.to_a.sort, Problem.tagged_with('').to_a.sort
  end

  test 'tagged_with returns distinct results' do
    # problems(:one) has both :critical and :frontend tags
    results = Problem.tagged_with(%w[critical frontend])
    assert_equal 1, results.where(id: problems(:one).id).count
  end

  # Date range scope tests
  test 'last_seen_after filters by last_noticed_at' do
    problem = problems(:one)
    problem.update!(last_noticed_at: 2.days.ago)

    results = Problem.last_seen_after(1.day.ago)
    assert_not_includes results, problem

    results = Problem.last_seen_after(3.days.ago)
    assert_includes results, problem
  end

  test 'last_seen_before filters by last_noticed_at' do
    problem = problems(:one)
    problem.update!(last_noticed_at: 2.days.ago)

    results = Problem.last_seen_before(1.day.ago)
    assert_includes results, problem

    results = Problem.last_seen_before(3.days.ago)
    assert_not_includes results, problem
  end

  test 'last_seen_after returns all when given blank input' do
    assert_equal Problem.all.to_a.sort, Problem.last_seen_after(nil).to_a.sort
    assert_equal Problem.all.to_a.sort, Problem.last_seen_after('').to_a.sort
  end

  test 'last_seen_before returns all when given blank input' do
    assert_equal Problem.all.to_a.sort, Problem.last_seen_before(nil).to_a.sort
    assert_equal Problem.all.to_a.sort, Problem.last_seen_before('').to_a.sort
  end

  # Notice count scope tests
  test 'with_notices_at_least filters by notice count' do
    results = Problem.with_notices_at_least(10)
    assert_includes results, problems(:resolved) # has 10 notices
    assert_not_includes results, problems(:one)  # has 5 notices
  end

  test 'with_notices_at_least returns all when given blank input' do
    assert_equal Problem.all.to_a.sort, Problem.with_notices_at_least(nil).to_a.sort
    assert_equal Problem.all.to_a.sort, Problem.with_notices_at_least('').to_a.sort
  end

  test 'with_notices_at_least returns all when given zero' do
    assert_equal Problem.all.to_a.sort, Problem.with_notices_at_least(0).to_a.sort
  end
end
