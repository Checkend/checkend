require 'test_helper'

class PasswordHistoryTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
  end

  test 'belongs to user' do
    history = PasswordHistory.new(user: @user, password_digest: 'test_digest')
    assert_equal @user, history.user
  end

  test 'requires user' do
    history = PasswordHistory.new(password_digest: 'test_digest')
    assert_not history.valid?
  end
end
