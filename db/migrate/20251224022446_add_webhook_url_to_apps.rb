class AddWebhookUrlToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :webhook_url, :text
  end
end
