require 'test_helper'

class UserNotificationPreferenceTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @app = apps(:one) || App.create!(name: 'Test App', slug: 'test-app')
    @preference = UserNotificationPreference.new(user: @user, app: @app)
  end

  test 'should be valid' do
    assert @preference.valid?
  end

  test 'should have default values' do
    @preference.save!
    assert @preference.notify_on_new_problem
    assert @preference.notify_on_reoccurrence
  end

  test 'should validate uniqueness of user and app' do
    @preference.save!
    duplicate = UserNotificationPreference.new(user: @user, app: @app)
    assert_not duplicate.valid?
  end
end
