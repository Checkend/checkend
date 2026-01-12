class CreateRecordPermissions < ActiveRecord::Migration[8.1]
  def change
    create_table :record_permissions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :record_type, null: false
      t.bigint :record_id, null: false
      t.references :permission, null: false, foreign_key: true
      t.string :grant_type, null: false      # "grant" or "revoke"
      t.references :granted_by, foreign_key: { to_table: :users }
      t.datetime :expires_at

      t.timestamps
    end
    add_index :record_permissions,
              [ :user_id, :record_type, :record_id, :permission_id ],
              unique: true, name: 'idx_record_permissions_unique'
    add_index :record_permissions, [ :record_type, :record_id ]
  end
end
