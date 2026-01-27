class AddCreatedByToApps < ActiveRecord::Migration[8.1]
  def change
    add_reference :apps, :created_by, null: true, foreign_key: { to_table: :users }
  end
end
