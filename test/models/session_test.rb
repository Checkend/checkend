require 'test_helper'

class SessionTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @session = sessions(:one)
  end

  # Association tests
  test 'belongs to user' do
    assert_equal @user, @session.user
  end

  test 'requires user' do
    session = Session.new(ip_address: '127.0.0.1', user_agent: 'Test')
    assert_not session.valid?
    assert_includes session.errors[:user], 'must exist'
  end

  # current? tests
  test 'current? returns true when session matches' do
    assert @session.current?(@session)
  end

  test 'current? returns false when session does not match' do
    other_session = sessions(:two)
    assert_not @session.current?(other_session)
  end

  test 'current? returns false when given nil' do
    assert_not @session.current?(nil)
  end

  # device_name tests
  test 'device_name returns iPhone for iPhone user agent' do
    @session.user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    assert_equal 'iPhone', @session.device_name
  end

  test 'device_name returns iPad for iPad user agent' do
    @session.user_agent = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    assert_equal 'iPad', @session.device_name
  end

  test 'device_name returns Android for Android user agent' do
    @session.user_agent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
    assert_equal 'Android', @session.device_name
  end

  test 'device_name returns Mac for Macintosh user agent' do
    @session.user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    assert_equal 'Mac', @session.device_name
  end

  test 'device_name returns Mac for Mac OS user agent' do
    @session.user_agent = 'Mozilla/5.0 (Mac OS X) SomeApp/1.0'
    assert_equal 'Mac', @session.device_name
  end

  test 'device_name returns Windows for Windows user agent' do
    @session.user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    assert_equal 'Windows', @session.device_name
  end

  test 'device_name returns Linux for Linux user agent' do
    @session.user_agent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    assert_equal 'Linux', @session.device_name
  end

  test 'device_name returns Unknown device for unrecognized user agent' do
    @session.user_agent = 'SomeRandomBot/1.0'
    assert_equal 'Unknown device', @session.device_name
  end

  test 'device_name returns Unknown device for blank user agent' do
    @session.user_agent = ''
    assert_equal 'Unknown device', @session.device_name
  end

  test 'device_name returns Unknown device for nil user agent' do
    @session.user_agent = nil
    assert_equal 'Unknown device', @session.device_name
  end

  test 'device_name is case insensitive' do
    @session.user_agent = 'mozilla/5.0 (IPHONE; cpu iphone os 17_0)'
    assert_equal 'iPhone', @session.device_name
  end

  # browser_name tests
  test 'browser_name returns Chrome for Chrome user agent' do
    @session.user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    assert_equal 'Chrome', @session.browser_name
  end

  test 'browser_name returns Safari for Safari user agent' do
    @session.user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    assert_equal 'Safari', @session.browser_name
  end

  test 'browser_name returns Firefox for Firefox user agent' do
    @session.user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
    assert_equal 'Firefox', @session.browser_name
  end

  test 'browser_name returns Edge for Edge user agent' do
    @session.user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    assert_equal 'Edge', @session.browser_name
  end

  test 'browser_name returns Opera for Opera user agent' do
    @session.user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'
    assert_equal 'Opera', @session.browser_name
  end

  test 'browser_name returns Opera for classic Opera user agent' do
    @session.user_agent = 'Opera/9.80 (Windows NT 6.1; WOW64) Presto/2.12.388 Version/12.18'
    assert_equal 'Opera', @session.browser_name
  end

  test 'browser_name returns Unknown browser for unrecognized user agent' do
    @session.user_agent = 'curl/7.88.1'
    assert_equal 'Unknown browser', @session.browser_name
  end

  test 'browser_name returns Unknown browser for blank user agent' do
    @session.user_agent = ''
    assert_equal 'Unknown browser', @session.browser_name
  end

  test 'browser_name returns Unknown browser for nil user agent' do
    @session.user_agent = nil
    assert_equal 'Unknown browser', @session.browser_name
  end

  test 'browser_name is case insensitive' do
    @session.user_agent = 'mozilla/5.0 CHROME/120.0'
    assert_equal 'Chrome', @session.browser_name
  end

  # device_description tests
  test 'device_description combines device and browser' do
    @session.user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    assert_equal 'Mac • Chrome', @session.device_description
  end

  test 'device_description with iPhone and Safari' do
    @session.user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    assert_equal 'iPhone • Safari', @session.device_description
  end

  test 'device_description with Windows and Firefox' do
    @session.user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    assert_equal 'Windows • Firefox', @session.device_description
  end

  test 'device_description with unknown device and browser' do
    @session.user_agent = nil
    assert_equal 'Unknown device • Unknown browser', @session.device_description
  end

  test 'device_description with Android and Chrome' do
    @session.user_agent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    assert_equal 'Android • Chrome', @session.device_description
  end

  # Edge cases
  test 'Chrome on iOS reports as iPhone with Chrome' do
    # Chrome on iOS uses WebKit and includes both Chrome and Safari in UA
    @session.user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1'
    assert_equal 'iPhone', @session.device_name
    # Note: This will match Chrome first due to case statement order
  end

  test 'Linux with Firefox' do
    @session.user_agent = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
    assert_equal 'Linux', @session.device_name
    assert_equal 'Firefox', @session.browser_name
  end
end
