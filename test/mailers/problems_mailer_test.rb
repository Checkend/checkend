require 'test_helper'

class ProblemsMailerTest < ActionMailer::TestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @notice = notices(:one)
  end

  test 'new_problem email' do
    email = ProblemsMailer.with(
      recipient: @user,
      problem: @problem,
      notice: @notice
    ).new_problem

    assert_emails 1 do
      email.deliver_now
    end

    assert_equal [ @user.email_address ], email.to
    assert_match @app.name, email.subject
    assert_match @problem.error_class, email.subject
    assert_match 'New error', email.subject
  end

  test 'new_problem email contains error details' do
    email = ProblemsMailer.with(
      recipient: @user,
      problem: @problem,
      notice: @notice
    ).new_problem

    assert_match @problem.error_class, email.html_part.body.to_s
    assert_match @app.name, email.html_part.body.to_s
  end

  test 'problem_reoccurred email' do
    email = ProblemsMailer.with(
      recipient: @user,
      problem: @problem,
      notice: @notice
    ).problem_reoccurred

    assert_emails 1 do
      email.deliver_now
    end

    assert_equal [ @user.email_address ], email.to
    assert_match @app.name, email.subject
    assert_match @problem.error_class, email.subject
    assert_match 'reoccurred', email.subject
  end

  test 'problem_reoccurred email contains error details' do
    email = ProblemsMailer.with(
      recipient: @user,
      problem: @problem,
      notice: @notice
    ).problem_reoccurred

    assert_match @problem.error_class, email.html_part.body.to_s
    assert_match 'previously resolved', email.html_part.body.to_s
  end
end
