require 'test_helper'

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :selenium, using: :headless_chrome, screen_size: [ 1400, 1400 ]

  private

  def sign_in_as(user, password: 'password')
    visit new_session_path
    fill_in 'Email address', with: user.email_address
    fill_in 'Password', with: password
    click_button 'Sign in'
    assert_text 'Apps' # Wait for dashboard to load
  end
end
