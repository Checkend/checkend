class CreateUserNotificationPreferences < ActiveRecord::Migration[8.1]
  def change
    create_table :user_notification_preferences do |t|
      t.references :user, null: false, foreign_key: true
      t.references :app, null: false, foreign_key: true
      t.boolean :notify_on_new_problem, default: true
      t.boolean :notify_on_reoccurrence, default: true

      t.timestamps
    end

    add_index :user_notification_preferences, [:user_id, :app_id], unique: true
  end
end
