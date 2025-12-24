require 'test_helper'

class Settings::SmtpControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin_user = users(:admin)
    @regular_user = users(:one)
  end

  test 'show requires site admin' do
    sign_in_as(@regular_user)
    get settings_smtp_path
    assert_response :not_found
  end

  test 'show allows site admin' do
    sign_in_as(@admin_user)
    get settings_smtp_path
    assert_response :success
  end

  test 'edit requires site admin' do
    sign_in_as(@regular_user)
    get edit_settings_smtp_path
    assert_response :not_found
  end

  test 'edit allows site admin' do
    sign_in_as(@admin_user)
    get edit_settings_smtp_path
    assert_response :success
  end

  test 'update requires site admin' do
    sign_in_as(@regular_user)
    patch settings_smtp_path, params: {
      smtp_configuration: {
        address: 'smtp.example.com',
        port: 587
      }
    }
    assert_response :not_found
  end

  test 'update allows site admin to save configuration' do
    sign_in_as(@admin_user)
    config = SmtpConfiguration.instance

    patch settings_smtp_path, params: {
      smtp_configuration: {
        enabled: true,
        address: 'smtp.example.com',
        port: 587,
        domain: 'example.com',
        user_name: 'user@example.com',
        password: 'secret_password',
        authentication: 'plain',
        enable_starttls_auto: true
      }
    }

    assert_redirected_to settings_smtp_path
    config.reload
    assert config.enabled?
    assert_equal 'smtp.example.com', config.address
    assert_equal 587, config.port
    assert_equal 'example.com', config.domain
    assert_equal 'user@example.com', config.user_name
    assert_equal 'secret_password', config.password
    assert_equal 'plain', config.authentication
    assert config.enable_starttls_auto?
  end

  test 'update shows errors for invalid configuration' do
    sign_in_as(@admin_user)

    patch settings_smtp_path, params: {
      smtp_configuration: {
        enabled: true,
        address: '',
        port: '',
        user_name: '',
        password: ''
      }
    }

    assert_response :unprocessable_entity
    # Check for error messages in the response
    assert_match(/error/i, response.body) || assert_select('.text-red', minimum: 1)
  end

  test 'test_connection requires site admin' do
    sign_in_as(@regular_user)
    post test_connection_settings_smtp_path
    assert_response :not_found
  end

  test 'test_connection sends test email when valid' do
    sign_in_as(@admin_user)
    config = SmtpConfiguration.instance
    config.update!(
      enabled: true,
      address: 'smtp.example.com',
      port: 587,
      domain: 'example.com',
      user_name: 'user@example.com',
      password: 'secret',
      authentication: 'plain',
      enable_starttls_auto: true
    )

    # Create a mock SMTP class
    mock_smtp_class = Class.new do
      def self.new(address, port)
        mock_instance = Object.new
        def mock_instance.enable_starttls_auto; self; end
        def mock_instance.start(domain, user, pass, auth, &block)
          block.call(self) if block_given?
        end
        def mock_instance.send_message(*args); true; end
        mock_instance
      end
    end

    # Stub Net::SMTP with our mock using ActiveSupport::Testing::Stub
    original_smtp = Net::SMTP
    Net.send(:remove_const, :SMTP)
    Net.const_set(:SMTP, mock_smtp_class)

    begin
      post test_connection_settings_smtp_path
      assert_response :success
      json_response = JSON.parse(response.body)
      assert json_response['success']
    ensure
      Net.send(:remove_const, :SMTP)
      Net.const_set(:SMTP, original_smtp)
    end
  end

  test 'test_connection returns error when invalid' do
    sign_in_as(@admin_user)
    SmtpConfiguration.instance.update!(
      enabled: true,
      address: 'invalid-smtp',
      port: 587,
      user_name: 'user',
      password: 'pass',
      authentication: 'plain'
    )

    post test_connection_settings_smtp_path
    assert_response :unprocessable_entity
    json_response = JSON.parse(response.body)
    assert_not json_response['success']
    assert json_response['error'].present?
  end
end
