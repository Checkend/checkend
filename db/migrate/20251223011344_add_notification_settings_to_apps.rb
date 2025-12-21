class AddNotificationSettingsToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :notify_on_new_problem, :boolean, default: true, null: false
    add_column :apps, :notify_on_reoccurrence, :boolean, default: true, null: false
  end
end
