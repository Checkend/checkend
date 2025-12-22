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
end
