require 'test_helper'

class SmtpConfigurationTest < ActiveSupport::TestCase
  test 'validates required fields when enabled' do
    config = SmtpConfiguration.new(enabled: true)
    assert_not config.valid?
    assert_includes config.errors[:address], "can't be blank"
    assert_includes config.errors[:port], "can't be blank"
    assert_includes config.errors[:user_name], "can't be blank"
    assert_includes config.errors[:password], "can't be blank"
  end

  test 'does not validate required fields when disabled' do
    config = SmtpConfiguration.new(enabled: false)
    assert config.valid?
  end

  test 'validates port is a number' do
    config = SmtpConfiguration.new(
      enabled: true,
      address: 'smtp.example.com',
      port: 'not-a-number',
      user_name: 'user',
      password: 'pass'
    )
    assert_not config.valid?
    assert_includes config.errors[:port], 'is not a number'
  end

  test 'validates port is between 1 and 65535' do
    config = SmtpConfiguration.new(
      enabled: true,
      address: 'smtp.example.com',
      port: 0,
      user_name: 'user',
      password: 'pass'
    )
    assert_not config.valid?
    assert_includes config.errors[:port], 'must be greater than 0'

    config.port = 65536
    assert_not config.valid?
    assert_includes config.errors[:port], 'must be less than or equal to 65535'
  end

  test 'validates authentication is in allowed values' do
    config = SmtpConfiguration.new(
      enabled: true,
      address: 'smtp.example.com',
      port: 587,
      user_name: 'user',
      password: 'pass',
      authentication: 'invalid'
    )
    assert_not config.valid?
    assert_includes config.errors[:authentication], 'is not included in the list'
  end

  test 'accepts valid authentication values' do
    %w[plain login cram_md5].each do |auth|
      config = SmtpConfiguration.new(
        enabled: true,
        address: 'smtp.example.com',
        port: 587,
        user_name: 'user',
        password: 'pass',
        authentication: auth
      )
      assert config.valid?, "#{auth} should be valid"
    end
  end

  test 'encrypts password field' do
    config = SmtpConfiguration.instance
    config.update!(
      enabled: true,
      address: 'smtp.example.com',
      port: 587,
      user_name: 'user',
      password: 'secret_password',
      authentication: 'plain'
    )

    # Password should decrypt correctly when accessed
    assert_equal 'secret_password', config.password

    # Check that the stored value in DB is encrypted (not plaintext)
    raw_value = SmtpConfiguration.connection.execute(
      "SELECT password FROM smtp_configurations WHERE id = #{config.id}"
    ).first['password']
    assert_not_equal 'secret_password', raw_value
    assert raw_value.length > 'secret_password'.length  # Encrypted should be longer
  end

  test 'singleton pattern - only one record allowed' do
    config = SmtpConfiguration.instance
    config.update!(
      enabled: true,
      address: 'smtp.example.com',
      port: 587,
      user_name: 'user',
      password: 'pass',
      authentication: 'plain'
    )

    # Try to create a second record - should fail
    second = SmtpConfiguration.new(
      enabled: true,
      address: 'smtp2.example.com',
      port: 587,
      user_name: 'user2',
      password: 'pass2',
      authentication: 'plain'
    )

    assert_not second.save
    assert_includes second.errors[:base], 'Only one SMTP configuration is allowed'
    assert_equal 1, SmtpConfiguration.count
  end

  test 'valid configuration can be saved' do
    config = SmtpConfiguration.instance
    config.assign_attributes(
      enabled: true,
      address: 'smtp.example.com',
      port: 587,
      domain: 'example.com',
      user_name: 'user@example.com',
      password: 'secret',
      authentication: 'plain',
      enable_starttls_auto: true
    )
    assert config.valid?
    assert config.save
  end
end
