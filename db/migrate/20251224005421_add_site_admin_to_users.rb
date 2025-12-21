class AddSiteAdminToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :site_admin, :boolean, default: false, null: false
    add_column :users, :last_logged_in_at, :datetime, null: true
    add_index :users, :site_admin
  end
end
