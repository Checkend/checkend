require 'test_helper'

class ProblemTagsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @app = apps(:one)
    @problem = problems(:one)
    @team = teams(:one)
    # Set up team access
    @team.team_members.find_or_create_by!(user: @user, role: 'admin')
    @team.team_assignments.find_or_create_by!(app: @app)
    sign_in_as(@user)
  end

  test 'index returns tags as json' do
    get app_problem_tags_path(@app, @problem), as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert json.key?('tags')
    assert json.key?('can_create')
  end

  test 'index filters tags by query' do
    Tag.create!(name: 'production')
    Tag.create!(name: 'staging')

    get app_problem_tags_path(@app, @problem), params: { q: 'prod' }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    tag_names = json['tags'].map { |t| t['name'] }
    assert_includes tag_names, 'production'
    assert_not_includes tag_names, 'staging'
  end

  test 'index excludes tags already on problem' do
    get app_problem_tags_path(@app, @problem), as: :json
    assert_response :success

    json = JSON.parse(response.body)
    tag_ids = json['tags'].map { |t| t['id'] }
    @problem.tags.each do |existing_tag|
      assert_not_includes tag_ids, existing_tag.id
    end
  end

  test 'index indicates can_create for valid new tag name' do
    get app_problem_tags_path(@app, @problem), params: { q: 'new-tag-name' }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert json['can_create']
  end

  test 'index indicates cannot create for existing tag name' do
    Tag.create!(name: 'existing')
    get app_problem_tags_path(@app, @problem), params: { q: 'existing' }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_not json['can_create']
  end

  test 'index indicates cannot create for invalid tag name' do
    get app_problem_tags_path(@app, @problem), params: { q: 'invalid tag!' }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_not json['can_create']
  end

  test 'create adds existing tag to problem' do
    tag = Tag.create!(name: 'existing-tag')
    @problem.tags.delete(tag) if @problem.tags.include?(tag)

    assert_difference '@problem.tags.count', 1 do
      post app_problem_tags_path(@app, @problem), params: { name: 'existing-tag' }, as: :json
    end
    assert_response :created

    json = JSON.parse(response.body)
    assert_equal 'existing-tag', json['name']
    assert @problem.reload.tags.include?(tag)
  end

  test 'create creates new tag and adds to problem' do
    assert_difference 'Tag.count', 1 do
      assert_difference '@problem.tags.count', 1 do
        post app_problem_tags_path(@app, @problem), params: { name: 'brand-new-tag' }, as: :json
      end
    end
    assert_response :created

    json = JSON.parse(response.body)
    assert_equal 'brand-new-tag', json['name']
  end

  test 'create normalizes tag name to lowercase' do
    post app_problem_tags_path(@app, @problem), params: { name: 'UPPERCASE' }, as: :json
    assert_response :created

    json = JSON.parse(response.body)
    assert_equal 'uppercase', json['name']
  end

  test 'create returns error if tag already on problem' do
    tag = tags(:critical)
    assert @problem.tags.include?(tag)

    assert_no_difference '@problem.tags.count' do
      post app_problem_tags_path(@app, @problem), params: { name: tag.name }, as: :json
    end
    assert_response :unprocessable_entity
  end

  test 'create returns error for invalid tag name' do
    assert_no_difference 'Tag.count' do
      post app_problem_tags_path(@app, @problem), params: { name: 'invalid name!' }, as: :json
    end
    assert_response :unprocessable_entity
  end

  test 'destroy removes tag from problem' do
    tag = tags(:critical)
    assert @problem.tags.include?(tag)

    assert_difference '@problem.tags.count', -1 do
      delete app_problem_tag_path(@app, @problem, tag), as: :json
    end
    assert_response :no_content
    assert_not @problem.reload.tags.include?(tag)
  end

  test 'destroy does not delete the tag itself' do
    tag = tags(:critical)

    assert_no_difference 'Tag.count' do
      delete app_problem_tag_path(@app, @problem, tag), as: :json
    end
    assert_response :no_content
    assert Tag.exists?(tag.id)
  end

  test 'destroy returns not found for tag not on problem' do
    tag = Tag.create!(name: 'not-on-problem')

    delete app_problem_tag_path(@app, @problem, tag), as: :json
    assert_response :not_found
  end

  test 'requires authentication' do
    sign_out
    get app_problem_tags_path(@app, @problem), as: :json
    assert_response :redirect
  end

  test 'requires access to app' do
    other_user = users(:two)
    # Ensure other_user doesn't have access to @app
    # Remove any existing team memberships that might give access
    @team.team_members.where(user: other_user).destroy_all
    # Create a separate team for other_user that is NOT assigned to @app
    other_team = Team.create!(name: 'Other Team', owner: other_user)
    other_team.team_members.create!(user: other_user, role: 'admin')
    # Ensure @app is only assigned to @team, not other_team
    @app.team_assignments.where(team: other_team).destroy_all
    sign_in_as(other_user)

    get app_problem_tags_path(@app, @problem), as: :json
    assert_response :not_found
  end
end
