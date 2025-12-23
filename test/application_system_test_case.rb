require 'test_helper'

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :selenium, using: :headless_chrome, screen_size: [ 1400, 1400 ]

  private

  def sign_in_as(user, password: 'password')
    visit new_session_path

    # Wait for the login form to be ready
    assert_text 'Sign in to your account', wait: 5

    # Fill in the form fields
    fill_in 'Email address', with: user.email_address
    fill_in 'Password', with: password

    # Submit the form
    click_button 'Sign in'

    # Wait for successful login - verify we're on the dashboard/apps page
    # This assertion will wait up to 5 seconds for the text to appear
    assert_text 'Apps', wait: 5
  end
end
