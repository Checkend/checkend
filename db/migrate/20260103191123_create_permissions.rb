class CreatePermissions < ActiveRecord::Migration[8.1]
  def change
    create_table :permissions do |t|
      t.string :key, null: false
      t.string :resource, null: false
      t.string :action, null: false
      t.string :description
      t.boolean :system, default: false, null: false

      t.timestamps
    end
    add_index :permissions, :key, unique: true
    add_index :permissions, [:resource, :action]
  end
end
