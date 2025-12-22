require "test_helper"

class AppsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @app = apps(:one)
    sign_in_as(@user)
  end

  # Authentication tests
  test "index requires authentication" do
    sign_out
    get apps_path
    assert_redirected_to new_session_path
  end

  test "show requires authentication" do
    sign_out
    get app_path(@app)
    assert_redirected_to new_session_path
  end

  # Index tests
  test "index shows user's apps" do
    get apps_path
    assert_response :success
    assert_select "h1", "Apps"
    assert_match @app.name, response.body
  end

  test "index does not show other users apps" do
    other_app = apps(:two)
    get apps_path
    assert_response :success
    assert_no_match other_app.name, response.body
  end

  # Show tests
  test "show displays app details" do
    get app_path(@app)
    assert_response :success
    assert_select "h1", @app.name
    assert_match @app.api_key, response.body
  end

  test "show cannot view other users app" do
    other_app = apps(:two)
    get app_path(other_app)
    assert_response :not_found
  end

  # New tests
  test "new shows form" do
    get new_app_path
    assert_response :success
    assert_select "h2", "New App"
    assert_select "form"
  end

  # Create tests
  test "create with valid params" do
    assert_difference("App.count", 1) do
      post apps_path, params: { app: { name: "New Test App", environment: "production" } }
    end

    app = App.last
    assert_redirected_to app_path(app)
    assert_equal "New Test App", app.name
    assert_equal "production", app.environment
    assert_equal @user, app.user
    assert app.api_key.present?
  end

  test "create with invalid params" do
    assert_no_difference("App.count") do
      post apps_path, params: { app: { name: "", environment: "production" } }
    end

    assert_response :unprocessable_entity
  end

  # Edit tests
  test "edit shows form" do
    get edit_app_path(@app)
    assert_response :success
    assert_select "h2", "Edit App"
  end

  test "edit cannot edit other users app" do
    other_app = apps(:two)
    get edit_app_path(other_app)
    assert_response :not_found
  end

  # Update tests
  test "update with valid params" do
    patch app_path(@app), params: { app: { name: "Updated Name", environment: "staging" } }

    assert_redirected_to app_path(@app)
    @app.reload
    assert_equal "Updated Name", @app.name
    assert_equal "staging", @app.environment
  end

  test "update with invalid params" do
    patch app_path(@app), params: { app: { name: "" } }

    assert_response :unprocessable_entity
    @app.reload
    assert_not_equal "", @app.name
  end

  test "update cannot update other users app" do
    other_app = apps(:two)
    patch app_path(other_app), params: { app: { name: "Hacked" } }
    assert_response :not_found
  end

  # Destroy tests
  test "destroy deletes app" do
    assert_difference("App.count", -1) do
      delete app_path(@app)
    end

    assert_redirected_to apps_path
  end

  test "destroy cannot delete other users app" do
    other_app = apps(:two)
    delete app_path(other_app)
    assert_response :not_found
  end

  # Regenerate API key tests
  test "regenerate_api_key updates the api key" do
    old_key = @app.api_key

    post regenerate_api_key_app_path(@app)

    assert_redirected_to app_path(@app)
    @app.reload
    assert_not_equal old_key, @app.api_key
  end

  test "regenerate_api_key cannot regenerate other users app key" do
    other_app = apps(:two)
    post regenerate_api_key_app_path(other_app)
    assert_response :not_found
  end
end
