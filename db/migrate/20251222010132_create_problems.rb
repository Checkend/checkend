class CreateProblems < ActiveRecord::Migration[8.1]
  def change
    create_table :problems do |t|
      t.references :app, null: false, foreign_key: true
      t.string :error_class, null: false
      t.text :error_message
      t.string :fingerprint, null: false
      t.string :status, null: false, default: "unresolved"
      t.datetime :resolved_at
      t.integer :notices_count, null: false, default: 0
      t.datetime :first_noticed_at
      t.datetime :last_noticed_at

      t.timestamps
    end

    add_index :problems, [:app_id, :fingerprint], unique: true
    add_index :problems, :status
    add_index :problems, :last_noticed_at
  end
end
