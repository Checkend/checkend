require 'test_helper'

class ProblemTagTest < ActiveSupport::TestCase
  test 'valid problem_tag' do
    problem = problems(:one)
    tag = tags(:database)
    problem_tag = ProblemTag.new(problem: problem, tag: tag)
    assert problem_tag.valid?
  end

  test 'problem is required' do
    problem_tag = ProblemTag.new(problem: nil, tag: tags(:critical))
    assert_not problem_tag.valid?
    assert_includes problem_tag.errors[:problem], 'must exist'
  end

  test 'tag is required' do
    problem_tag = ProblemTag.new(problem: problems(:one), tag: nil)
    assert_not problem_tag.valid?
    assert_includes problem_tag.errors[:tag], 'must exist'
  end

  test 'problem and tag combination must be unique' do
    existing = problem_tags(:one_critical)
    duplicate = ProblemTag.new(problem: existing.problem, tag: existing.tag)
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:problem_id], 'has already been taken'
  end

  test 'belongs to problem' do
    problem_tag = problem_tags(:one_critical)
    assert_respond_to problem_tag, :problem
    assert_kind_of Problem, problem_tag.problem
  end

  test 'belongs to tag' do
    problem_tag = problem_tags(:one_critical)
    assert_respond_to problem_tag, :tag
    assert_kind_of Tag, problem_tag.tag
  end
end
