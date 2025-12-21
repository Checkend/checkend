class CreateBacktraces < ActiveRecord::Migration[8.1]
  def change
    create_table :backtraces do |t|
      t.string :fingerprint, null: false
      t.jsonb :lines, null: false, default: []

      t.timestamps
    end
    add_index :backtraces, :fingerprint, unique: true
  end
end
