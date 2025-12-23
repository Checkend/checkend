require 'application_system_test_case'

class AppsTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
  end

  test 'viewing apps index' do
    sign_in_as(@user)

    visit apps_path
    assert_text 'Apps'
    assert_text 'Manage your applications'
    assert_text @app.name
    assert_text @app.environment
  end

  test 'creating a new app' do
    sign_in_as(@user)

    visit apps_path
    click_link 'New App', match: :first

    fill_in 'Name', with: 'Test Application'
    select 'Staging', from: 'Environment'

    click_button 'Create App'

    assert_text 'App was successfully created'
    assert_text 'Test Application'
    assert_text 'staging'
  end

  test 'viewing app details' do
    sign_in_as(@user)

    visit app_path(@app)

    assert_text @app.name
    assert_text 'API Key'
    assert_text 'Notifications'
    assert_text 'New errors'
    assert_text 'Reoccurring errors'
    assert_text 'Recent Problems'
  end

  test 'editing an app' do
    sign_in_as(@user)

    visit app_path(@app)

    # Open the actions dropdown menu (three dots button)
    find("button[class*='rounded-lg'][class*='text-gray-500']").click

    click_link 'Edit'

    fill_in 'Name', with: 'Updated App Name'
    select 'Development', from: 'Environment'
    click_button 'Update App'

    assert_text 'App was successfully updated'
    assert_text 'Updated App Name'
  end

  test 'deleting an app' do
    # Create a separate app to delete so we don't affect other tests
    app_to_delete = @user.apps.create!(name: 'App to Delete', environment: 'staging')

    sign_in_as(@user)

    visit app_path(app_to_delete)

    # Open the actions dropdown menu
    find("button[class*='rounded-lg'][class*='text-gray-500']").click

    # Click delete and accept the confirmation
    accept_confirm do
      click_button 'Delete'
    end

    assert_text 'App was successfully deleted'
    assert_no_text 'App to Delete'
  end

  test 'regenerating API key' do
    sign_in_as(@user)

    visit app_path(@app)

    old_key = @app.api_key

    accept_confirm do
      click_button 'Regenerate'
    end

    assert_text 'API key was successfully regenerated'

    @app.reload
    assert_not_equal old_key, @app.api_key
  end

  test 'copying API key to clipboard' do
    sign_in_as(@user)

    visit app_path(@app)

    # Verify the copy button exists (it's an icon button with title)
    assert_selector "button[title='Copy to clipboard']"
  end
end
