class AddSlackWebhookUrlToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :slack_webhook_url, :text
  end
end
