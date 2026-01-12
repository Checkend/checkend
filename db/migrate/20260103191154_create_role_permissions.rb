class CreateRolePermissions < ActiveRecord::Migration[8.1]
  def change
    create_table :role_permissions do |t|
      t.string :role, null: false
      t.references :permission, null: false, foreign_key: true

      t.timestamps
    end
    add_index :role_permissions, [ :role, :permission_id ], unique: true
  end
end
