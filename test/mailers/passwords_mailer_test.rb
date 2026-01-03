require 'test_helper'

class PasswordsMailerTest < ActionMailer::TestCase
  setup do
    @user = users(:one)
  end

  test 'reset email is sent to user' do
    email = PasswordsMailer.reset(@user)

    assert_emails 1 do
      email.deliver_now
    end

    assert_equal [@user.email_address], email.to
    assert_equal 'Reset your password', email.subject
  end

  test 'reset email contains password reset link' do
    email = PasswordsMailer.reset(@user)

    assert_match 'password reset page', email.html_part.body.to_s
    assert_match %r{/passwords/[^/]+/edit}, email.html_part.body.to_s
  end

  test 'reset email contains expiration notice' do
    email = PasswordsMailer.reset(@user)

    assert_match 'expire', email.html_part.body.to_s
  end

  test 'reset email has text part with reset link' do
    email = PasswordsMailer.reset(@user)

    assert_match %r{/passwords/[^/]+/edit}, email.text_part.body.to_s
  end

  test 'reset email from address is set' do
    email = PasswordsMailer.reset(@user)

    assert_equal ['noreply@checkend.local'], email.from
  end
end
