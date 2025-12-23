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

    # Wait for slide-over to be visible before interacting with form
    assert_text 'Create a new application to start monitoring errors.'

    fill_in 'Name', with: 'Test Application'
    select 'Staging', from: 'Environment'

    click_button 'Create App'

    # After creation, user is redirected to setup wizard
    assert_text 'App was successfully created'
    assert_text 'App Created!'
    assert_text 'Would you like to assign this app to a team?'

    # Skip the wizard to go to the app page
    # The Skip link should navigate to the app
    click_link 'Skip', wait: 2

    # Wait for navigation and verify we're on the app page
    assert_text 'Test Application', wait: 5
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

    # Wait for dropdown to be visible, then scope the Edit link click to the dropdown menu
    assert_selector "div[x-show='open']", wait: 2
    within("div[x-show='open']") do
      click_link 'Edit'
    end

    # Wait for slide-over to be visible before interacting with form
    assert_text 'Edit App'

    fill_in 'Name', with: 'Updated App Name'
    select 'Development', from: 'Environment'
    click_button 'Update App'

    assert_text 'App was successfully updated'
    assert_text 'Updated App Name'
  end

  test 'deleting an app' do
    # Create a separate app to delete so we don't affect other tests
    app_to_delete = App.create!(name: 'App to Delete', environment: 'staging', slug: 'app-to-delete')
    # Assign to a team so user can access it
    team = teams(:one) || Team.create!(name: 'Test Team', owner: @user)
    team.team_members.find_or_create_by!(user: @user, role: 'admin')
    team.team_assignments.find_or_create_by!(app: app_to_delete)

    sign_in_as(@user)

    visit app_path(app_to_delete)

    # Open the actions dropdown menu (three dots button)
    find("button[class*='rounded-lg'][class*='text-gray-500']").click

    # Wait for dropdown to appear
    assert_text 'Delete'

    # Click delete and accept the confirmation (button_to with turbo_confirm)
    accept_confirm 'Are you sure you want to delete this app? This will also delete all associated problems and notices.' do
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
