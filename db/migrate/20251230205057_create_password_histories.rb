class CreatePasswordHistories < ActiveRecord::Migration[8.1]
  def change
    create_table :password_histories do |t|
      t.references :user, null: false, foreign_key: true
      t.string :password_digest

      t.timestamps
    end
  end
end
