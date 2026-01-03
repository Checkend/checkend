class AddGitHubIntegrationToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :github_repository, :string
    add_column :apps, :github_token, :text
    add_column :apps, :github_enabled, :boolean, default: false, null: false
  end
end
