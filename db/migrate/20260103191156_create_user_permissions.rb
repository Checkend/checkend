class CreateUserPermissions < ActiveRecord::Migration[8.1]
  def change
    create_table :user_permissions do |t|
      t.references :user, null: false, foreign_key: true
      t.references :permission, null: false, foreign_key: true
      t.references :team, foreign_key: true  # NULL = global permission
      t.string :grant_type, null: false      # "grant" or "revoke"
      t.references :granted_by, foreign_key: { to_table: :users }
      t.datetime :expires_at

      t.timestamps
    end
    add_index :user_permissions, [:user_id, :permission_id, :team_id],
              unique: true, name: 'idx_user_permissions_unique'
  end
end
