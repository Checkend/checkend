class CreateApps < ActiveRecord::Migration[8.1]
  def change
    create_table :apps do |t|
      t.string :name, null: false
      t.string :api_key, null: false
      t.string :environment
      t.references :user, null: false, foreign_key: true

      t.timestamps
    end
    add_index :apps, :api_key, unique: true
  end
end
