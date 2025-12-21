class RemoveUserIdFromApps < ActiveRecord::Migration[8.1]
  def change
    remove_foreign_key :apps, :users if foreign_key_exists?(:apps, :users)
    remove_index :apps, :user_id if index_exists?(:apps, :user_id)
    remove_column :apps, :user_id, :bigint
  end
end
