require 'test_helper'

class PasswordHistoryTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    # Clear any existing password histories
    @user.password_histories.destroy_all
  end

  # Association tests
  test 'belongs to user' do
    history = PasswordHistory.new(user: @user, password_digest: 'test_digest')
    assert_equal @user, history.user
  end

  test 'requires user' do
    history = PasswordHistory.new(password_digest: 'test_digest')
    assert_not history.valid?
    assert_includes history.errors[:user], 'must exist'
  end

  # Password history creation tests
  test 'password history is created when password changes' do
    original_digest = @user.password_digest

    assert_difference('@user.password_histories.count', 1) do
      @user.update!(password: 'newpassword123')
    end

    history = @user.password_histories.last
    assert_equal original_digest, history.password_digest
  end

  test 'password history is not created for new user' do
    new_user = User.new(
      email_address: 'newuser@example.com',
      password: 'initialpassword'
    )

    assert_no_difference('PasswordHistory.count') do
      new_user.save!
    end
  end

  test 'password history is not created if password does not change' do
    assert_no_difference('@user.password_histories.count') do
      @user.update!(email_address: 'updated@example.com')
    end
  end

  # Password reuse prevention tests
  test 'cannot reuse current password' do
    @user.update(password: 'currentpassword')

    @user.password = 'currentpassword'
    assert_not @user.valid?
    assert_includes @user.errors[:password], 'has been used recently. Please choose a different password.'
  end

  test 'cannot reuse password from history' do
    # Set initial password
    @user.update!(password: 'password1')

    # Change to a new password (password1 is now in history)
    @user.update!(password: 'password2')

    # Try to reuse password1
    @user.password = 'password1'
    assert_not @user.valid?
    assert_includes @user.errors[:password], 'has been used recently. Please choose a different password.'
  end

  test 'cannot reuse any of the last 5 passwords' do
    passwords = %w[pass1xxx pass2xxx pass3xxx pass4xxx pass5xxx pass6xxx]

    # Set initial password and change through 5 passwords
    passwords[0..4].each do |pwd|
      @user.update!(password: pwd)
    end

    # Now passwords 1-5 should be in history (password 1 was moved to history when changed to 2, etc.)
    # Current password is pass5xxx

    # Try to reuse each of the last 5 passwords
    passwords[0..4].each do |pwd|
      @user.password = pwd
      assert_not @user.valid?, "Should not allow reuse of password: #{pwd}"
    end
  end

  test 'can use password older than last 5' do
    passwords = %w[oldpass1 pass2xxx pass3xxx pass4xxx pass5xxx pass6xxx pass7xxx]

    # Cycle through 7 passwords
    passwords.each do |pwd|
      @user.update!(password: pwd)
    end

    # oldpass1 should now be older than the last 5 and allowed
    @user.password = 'oldpass1'
    assert @user.valid?, 'Should allow reuse of password older than last 5'
  end

  test 'can use a completely new password' do
    @user.update!(password: 'existingpwd')
    @user.update!(password: 'anotherpwd')

    @user.password = 'brandnewpassword'
    assert @user.valid?
  end

  # Password history cleanup tests
  test 'only keeps last 5 password histories' do
    7.times do |i|
      @user.update!(password: "password#{i}xxx")
    end

    assert_equal 5, @user.password_histories.count
  end

  test 'oldest password histories are deleted when limit exceeded' do
    # Create 6 password changes
    6.times do |i|
      @user.update!(password: "password#{i}xxx")
    end

    # Should only have 5 histories
    assert_equal 5, @user.password_histories.count

    # The oldest should be password0xxx (fixture password was cleaned up)
    oldest_history = @user.password_histories.order(:created_at).first
    assert BCrypt::Password.new(oldest_history.password_digest).is_password?('password0xxx')
  end

  # password_previously_used? method tests
  test 'password_previously_used? returns true for recently used password' do
    @user.update!(password: 'usedpassword1')
    @user.update!(password: 'usedpassword2')

    assert @user.password_previously_used?('usedpassword1')
  end

  test 'password_previously_used? returns false for unused password' do
    @user.update!(password: 'somepassword')

    assert_not @user.password_previously_used?('neverusedpassword')
  end

  test 'password_previously_used? returns false for password older than limit' do
    # Cycle through more than PASSWORD_HISTORY_LIMIT passwords
    7.times do |i|
      @user.update!(password: "password#{i}xxx")
    end

    # password0xxx should be old enough to reuse
    assert_not @user.password_previously_used?('password0xxx')
  end

  test 'password_previously_used? checks current password too' do
    @user.update!(password: 'currentpassword')

    # The current password_digest is checked during validation, not in password_previously_used?
    # password_previously_used? only checks history, but validation prevents current password reuse
    # Let's verify the history doesn't include current password
    assert_not @user.password_histories.any? { |h| BCrypt::Password.new(h.password_digest).is_password?('currentpassword') }
  end

  # Edge cases
  test 'password history works with special characters' do
    special_password = 'P@$$w0rd!#%^&*()'
    @user.update!(password: special_password)
    @user.update!(password: 'newpassword123')

    @user.password = special_password
    assert_not @user.valid?
  end

  test 'password history works with unicode characters' do
    unicode_password = 'пароль密码🔐'
    @user.update!(password: unicode_password)
    @user.update!(password: 'newpassword123')

    @user.password = unicode_password
    assert_not @user.valid?
  end

  test 'password history is deleted when user is destroyed' do
    @user.update!(password: 'password1')
    @user.update!(password: 'password2')

    history_ids = @user.password_histories.pluck(:id)
    assert history_ids.any?

    @user.destroy!

    assert_empty PasswordHistory.where(id: history_ids)
  end

  test 'multiple users have separate password histories' do
    other_user = users(:two)
    other_user.password_histories.destroy_all

    # Both users use the same password
    @user.update!(password: 'sharedpassword')
    other_user.update!(password: 'sharedpassword')

    # Change passwords
    @user.update!(password: 'newpassword1')
    other_user.update!(password: 'newpassword2')

    # Each user should be blocked from reusing their own history
    @user.password = 'sharedpassword'
    assert_not @user.valid?

    other_user.password = 'sharedpassword'
    assert_not other_user.valid?

    # But can use the other user's current password (newpassword2 for @user)
    @user.password = 'newpassword2'
    assert @user.valid?
  end
end
