require "test_helper"

class AppTest < ActiveSupport::TestCase
  test "requires name" do
    app = App.new(user: users(:one))
    assert_not app.valid?
    assert_includes app.errors[:name], "can't be blank"
  end

  test "requires user" do
    app = App.new(name: "Test App")
    assert_not app.valid?
    assert_includes app.errors[:user], "must exist"
  end

  test "generates api_key automatically" do
    app = App.new(name: "Test App", user: users(:one))
    # has_secure_token generates on initialize
    assert_not_nil app.api_key
    assert app.api_key.length >= 24
  end

  test "api_key must be unique" do
    existing = apps(:one)
    app = App.new(name: "Test App", user: users(:one), api_key: existing.api_key)
    assert_not app.valid?
    assert_includes app.errors[:api_key], "has already been taken"
  end

  test "valid app can be created" do
    app = App.new(name: "New App", user: users(:one))
    assert app.valid?
  end

  test "belongs to user" do
    app = apps(:one)
    assert_equal users(:one), app.user
  end

  test "user has many apps" do
    user = users(:one)
    assert_includes user.apps, apps(:one)
  end

  test "environment is optional" do
    app = App.new(name: "Test App", user: users(:one))
    assert app.valid?
    assert_nil app.environment
  end
end
