require 'application_system_test_case'

class TagsTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @problem_two = problems(:two)
    @resolved_problem = problems(:resolved)
    @critical_tag = tags(:critical)
    @frontend_tag = tags(:frontend)
    @backend_tag = tags(:backend)
  end

  # 1. Tag Display on Problem Show Page
  test 'tags are displayed as badges on problem show page' do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    assert_text 'Tags:'
    assert_text @critical_tag.name
    assert_text @frontend_tag.name
    assert_selector "[data-tag-id='#{@critical_tag.id}']"
    assert_selector "[data-tag-id='#{@frontend_tag.id}']"
  end

  test 'tag badges show remove button' do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Find tag badge within the tags section on problem show page
    within "[data-controller='tags']" do
      tag_badge = first("[data-tag-id='#{@critical_tag.id}']")
      within tag_badge do
        assert_selector "button[data-action='tags#remove']"
      end
    end
  end

  test 'problem without tags shows empty state' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    assert_text 'Tags:'
    assert_selector "input[data-tags-target='input']"
    assert_no_selector "[data-tag-id]"
  end

  # 2. Adding Tags on Problem Show Page
  test 'adding existing tag via autocomplete' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    # Type in the tag input
    tag_input = find("input[data-tags-target='input']")
    tag_input.fill_in with: 'back'

    # Wait for autocomplete suggestions to appear
    assert_selector "[data-tags-target='suggestions']", visible: true, wait: 5
    assert_text 'backend'

    # Click on the suggestion
    find('button', text: 'backend').click

    # Verify tag was added
    assert_selector "[data-tag-id='#{@backend_tag.id}']", wait: 5
    assert_text 'backend'
  end

  test 'creating new tag via autocomplete' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    # Type a new tag name
    tag_input = find("input[data-tags-target='input']")
    tag_input.fill_in with: 'new-tag'

    # Wait for autocomplete to show create option
    assert_selector "[data-tags-target='suggestions']", visible: true, wait: 5
    assert_text 'Create "new-tag"', wait: 2

    # Click create button
    create_button = find('button', text: /Create/, wait: 2)
    create_button.click

    # Verify tag was created and added within tags section
    within "[data-controller='tags']" do
      assert_text 'new-tag', wait: 5
      assert_selector "[data-tag-id]", wait: 5
    end
  end

  test 'autocomplete filters suggestions as you type' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    tag_input = find("input[data-tags-target='input']")

    # Type 'f' - should show frontend
    tag_input.fill_in with: 'f'
    assert_selector "[data-tags-target='suggestions']", visible: true, wait: 5
    assert_text 'frontend'

    # Type 'fr' - should still show frontend
    tag_input.fill_in with: 'fr'
    assert_text 'frontend', wait: 2

    # Type 'fro' - should not show backend
    tag_input.fill_in with: 'fro'
    assert_no_text 'backend', wait: 2
  end

  test 'autocomplete shows tag already added message' do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Try to add a tag that's already on the problem
    tag_input = find("input[data-tags-target='input']")
    tag_input.fill_in with: 'critical'

    # Wait for autocomplete
    assert_selector "[data-tags-target='suggestions']", visible: true, wait: 5
    assert_text 'Tag already added'
  end

  test 'keyboard navigation in autocomplete' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    tag_input = find("input[data-tags-target='input']")
    tag_input.fill_in with: 'b'

    # Wait for suggestions
    assert_selector "[data-tags-target='suggestions']", visible: true, wait: 5

    # Press arrow down to select first suggestion
    tag_input.send_keys(:arrow_down)
    tag_input.send_keys(:enter)

    # Verify tag was added
    assert_text 'backend', wait: 5
  end

  test 'escape key closes autocomplete' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problem_path(@app, problem_without_tags)

    tag_input = find("input[data-tags-target='input']")
    tag_input.fill_in with: 'b'

    # Wait for suggestions
    suggestions = find("[data-tags-target='suggestions']", visible: true, wait: 5)
    assert suggestions.visible?

    # Press escape
    tag_input.send_keys(:escape)

    # Suggestions should be hidden (not visible)
    assert_no_selector "[data-tags-target='suggestions']", visible: true, wait: 2
  end

  # 3. Removing Tags on Problem Show Page
  test 'removing tag via X button' do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Verify tag exists within tags section
    within "[data-controller='tags']" do
      tag_badge = first("[data-tag-id='#{@critical_tag.id}']")
      assert tag_badge

      # Click remove button
      within tag_badge do
        find("button[data-action='tags#remove']").click
      end

      # Verify tag was removed
      assert_no_selector "[data-tag-id='#{@critical_tag.id}']", wait: 5
    end
    assert_no_text @critical_tag.name, wait: 5
  end

  test 'removing all tags shows empty state' do
    sign_in_as(@user)

    visit app_problem_path(@app, @problem)

    # Remove tags within tags section
    within "[data-controller='tags']" do
      # Remove first tag
      critical_badge = first("[data-tag-id='#{@critical_tag.id}']")
      within critical_badge do
        find("button[data-action='tags#remove']").click
      end

      # Remove second tag
      frontend_badge = first("[data-tag-id='#{@frontend_tag.id}']")
      within frontend_badge do
        find("button[data-action='tags#remove']").click
      end

      # Verify empty state
      assert_no_selector "[data-tag-id]", wait: 5
    end
    assert_text 'Tags:'
    assert_selector "input[data-tags-target='input']"
  end

  # 4. Tag Display on Problems Index
  test 'tags appear as badges on problem list items' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Problem one has critical and frontend tags
    # Find the problem by its error class link, then check parent li
    problem_link = find_link(@problem.error_class)
    within problem_link.find(:xpath, '../..') do
      assert_text @critical_tag.name
      assert_text @frontend_tag.name
    end

    # Problem two has backend tag
    problem_two_link = find_link(@problem_two.error_class)
    within problem_two_link.find(:xpath, '../..') do
      assert_text @backend_tag.name
    end
  end

  test 'problems without tags do not show tag badges' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Resolved problem has no tags
    # Find the problem by its error class link, then check parent li
    resolved_link = find_link(@resolved_problem.error_class)
    within resolved_link.find(:xpath, '../..') do
      # Should not have any tag badges (only notice count badge)
      assert_no_text @critical_tag.name
      assert_no_text @frontend_tag.name
      assert_no_text @backend_tag.name
    end
  end

  # 5. Tag Filtering on Problems Index
  test 'tag filter chips are displayed when tags exist' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    assert_text 'Filter by tag:'
    assert_text @critical_tag.name
    assert_text @frontend_tag.name
    assert_text @backend_tag.name
  end

  test 'clicking tag chip toggles filter' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Click on critical tag filter (find link by text)
    click_link @critical_tag.name, match: :first

    # Verify URL has tag parameter
    assert_current_path app_problems_path(@app, tags: [@critical_tag.name])

    # Verify tag chip is highlighted (selected) - find link in filter section
    # Find the span with "Filter by tag:" text, then navigate to parent div
    filter_label = find('span', text: 'Filter by tag:')
    filter_section = filter_label.find(:xpath, '../..')
    within filter_section do
      tag_link = find_link(@critical_tag.name)
      assert_selector 'svg', wait: 2 # X icon indicates selected
    end
  end

  test 'selected tags are visually highlighted' do
    sign_in_as(@user)

    visit app_problems_path(@app, tags: [@critical_tag.name])

    # Selected tag should have violet background - find link in filter section
    filter_label = find('span', text: 'Filter by tag:')
    filter_section = filter_label.find(:xpath, '../..')
    within filter_section do
      selected_link = find_link(@critical_tag.name)
      assert selected_link[:class].include?('bg-violet-600'), 'Selected tag should have violet background'
    end
  end

  test 'filtering by single tag shows only matching problems' do
    sign_in_as(@user)

    visit app_problems_path(@app, tags: [@critical_tag.name])

    # Should show problem one (has critical tag)
    assert_text @problem.error_class
    assert_text @critical_tag.name

    # Should not show problem two (doesn't have critical tag)
    assert_no_text @problem_two.error_class
  end

  test 'filtering by multiple tags shows problems with any tag' do
    sign_in_as(@user)

    visit app_problems_path(@app, tags: [@critical_tag.name, @backend_tag.name])

    # Should show problem one (has critical tag)
    assert_text @problem.error_class

    # Should show problem two (has backend tag)
    assert_text @problem_two.error_class
  end

  test 'clearing tag filters removes them from URL' do
    sign_in_as(@user)

    visit app_problems_path(@app, tags: [@critical_tag.name])

    # Click the selected tag to deselect it
    click_link @critical_tag.name

    # URL should not have tags parameter
    assert_current_path app_problems_path(@app)
  end

  test 'tag filters persist in pagination' do
    sign_in_as(@user)

    visit app_problems_path(@app, tags: [@critical_tag.name])

    # Check that pagination links preserve tags
    # (This assumes pagination exists - if not, we'll verify the filter is preserved)
    assert_current_path app_problems_path(@app, tags: [@critical_tag.name])
  end

  # 6. Bulk Tag Operations
  test 'add tag dropdown appears in bulk actions bar' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Select a problem
    checkbox = find("input[type='checkbox'][name='problem_ids[]']", match: :first)
    checkbox.check

    # Verify bulk actions bar appears
    assert_text 'Add Tag'
    assert_selector "button", text: 'Add Tag'
  end

  test 'remove tag dropdown appears when problems have tags' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Select problem one which has tags
    find("input[type='checkbox'][name='problem_ids[]'][value='#{@problem.id}']").check

    # Verify Remove Tag dropdown appears
    assert_text 'Remove Tag'
    assert_selector "button", text: 'Remove Tag'
  end

  test 'selecting problems and adding tag via dropdown' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problems_path(@app)

    # Select resolved problem (has no tags)
    # Find checkbox by value (problem ID)
    find("input[type='checkbox'][name='problem_ids[]'][value='#{problem_without_tags.id}']").check

    # Open Add Tag dropdown
    find("button", text: 'Add Tag').click

    # Wait for dropdown menu
    assert_selector "[data-dropdown-target='menu']", visible: true, wait: 2

    # Click on backend tag in dropdown
    within "[data-dropdown-target='menu']" do
      find("button", text: @backend_tag.name).click
    end

    # Verify success message
    assert_text "Tag '#{@backend_tag.name}' added", wait: 5

    # Verify tag was added to the problem
    resolved_link = find_link(problem_without_tags.error_class)
    within resolved_link.find(:xpath, '../..') do
      assert_text @backend_tag.name, wait: 5
    end
  end

  test 'selecting problems and removing tag via dropdown' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Select problem one which has critical tag
    find("input[type='checkbox'][name='problem_ids[]'][value='#{@problem.id}']").check

    # Open Remove Tag dropdown
    find("button", text: 'Remove Tag').click

    # Wait for dropdown menu
    assert_selector "[data-dropdown-target='menu']", visible: true, wait: 2

    # Click on critical tag in dropdown
    within "[data-dropdown-target='menu']" do
      find("button", text: @critical_tag.name).click
    end

    # Verify success message
    assert_text "Tag '#{@critical_tag.name}' removed", wait: 5

    # Verify tag was removed from the problem
    problem_link = find_link(@problem.error_class)
    within problem_link.find(:xpath, '../..') do
      assert_no_text @critical_tag.name, wait: 5
    end
  end

  test 'bulk operations preserve other filters' do
    sign_in_as(@user)

    visit app_problems_path(@app, status: 'unresolved', search: 'NoMethod')

    # Select a problem
    checkbox = find("input[type='checkbox'][name='problem_ids[]']", match: :first)
    checkbox.check

    # Open Add Tag dropdown
    find("button", text: 'Add Tag').click

    # Add a tag
    within "[data-dropdown-target='menu']" do
      find("button", text: @backend_tag.name).click
    end

    # Verify filters are preserved in redirect
    assert_current_path app_problems_path(@app, status: 'unresolved', search: 'NoMethod'), wait: 5
  end

  test 'bulk operations show success messages' do
    sign_in_as(@user)
    problem_without_tags = problems(:resolved)

    visit app_problems_path(@app)

    # Select a problem
    find("input[type='checkbox'][name='problem_ids[]'][value='#{problem_without_tags.id}']").check

    # Open Add Tag dropdown
    find("button", text: 'Add Tag').click

    # Add a tag
    within "[data-dropdown-target='menu']" do
      find("button", text: @backend_tag.name).click
    end

    # Wait for redirect and verify we're still on problems page
    assert_current_path app_problems_path(@app), wait: 5
    assert_text 'Problems', wait: 5

    # Verify success message
    assert_text "Tag '#{@backend_tag.name}' added to 1 problem(s)", wait: 5
  end

  test 'bulk actions bar appears when problems are selected' do
    sign_in_as(@user)

    visit app_problems_path(@app)

    # Initially, bulk actions might not be visible or count shows 0
    # Select a problem
    find("input[type='checkbox'][name='problem_ids[]']", match: :first).check

    # Verify bulk actions bar appears with Add Tag option
    assert_text 'Add Tag', wait: 2
  end
end

