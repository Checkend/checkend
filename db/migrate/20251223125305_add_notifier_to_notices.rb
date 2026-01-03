class AddNotifierToNotices < ActiveRecord::Migration[8.1]
  def change
    add_column :notices, :notifier, :jsonb
  end
end
