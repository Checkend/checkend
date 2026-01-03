class CreateNotices < ActiveRecord::Migration[8.1]
  def change
    create_table :notices do |t|
      t.references :problem, null: false, foreign_key: true
      t.references :backtrace, null: true, foreign_key: true
      t.string :error_class, null: false
      t.text :error_message
      t.jsonb :context, default: {}
      t.jsonb :request, default: {}
      t.jsonb :user_info, default: {}
      t.datetime :occurred_at, null: false

      t.timestamps
    end

    add_index :notices, :occurred_at
  end
end
