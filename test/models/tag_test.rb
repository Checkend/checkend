require 'test_helper'

class TagTest < ActiveSupport::TestCase
  test 'valid tag' do
    tag = Tag.new(name: 'production')
    assert tag.valid?
  end

  test 'name is required' do
    tag = Tag.new(name: nil)
    assert_not tag.valid?
    assert_includes tag.errors[:name], "can't be blank"
  end

  test 'name must be unique (case insensitive)' do
    Tag.create!(name: 'production')
    tag = Tag.new(name: 'PRODUCTION')
    assert_not tag.valid?
    assert_includes tag.errors[:name], 'has already been taken'
  end

  test 'name is normalized to lowercase' do
    tag = Tag.create!(name: 'URGENT')
    assert_equal 'urgent', tag.name
  end

  test 'name allows letters, numbers, hyphens, and underscores' do
    valid_names = %w[bug-fix feature_123 v2-hotfix auth_module]
    valid_names.each do |name|
      tag = Tag.new(name: name)
      assert tag.valid?, "#{name} should be valid"
    end
  end

  test 'name rejects invalid characters' do
    invalid_names = ['with space', 'with@symbol', 'with.dot', 'with/slash']
    invalid_names.each do |name|
      tag = Tag.new(name: name)
      assert_not tag.valid?, "#{name} should be invalid"
      assert_includes tag.errors[:name], 'only allows letters, numbers, hyphens, and underscores'
    end
  end

  test 'name has maximum length of 50' do
    tag = Tag.new(name: 'a' * 51)
    assert_not tag.valid?
    assert_includes tag.errors[:name], 'is too long (maximum is 50 characters)'
  end

  test 'has many problem_tags' do
    tag = tags(:critical)
    assert_respond_to tag, :problem_tags
    assert_kind_of ProblemTag, tag.problem_tags.first
  end

  test 'has many problems through problem_tags' do
    tag = tags(:critical)
    assert_respond_to tag, :problems
    assert_includes tag.problems, problems(:one)
  end

  test 'destroying tag destroys associated problem_tags' do
    tag = tags(:critical)
    problem_tag_count = tag.problem_tags.count
    assert problem_tag_count > 0

    assert_difference 'ProblemTag.count', -problem_tag_count do
      tag.destroy
    end
  end
end
